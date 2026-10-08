"""Existing files need no Qobuz ID; approved writes preserve encoded audio."""
from copy import deepcopy
import base64
from pathlib import Path
import hashlib
import shutil
import struct
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

from flask import Flask
from mutagen.flac import FLAC, Picture
from mutagen.id3 import APIC, COMM, ID3, TALB, TDRC, TIT2, TPE1, TPE2, TRDA, TSRC, TXXX, USLT
from mutagen.mp4 import MP4, MP4Cover, MP4FreeForm

from qobuz_dl.metadata_repair import (
    BACKUP_DIR, ISRC_ATOM, LocalRecording, assess_match, candidate_from_track,
    library_files, read_recording, recommended_candidate, write_changes,
)
from qobuz_dl.gui_backend.routes.metadata_repair_routes import register_metadata_repair_routes
from qobuz_dl.gui_backend.services.metadata_repair_service import MetadataRepairJob


COVER = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=")


def source_track(track_id=1, isrc="USABC2600001", version=""):
    return {"id": track_id, "title": "Song", "version": version, "duration": 1,
            "performer": {"name": "Main"}, "performers": "Main, MainArtist - Guest, FeaturedArtist - Writer, Composer",
            "isrc": isrc, "release_date_original": "2026-04-09",
            "album": {"title": "Album", "artist": {"name": "Main"}, "label": {"name": "Qobuz label"},
                      "upc": "1234567890123", "genre": {"name": "Pop"}}}


class FakeClient:
    def __init__(self, tracks=None):
        self.tracks = tracks or [source_track()]

    def search_tracks(self, query, limit=30, offset=0):
        return {"tracks": {"items": deepcopy(self.tracks)}}

    def get_track_meta(self, track_id):
        return deepcopy(next(t for t in self.tracks if str(t["id"]) == str(track_id)))


class MatchTests(unittest.TestCase):
    def local(self, **kwargs):
        values = dict(path="song.flac", relative_path="song.flac", title="Song", artists=["Main"],
                      album="Album", isrc="", duration=1, qobuz_id="", fingerprint=(0, 0))
        values.update(kwargs)
        return LocalRecording(**values)

    def test_no_id_required_and_detailed_track_credits_used(self):
        from qobuz_dl.metadata_repair import RecordingMatcher
        candidates = RecordingMatcher(FakeClient(), threading.Event()).find(self.local())
        self.assertEqual(recommended_candidate(candidates), "1")
        self.assertEqual(candidates[0]["artists"], ["Main", "Guest"])

    def test_same_title_artist_album_with_different_recording_requires_review(self):
        candidates = [assess_match(self.local(), candidate_from_track(source_track(1))),
                      assess_match(self.local(), candidate_from_track(source_track(2, "USABC2600002")))]
        self.assertIsNone(recommended_candidate(candidates))

    def test_same_isrc_multiple_editions_identifies_same_recording(self):
        candidates = [assess_match(self.local(), candidate_from_track(source_track(n))) for n in (1, 2)]
        self.assertEqual(recommended_candidate(candidates), "1")

    def test_live_version_wrong_duration_or_missing_album_is_not_recommended(self):
        for local, track in [(self.local(), source_track(version="Live")),
                             (self.local(duration=25), source_track()),
                             (self.local(album=""), source_track())]:
            with self.subTest(local=local, track=track):
                candidate = assess_match(local, candidate_from_track(track))
                self.assertIsNone(recommended_candidate([candidate]))

    def test_existing_isrc_conflict_is_blocked(self):
        candidate = assess_match(self.local(isrc="USABC2600002"), candidate_from_track(source_track()))
        self.assertTrue(candidate["isrc_conflict"])
        self.assertIsNone(recommended_candidate([candidate]))

    def test_featured_credit_in_old_title_matches_but_live_version_stays_distinct(self):
        for title in ("Song feat. Guest", "Song (feat. Guest)", "Song [ft. Guest]"):
            with self.subTest(title=title):
                candidate = assess_match(self.local(title=title), candidate_from_track(source_track()))
                self.assertEqual(recommended_candidate([candidate]), "1")
        candidate = assess_match(self.local(title="Song (Live)"), candidate_from_track(source_track()))
        self.assertIsNone(recommended_candidate([candidate]))


