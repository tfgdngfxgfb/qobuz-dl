"""Exercise GUI -> upstream engine -> real files with a fake Qobuz API."""
from copy import deepcopy
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

from mutagen.flac import FLAC
from mutagen.id3 import ID3
from qobuz_dl import db
from qobuz_dl.gui_backend.core import QobuzDL
from qobuz_dl.gui_backend.engine_adapter import Download
from qobuz_dl.utils import make_m3u


class FakeClient:
    def __init__(self, count=2):
        self.album = {"id": "album", "title": "Album", "artist": {"name": "Main"},
                      "streamable": True, "release_type": "album", "media_count": 1,
                      "release_date_original": "2026-04-09", "tracks_count": count,
                      "maximum_bit_depth": 16, "maximum_sampling_rate": 44.1,
                      "tracks": {"items": []}}
        self.tracks = {}
        self.urls = []
        self.format_id = 6
        for n in range(1, count + 1):
            item = {"id": n, "title": "Song " + str(n), "track_number": n, "media_number": 1,
                    "performer": {"name": "Main"}, "duration": 1,
                    "maximum_bit_depth": 16, "maximum_sampling_rate": 44.1}
            self.album["tracks"]["items"].append(deepcopy(item))
            self.tracks[n] = dict(item, performers="Main, MainArtist - Guest, FeaturedArtist",
                                  isrc=f"USABC260000{n}")

    def set_language_headers(self, _):
        pass

    def get_album_meta(self, _):
        return deepcopy(self.album)

    def get_track_meta(self, track_id):
        result = deepcopy(self.tracks[int(track_id)])
        result["album"] = deepcopy(self.album)
        return result

    def get_track_url(self, track_id, fmt_id, force_segments=False):
        self.urls.append((int(track_id), int(fmt_id), force_segments))
        return {"url": str(track_id), "format_id": self.format_id, "sample": False,
                "bit_depth": 16, "sampling_rate": 44.1}


