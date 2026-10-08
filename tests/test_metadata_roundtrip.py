"""Read real audio files back after tagging, including subsequent lyric writes."""
from copy import deepcopy
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from mutagen.flac import FLAC
from mutagen.id3 import ID3
from mutagen.mp4 import MP4
from qobuz_dl.credits import track_artists, normalize_isrc
from qobuz_dl.metadata import tag_flac, tag_mp3, _get_tags_to_add
from qobuz_dl.mp4_metadata import tag_m4a
from qobuz_dl.settings import QobuzDLSettings
from qobuz_dl.gui_backend.metadata import write_lyrics_metadata


def release():
    return {"id": "album1", "title": "Album", "artist": {"name": "Various Artists"},
            "release_date_original": "2026-04-09", "copyright": "(C) 2026 Label (P) 2025 Label",
            "label": {"name": "Label"}, "upc": "1234567890123", "media_count": 2,
            "tracks_count": 4, "release_type": "album", "product_type": "album",
            "genre": {"name": "Pop"}, "genres_list": ["Pop"], "streamable": True,
            "tracks": {"items": [{"id": n, "media_number": 1 if n < 3 else 2} for n in range(1, 5)]}}


def track():
    return {"id": 1, "title": "Song", "version": "Radio Edit", "track_number": 1,
            "media_number": 1, "performer": {"name": "Artist A & Artist B"},
            "performers": "Artist A, MainArtist - Artist B, MainArtist - Earth, Wind & Fire, FeaturedArtist - Writer, Composer - Engineer, MixingEngineer",
            "isrc": "us-abc-26-00001", "duration": 1, "parental_warning": False,
            "maximum_bit_depth": 16, "maximum_sampling_rate": 44.1,
            "release_date_original": "2026-04-09", "album": release()}


@unittest.skipUnless(shutil.which("ffmpeg"), "Audio roundtrip tests require FFmpeg")
class MetadataRoundtripTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def audio(self, extension):
        path = self.root / ("source." + extension)
        codec = {"flac": "flac", "mp3": "libmp3lame", "m4a": "alac"}[extension]
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i",
                        "anullsrc=r=44100:cl=stereo", "-t", "0.1", "-c:a", codec,
                        str(path)], check=True, capture_output=True)
        return path

    def test_flac_preserves_all_artists_isrc_disc_counts_and_credits(self):
        source, result = self.audio("flac"), self.root / "final.flac"
        tag_flac(source, self.root, result, track(), release(), False)
        audio = FLAC(result)
        self.assertEqual(audio["ARTIST"], ["Artist A", "Artist B", "Earth, Wind & Fire"])
        self.assertEqual(audio["ALBUMARTIST"], ["Various Artists"])
        self.assertEqual(audio["ISRC"], ["USABC2600001"])
        self.assertEqual(audio["TRACKTOTAL"], ["2"])
        self.assertEqual(audio["DISCTOTAL"], ["2"])
        self.assertEqual(audio["QOBUZTRACKID"], ["1"])
        self.assertEqual(audio["COMPOSER"], ["Writer"])
        self.assertEqual(audio["COMPILATION"], ["1"])
        self.assertIn("Engineer, MixingEngineer", audio["PERFORMER"][0])
        self.assertEqual(audio["COPYRIGHT"], ["\u00a9 2026 Label \u2117 2025 Label"])

    def test_mp3_preserves_separate_artists_full_date_and_isrc_after_lyrics(self):
        source, result = self.audio("mp3"), self.root / "final.mp3"
        tag_mp3(source, self.root, result, track(), release(), False)
        self.assertTrue(write_lyrics_metadata(str(result), "Some lyrics"))
        audio = ID3(result)
        self.assertEqual(audio.version[1], 4)
        self.assertEqual(audio["TPE1"].text, ["Artist A", "Artist B", "Earth, Wind & Fire"])
        self.assertEqual(audio["TSRC"].text, ["USABC2600001"])
        self.assertEqual(str(audio["TDRC"].text[0]), "2026-04-09")
        self.assertEqual(audio["TRCK"].text, ["1/2"])
        self.assertEqual(audio["TXXX:QOBUZTRACKID"].text, ["1"])

    def test_alac_preserves_all_artists_and_isrc(self):
        source = self.audio("m4a")
        tag_m4a(source, self.root, source, track(), release(), False)
        audio = MP4(source)
        self.assertEqual(audio["\u00a9ART"], ["Artist A", "Artist B", "Earth, Wind & Fire"])
        self.assertEqual(audio["aART"], ["Various Artists"])
        self.assertEqual(audio["----:com.apple.iTunes:ISRC"], [b"USABC2600001"])
        self.assertEqual(audio["trkn"], [(1, 2)])
        self.assertEqual(audio["----:com.apple.iTunes:QOBUZTRACKID"], [b"1"])

    def test_disabled_isrc_and_artist_tags(self):
        source, result = self.audio("flac"), self.root / "disabled.flac"
        tag_flac(source, self.root, result, track(), release(), False,
                 settings=QobuzDLSettings(no_isrc_tag=True, no_track_artist_tag=True))
        audio = FLAC(result)
        self.assertNotIn("ISRC", audio)
        self.assertNotIn("ARTIST", audio)
        self.assertNotIn("PERFORMER", audio)


class CreditMappingTests(unittest.TestCase):
    def test_band_names_are_not_split(self):
        for name in ["Earth, Wind & Fire", "Mumford & Sons", "AC/DC"]:
            with self.subTest(name=name):
                item = {"performer": {"name": name}, "performers": name + ", MainArtist"}
                self.assertEqual(track_artists(item, release()), [name])

    def test_structured_credits_and_associated_performers_are_included(self):
        item = {"performer": {"name": "Main"},
                "artists": [{"name": "Guest", "roles": ["FeaturedArtist"]}],
                "performers": "Player, AssociatedPerformer - Writer, Composer"}
        self.assertEqual(track_artists(item, release()), ["Main", "Guest", "Player"])

    def test_vocalists_and_unknown_additional_roles_are_not_lost(self):
        item = {"performer": {"name": "Main feat. Guest"},
                "performers": "Main, MainArtist - Guest, Vocals, NewInstrumentRole - Last, First, FeaturedArtist"}
        self.assertEqual(track_artists(item, release()), ["Main", "Guest", "Last, First"])

    def test_metadata_mapping_does_not_mutate_source_and_does_not_invent_isrc(self):
        album, item = release(), track()
        album["genres_list"] = ["Pop", "Pop\u2192Rock"]
        item.pop("isrc")
        before = deepcopy(album)
        tags = _get_tags_to_add(album, item)
        self.assertEqual(album, before)
        self.assertEqual(tags["ISRC"], "")
        self.assertEqual(normalize_isrc("bad-value"), "bad-value")