@unittest.skipUnless(shutil.which("ffmpeg"), "Real-file tests require FFmpeg")
class RepairFilesTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()

    def audio(self, extension, isrc="", version=4):
        path = self.root / ("source." + extension)
        codec = {"flac": "flac", "mp3": "libmp3lame", "m4a": "alac"}[extension]
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i",
                        "anullsrc=r=44100:cl=stereo", "-t", "1", "-c:a", codec, str(path)],
                       check=True, capture_output=True)
        if extension == "flac":
            tags = FLAC(path)
            tags.update(TITLE=["Song"], ARTIST=["Main"], ALBUM=["Album"], ALBUMARTIST=["Custom album artist"],
                        DATE=["1999"], LYRICS=["Keep my lyrics"], CUSTOM=["Keep my custom tag"])
            if isrc:
                tags["ISRC"] = [isrc]
            picture = Picture(); picture.data = COVER; picture.type = 3; picture.mime = "image/png"
            tags.add_picture(picture); tags.save()
        elif extension == "mp3":
            tags = ID3(path)
            for frame in (TIT2(text=["Song"]), TPE1(text=["Main"]), TALB(text=["Album"]), TPE2(text=["Custom album artist"]),
                          TDRC(text=["1999"]), USLT(desc="", lang="eng", text="Keep my lyrics"),
                          TXXX(desc="CUSTOM", text=["Keep my custom tag"]), COMM(desc="Note", lang="eng", text=["Keep comment"]),
                          APIC(mime="image/png", type=3, data=COVER)):
                tags.add(frame)
            if isrc:
                tags.add(TSRC(text=[isrc]))
            tags.save(path, v2_version=version)
        else:
            tags = MP4(path)
            tags.update({"\xa9nam": ["Song"], "\xa9ART": ["Main"], "\xa9alb": ["Album"], "aART": ["Custom album artist"],
                         "\xa9day": ["1999"], "\xa9lyr": ["Keep my lyrics"], "covr": [MP4Cover(COVER, imageformat=MP4Cover.FORMAT_PNG)],
                         "----:com.apple.iTunes:CUSTOM": [MP4FreeForm(b"Keep my custom tag")]})
            if isrc:
                tags[ISRC_ATOM] = [MP4FreeForm(isrc.encode())]
            tags.save()
        return path

    def packet_hash(self, path):
        # Hash encoded audio packets, without decoding or container metadata.
        return subprocess.check_output(["ffmpeg", "-nostdin", "-v", "error", "-i", str(path),
                                        "-map", "0:a:0", "-c:a", "copy", "-f", "hash", "-hash", "sha256", "-"])

    def tags(self, path):
        if path.suffix == ".flac":
            audio = FLAC(path)
            return dict(audio), [picture.write() for picture in audio.pictures]
        if path.suffix == ".mp3":
            return {key: frame.pprint() for key, frame in ID3(path).items()}, []
        return dict(MP4(path)), []

    def test_approved_writes_preserve_audio_all_other_tags_and_exact_backup(self):
        for extension in ("flac", "mp3", "m4a"):
            with self.subTest(extension=extension):
                path = self.audio(extension)
                original = hashlib.sha256(path.read_bytes()).hexdigest()
                packets, (before, pictures) = self.packet_hash(path), self.tags(path)
                local = read_recording(path, self.root)
                candidate = assess_match(local, candidate_from_track(source_track()))
                result = write_changes(local, candidate, self.root, "test-job")
                after, after_pictures = self.tags(path)
                changed_keys = {"flac": {"artist", "isrc"}, "mp3": {"TPE1", "TSRC"}, "m4a": {"\xa9ART", ISRC_ATOM}}[extension]
                self.assertEqual({k: v for k, v in before.items() if k not in changed_keys},
                                 {k: v for k, v in after.items() if k not in changed_keys})
                self.assertEqual(pictures, after_pictures)
                self.assertEqual(packets, self.packet_hash(path))
                self.assertEqual(read_recording(path).artists, ["Main", "Guest"])
                self.assertEqual(read_recording(path).isrc, "USABC2600001")
                self.assertEqual(original, hashlib.sha256((self.root / result["backup_path"]).read_bytes()).hexdigest())
                self.assertNotIn(str(self.root / result["backup_path"]), [str(p) for p in library_files(self.root)])

    def test_existing_isrc_is_kept_exactly(self):
        path = self.audio("flac", isrc="us-abc-26-00001")
        local = read_recording(path, self.root)
        write_changes(local, assess_match(local, candidate_from_track(source_track())), self.root, "test-job", backup=False)
        self.assertEqual(read_recording(path).isrc, "us-abc-26-00001")

    def test_other_fields_fill_only_when_requested_and_never_replace_existing(self):
        for extension in ("flac", "mp3", "m4a"):
            with self.subTest(extension=extension):
                path = self.audio(extension)
                local = read_recording(path, self.root)
                packets = self.packet_hash(path)
                write_changes(local, assess_match(local, candidate_from_track(source_track())), self.root, "test-job", fill_other=True)
                other = read_recording(path).other
                self.assertEqual(other["ALBUMARTIST"], ["Custom album artist"])
                self.assertEqual(other["DATE"], ["1999"])
                self.assertEqual(other["LABEL"], ["Qobuz label"])
                self.assertEqual(other["COMPOSER"], ["Writer"])
                self.assertEqual(self.packet_hash(path), packets)

    def test_failed_preparation_or_file_changed_since_preview_leaves_original_intact(self):
        path = self.audio("flac")
        local = read_recording(path, self.root)
        candidate = assess_match(local, candidate_from_track(source_track()))
        before = path.read_bytes()
        with patch("qobuz_dl.metadata_repair.FLAC.save", side_effect=OSError("Disk full")):
            with self.assertRaises(OSError):
                write_changes(local, candidate, self.root, "test-job")
        self.assertEqual(path.read_bytes(), before)
        self.assertFalse(list(self.root.glob(".qobuz-repair-*")))
        tags = FLAC(path); tags["COMMENT"] = "Edited after preview"; tags.save()
        current = path.read_bytes()
        with self.assertRaisesRegex(ValueError, "changed since preview"):
            write_changes(local, candidate, self.root, "test-job")
        self.assertEqual(path.read_bytes(), current)

    def test_mp3_v23_keeps_albumartist_date_lyrics_custom_tags_and_audio(self):
        path = self.audio("mp3", version=3)
        packets = self.packet_hash(path)
        local = read_recording(path, self.root)
        write_changes(local, assess_match(local, candidate_from_track(source_track())), self.root, "test-job")
        tags = ID3(path)
        self.assertEqual(tags["TPE2"].text, ["Custom album artist"])
        self.assertEqual(str(tags["TDRC"].text[0]), "1999")
        self.assertEqual(tags["TXXX:CUSTOM"].text, ["Keep my custom tag"])
        self.assertEqual(tags.getall("USLT")[0].text, "Keep my lyrics")
        self.assertEqual(self.packet_hash(path), packets)

    def test_mp3_legacy_id3v1_trailer_is_preserved_exactly(self):
        path = self.audio("mp3")
        legacy = b"TAG" + b"Old title".ljust(30, b"\x00") + b"Old artist".ljust(30, b"\x00")
        legacy += b"Old album".ljust(30, b"\x00") + b"1997" + b"Keep comment".ljust(30, b"\x00") + b"\x0d"
        with path.open("ab") as handle:
            handle.write(legacy)
        local = read_recording(path, self.root)
        write_changes(local, assess_match(local, candidate_from_track(source_track())), self.root, "test-job")
        self.assertEqual(path.read_bytes()[-128:], legacy)
        self.assertEqual(read_recording(path).artists, ["Main", "Guest"])

    def test_older_mp3_with_unknown_frames_is_left_intact(self):
        path = self.audio("mp3", version=3)
        tags = ID3(path, translate=False)
        tags.unknown_frames.append(b"XABC" + struct.pack(">I", 5) + b"\x00\x00hello")
        tags.save(path, v2_version=3)
        self.assertTrue(ID3(path).unknown_frames)
        local = read_recording(path, self.root)
        before = path.read_bytes()
        with self.assertRaisesRegex(ValueError, "unsupported ID3 frames"):
            write_changes(local, assess_match(local, candidate_from_track(source_track())), self.root, "test-job")
        self.assertEqual(path.read_bytes(), before)

    def test_obsolete_mp3_frame_is_preserved_by_skipping_conversion(self):
        path = self.audio("mp3", version=3)
        tags = ID3(path, translate=False)
        tags.add(TRDA(text=["Custom recording date"]))
        tags.save(path, v2_version=3)
        local = read_recording(path, self.root)
        before = path.read_bytes()
        with self.assertRaisesRegex(ValueError, "unsupported ID3 frames"):
            write_changes(local, assess_match(local, candidate_from_track(source_track())), self.root, "test-job")
        self.assertEqual(path.read_bytes(), before)

    def test_mp3_without_tags_can_receive_a_manually_chosen_recording(self):
        path = self.audio("mp3")
        ID3(path).delete(path, delete_v1=True, delete_v2=True)
        local = read_recording(path, self.root)
        packets = self.packet_hash(path)
        write_changes(local, assess_match(local, candidate_from_track(source_track())), self.root, "test-job", fill_other=True)
        self.assertEqual(read_recording(path).artists, ["Main", "Guest"])
        self.assertEqual(read_recording(path).isrc, "USABC2600001")
        self.assertEqual(read_recording(path).title, "Song")
        self.assertEqual(self.packet_hash(path), packets)

    def test_preview_writes_nothing_and_apply_requires_previewed_candidate(self):
        path = self.audio("flac")
        before = path.read_bytes()
        job = MetadataRepairJob(self.root, FakeClient())
        job.scan()
        self.assertEqual(job.phase, "ready")
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(job.rows[0]["recommended"], "1")
        self.assertFalse((self.root / BACKUP_DIR).exists())
        with self.assertRaises(ValueError):
            job.apply([{"row_id": "0", "candidate_id": "not-previewed"}])
        with patch.object(job, "_spawn", side_effect=lambda target, *args: target(*args)):
            job.apply([{"row_id": "0", "candidate_id": "1"}])
        self.assertEqual(job.updated, 1)
        self.assertEqual(job.phase, "complete")
        with self.assertRaises(ValueError):
            job.apply([{"row_id": "0", "candidate_id": "1"}])


class RepairRoutesTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        self.qobuz = type("Qobuz", (), {"client": FakeClient()})()
        self.jobs = register_metadata_repair_routes(app, get_qobuz=lambda: self.qobuz, download_active=lambda: False)
        self.client = app.test_client()

    def test_disconnected_scan_and_invalid_status_are_rejected(self):
        self.qobuz = None
        response = self.client.post("/api/metadata-repair", json={"folder": "."})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get("/api/metadata-repair/missing").status_code, 400)

    def test_file_paths_cannot_be_submitted_directly_for_writing(self):
        with tempfile.TemporaryDirectory() as folder:
            job = MetadataRepairJob(folder, FakeClient()); job.phase = "ready"
            self.jobs.jobs[job.id] = job
            response = self.client.post(f"/api/metadata-repair/{job.id}/apply",
                                        json={"selections": [{"row_id": "0", "path": "unapproved.flac", "candidate_id": "1"}]})
            self.assertEqual(response.status_code, 400)

    def test_another_scan_blocks_writing_an_older_preview(self):
        with tempfile.TemporaryDirectory() as folder:
            ready = MetadataRepairJob(folder, FakeClient()); ready.phase = "ready"
            running = MetadataRepairJob(folder, FakeClient())
            self.jobs.jobs.update({ready.id: ready, running.id: running})
            response = self.client.post(f"/api/metadata-repair/{ready.id}/apply",
                                        json={"selections": [{"row_id": "0", "candidate_id": "1"}]})
            self.assertEqual(response.status_code, 400)
            self.assertIn("Another existing-file operation", response.json["error"])


if __name__ == "__main__":
    unittest.main()