@unittest.skipUnless(shutil.which("ffmpeg"), "Integration tests require FFmpeg")
class EngineAdapterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / "source.flac"
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i",
                        "anullsrc=r=44100:cl=stereo", "-t", "0.1", "-c:a", "flac",
                        str(self.source)], check=True, capture_output=True)
        self.events = []
        self.qobuz = QobuzDL(directory=str(self.root / "downloads"), quality=6,
                             no_cover=True, no_credits=True, downloads_db=str(self.root / "downloads.db"),
                             tag_title_from_track_format=False, tag_album_from_folder_format=False,
                             no_m3u_for_playlists=True)
        self.qobuz.client = FakeClient()
        for target, kwargs in [
            ("qobuz_dl.gui_backend.downloader._emit_track_marker", {"side_effect": lambda *a, **k: self.events.append((a, k))}),
            ("qobuz_dl.gui_backend.downloader._emit_track_start", {}),
            ("qobuz_dl.downloader.time.sleep", {}),
        ]:
            mock = patch(target, **kwargs)
            mock.start()
            self.addCleanup(mock.stop)

    def transfer(self, url, filename, *args, **kwargs):
        shutil.copyfile(self.source, filename)

    def run_album(self, transfer=None):
        with patch("qobuz_dl.downloader.tqdm_download", side_effect=transfer or self.transfer):
            self.qobuz.download_from_id("album")

    def test_core_uses_upstream_engine_and_emits_final_paths_with_complete_metadata(self):
        self.run_album()
        self.assertIsNotNone(db.handle_download_id(self.qobuz.downloads_db, "album", quality=6))
        self.assertEqual(len(self.events), 2)
        for args, kwargs in self.events:
            self.assertEqual(args[3], "downloaded")
            path = Path(kwargs["local_path"])
            self.assertTrue(path.is_file())
            self.assertNotIn("[IN PROGRESS]", str(path))
            audio = FLAC(path)
            self.assertEqual(audio["ARTIST"], ["Main", "Guest"])
            self.assertEqual(audio["ISRC"], ["USABC260000" + audio["QOBUZTRACKID"][0]])

    def test_failed_album_is_incomplete_and_not_recorded(self):
        def transfer(url, filename, *args, **kwargs):
            if str(url) == "2":
                raise ConnectionError("unavailable")
            self.transfer(url, filename)
        self.qobuz.quality_fallback = False
        self.run_album(transfer)
        self.assertIsNone(db.handle_download_id(self.qobuz.downloads_db, "album", quality=6))
        self.assertEqual({args[3] for args, _ in self.events}, {"downloaded", "failed"})
        completed = [kw["local_path"] for args, kw in self.events if args[3] == "downloaded"]
        self.assertTrue(Path(completed[0]).is_file())
        self.assertIn("[INCOMPLETE]", completed[0])
        self.assertEqual({fmt for _, fmt, _ in self.qobuz.client.urls}, {6})

    def test_single_track_keeps_gui_folder_and_filename_placeholders(self):
        self.qobuz.folder_format = "{artist}/{album_id}/{isrc}"
        self.qobuz.track_format = "{track_artist} - {tracktitle}"
        with patch("qobuz_dl.downloader.tqdm_download", side_effect=self.transfer):
            self.qobuz.download_from_id(1, album=False)
        path = Path(self.events[0][1]["local_path"])
        self.assertTrue(path.is_file())
        self.assertEqual(path.name, "Main - Song 1.flac")
        self.assertEqual(path.parent.name, "USABC2600001")
        self.assertEqual(path.parent.parent.name, "album")
        self.assertEqual(FLAC(path)["ARTIST"], ["Main", "Guest"])

    def test_disabled_segmented_fallback_is_respected(self):
        self.qobuz.segmented_fallback = False
        self.qobuz.quality_fallback = False
        with patch("qobuz_dl.downloader.tqdm_download", side_effect=ConnectionError("Unavailable")):
            self.qobuz.download_from_id("album")
        self.assertTrue(self.qobuz.client.urls)
        self.assertFalse(any(force for _, _, force in self.qobuz.client.urls))
        self.assertIsNone(db.handle_download_id(self.qobuz.downloads_db, "album", quality=6))

    def test_cancel_never_marks_album_complete_or_exits_gui_process(self):
        self.qobuz.cancel_event = threading.Event()
        self.qobuz.abort_stream_event = threading.Event()
        def transfer(url, filename, *args, **kwargs):
            self.transfer(url, filename)
            self.qobuz.cancel_event.set()
            self.qobuz.abort_stream_event.set()
        with patch("qobuz_dl.downloader.os._exit", side_effect=AssertionError("GUI process must survive")):
            self.run_album(transfer)
        self.assertIsNone(db.handle_download_id(self.qobuz.downloads_db, "album", quality=6))
        self.assertEqual(list((self.root / "downloads").rglob("*.flac")), [])
        self.assertTrue(list((self.root / "downloads").rglob("[[]INCOMPLETE]*")))

    def test_pause_finishes_active_file_but_leaves_album_retryable(self):
        self.qobuz.cancel_event = threading.Event()
        self.qobuz.abort_stream_event = threading.Event()
        def transfer(url, filename, *args, **kwargs):
            self.transfer(url, filename)
            self.qobuz.cancel_event.set()
        self.run_album(transfer)
        self.assertIsNone(db.handle_download_id(self.qobuz.downloads_db, "album", quality=6))
        files = list((self.root / "downloads").rglob("*.flac"))
        self.assertEqual(len(files), 1)
        self.assertEqual(FLAC(files[0])["ISRC"], ["USABC2600001"])

    def test_actual_mp3_format_gets_mp3_extension_and_tags(self):
        mp3 = self.root / "source.mp3"
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(self.source),
                        "-c:a", "libmp3lame", str(mp3)], check=True, capture_output=True)
        self.source = mp3
        self.qobuz.client.format_id = 5
        with patch("qobuz_dl.downloader.tqdm_download", side_effect=self.transfer):
            self.qobuz.download_from_id(1, album=False)
        files = list((self.root / "downloads").rglob("*.mp3"))
        self.assertEqual(len(files), 1)
        self.assertEqual(ID3(files[0])["TPE1"].text, ["Main", "Guest"])
        self.assertEqual(ID3(files[0])["TSRC"].text, ["USABC2600001"])

    def test_playlist_order_uses_track_ids_instead_of_filenames(self):
        self.run_album()
        directory = self.root / "downloads"
        remote = list(reversed(self.qobuz.client.album["tracks"]["items"]))
        make_m3u(str(directory), remote)
        body = (directory / "downloads.m3u8").read_text(encoding="utf-8")
        self.assertLess(body.index("Song 2.flac"), body.index("Song 1.flac"))

    def test_official_qobuz_lyrics_use_upstream_lookup_and_preserve_tags(self):
        self.qobuz.lyrics_enabled = True
        self.qobuz.lyrics_embed_metadata = True
        with patch("qobuz_dl.lyrics_engine.LyricsEngine._fetch_qobuz_native",
                   return_value="[00:01.00] Official lyrics") as native:
            self.run_album()
        self.assertEqual(native.call_count, 2)
        for path in (self.root / "downloads").rglob("*.flac"):
            tags = FLAC(path)
            self.assertEqual(tags["ARTIST"], ["Main", "Guest"])
            self.assertIn("Official lyrics", tags["LYRICS"][0])
            self.assertTrue(path.with_suffix(".lrc").is_file())

    def test_alac_download_and_playlist_keep_recording_ids(self):
        from mutagen.mp4 import MP4
        self.qobuz.convert_to_alac = True
        self.run_album()
        files = list((self.root / "downloads").rglob("*.m4a"))
        self.assertEqual(len(files), 2)
        self.assertEqual(list((self.root / "downloads").rglob("*.flac")), [])
        for path in files:
            tags = MP4(path)
            self.assertEqual(tags["\u00a9ART"], ["Main", "Guest"])
            self.assertTrue(tags["----:com.apple.iTunes:ISRC"])
        make_m3u(str(self.root / "downloads"), list(reversed(self.qobuz.client.album["tracks"]["items"])))
        body = (self.root / "downloads/downloads.m3u8").read_text(encoding="utf-8")
        self.assertLess(body.index("Song 2.m4a"), body.index("Song 1.m4a"))

    def test_substitute_keeps_actual_stream_isrc_and_artists(self):
        client = self.qobuz.client
        client.tracks[2]["isrc"] = "USABC2699999"
        client.tracks[2]["performers"] = "Replacement, MainArtist - Other Guest, FeaturedArtist"
        client.tracks[2]["performer"] = {"name": "Replacement"}
        downloader = Download(client, "album", str(self.root / "replacement"), 6,
                              no_cover=True, no_credits=True, write_m3u=False,
                              tag_title_from_track_format=False, tag_album_from_folder_format=False)
        with patch("qobuz_dl.downloader.tqdm_download", side_effect=self.transfer):
            downloader.download_substitute_for_slot(client.album, client.album["tracks"]["items"][0], "2")
        files = list((self.root / "replacement").rglob("*.flac"))
        self.assertEqual(len(files), 1)
        tags = FLAC(files[0])
        self.assertEqual(tags["ISRC"], ["USABC2699999"])
        self.assertEqual(tags["QOBUZTRACKID"], ["2"])
        self.assertEqual(tags["ARTIST"], ["Replacement", "Other Guest"])
        self.assertEqual(self.events[-1][1]["slot_track_id"], "1")
