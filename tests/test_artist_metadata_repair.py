"""Profile-scoped matching and a folder independent of download settings."""
from copy import deepcopy
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from flask import Flask

from qobuz_dl.artist_catalog import ArtistCatalog, normalize_artist_ids, search_profiles
from qobuz_dl.metadata_repair import LocalRecording, RecordingMatcher, recommended_candidate
from qobuz_dl.gui_backend.routes.metadata_repair_routes import register_metadata_repair_routes
from qobuz_dl.gui_backend.services.metadata_repair_service import MetadataRepairJob
from tests.test_metadata_repair import FakeClient, source_track


class CatalogClient(FakeClient):
    def __init__(self, tracks=None, profiles=None, releases=None):
        super().__init__(tracks)
        self.profiles = profiles or {"101": ("Main", ["a"])}
        self.releases = releases or {"a": [str(t["id"]) for t in self.tracks]}
        self.album_calls = []
        self.detail_calls = []

    def get_artist_meta(self, artist_id):
        name, albums = self.profiles[str(artist_id)]
        # One release per page exercises complete pagination, not just page 1.
        for album in albums:
            yield {"id": int(artist_id), "name": name, "albums_count": len(albums),
                   "albums": {"total": len(albums), "items": [{"id": album}]}}

    def api_call(self, endpoint, **kwargs):
        assert endpoint == "artist/get"
        return next(self.get_artist_meta(kwargs["id"]))

    def search_artists(self, query, limit=20, offset=0):
        items = [{"id": int(key), "name": name, "albums_count": len(albums)}
                 for key, (name, albums) in self.profiles.items()]
        return {"artists": {"total": len(items), "items": items[offset:offset + limit]}}

    def get_album_meta(self, album_id):
        self.album_calls.append(album_id)
        tracks = [deepcopy(t) for t in self.tracks if str(t["id"]) in self.releases[album_id]]
        return {"id": album_id, "title": "Album", "artist": {"name": "Main"},
                "tracks_count": len(tracks), "tracks": {"total": len(tracks), "items": tracks}}

    def get_track_meta(self, track_id):
        self.detail_calls.append(str(track_id))
        return super().get_track_meta(track_id)

    def search_tracks(self, *args, **kwargs):
        raise AssertionError("Profile-scoped lookup must not search the full catalog")


class ArtistCatalogTests(unittest.TestCase):
    def local(self, **kwargs):
        values = dict(path="song.flac", relative_path="song.flac", title="Song", artists=[],
                      album="Album", isrc="", duration=1, qobuz_id="", fingerprint=(0, 0))
        values.update(kwargs)
        return LocalRecording(**values)

    def matcher(self, client=None):
        client = client or CatalogClient()
        matcher = RecordingMatcher(client, threading.Event(), list(client.profiles))
        matcher.prepare_profiles(lambda _: None)
        return matcher

    def test_multiple_profiles_paginated_releases_shared_albums_and_singles(self):
        client = CatalogClient(tracks=[source_track(n) for n in (1, 2, 3)],
                               profiles={"101": ("Main", ["a", "single"]), "102": ("Guest", ["single", "b"])},
                               releases={"a": ["1"], "single": ["2"], "b": ["3"]})
        matcher = self.matcher(client)
        self.assertEqual(client.album_calls, ["a", "single", "b"])
        self.assertEqual(matcher.catalog.state["albums_loaded"], 3)
        self.assertEqual(matcher.catalog.state["tracks"], 3)
        self.assertEqual(matcher.profile_names, ["Main", "Guest"])

    def test_profile_supplies_artist_evidence_when_old_artists_are_missing_or_wrong(self):
        matcher = self.matcher()
        for artists in ([], ["Incomplete old artist"]):
            with self.subTest(artists=artists):
                candidates = matcher.find(self.local(artists=artists))
                self.assertEqual(recommended_candidate(candidates), "1")
                self.assertEqual(candidates[0]["artists"], ["Main", "Guest"])
                self.assertIn("selected artist profile", candidates[0]["evidence"])
        self.assertEqual(matcher.client.detail_calls, ["1"])

    def test_profile_artist_id_allows_name_variation_in_track_credits(self):
        track = source_track()
        track["performer"] = {"id": 101, "name": "Alternate name"}
        track["performers"] = "Alternate name, MainArtist - Guest, FeaturedArtist"
        candidates = self.matcher(CatalogClient([track])).find(self.local())
        self.assertEqual(recommended_candidate(candidates), "1")
        self.assertEqual(candidates[0]["artists"], ["Alternate name", "Guest"])

    def test_other_artists_on_a_shared_compilation_do_not_become_candidates(self):
        unrelated = source_track(2, "USABC2600002")
        unrelated["performer"] = {"id": 999, "name": "Someone else"}
        unrelated["performers"] = "Someone else, MainArtist"
        candidates = self.matcher(CatalogClient([source_track(), unrelated])).find(self.local(qobuz_id="2"))
        self.assertEqual([c["id"] for c in candidates], ["1"])

    def test_exact_title_editions_beyond_shortlist_remain_ambiguous(self):
        tracks = [source_track(n) for n in range(1, 13)]
        tracks[-1]["isrc"] = "USABC2600002"
        candidates = self.matcher(CatalogClient(tracks)).find(self.local())
        self.assertEqual(len(candidates), 12)
        self.assertIsNone(recommended_candidate(candidates))

    def test_manual_search_stays_inside_profiles_and_other_versions_stay_distinct(self):
        client = CatalogClient([source_track(), source_track(2, "USABC2600002", "Live")])
        matcher = self.matcher(client)
        candidates = matcher.find(self.local(), "Song Live Main")
        self.assertEqual([c["id"] for c in candidates], ["2"])
        self.assertIsNone(recommended_candidate(candidates))

    def test_album_edition_is_kept_when_comparing_existing_album_tags(self):
        track = source_track()
        track["album"]["version"] = "Deluxe"
        candidates = self.matcher(CatalogClient([track])).find(self.local(album="Album (Deluxe)"))
        self.assertEqual(candidates[0]["album"], "Album (Deluxe)")
        self.assertEqual(recommended_candidate(candidates), "1")

    def test_cancellation_stops_catalog_without_marking_it_complete(self):
        cancel = threading.Event()
        client = CatalogClient(profiles={"101": ("Main", ["a", "b"])}, releases={"a": ["1"], "b": ["1"]})
        original = client.get_album_meta
        def stop_after_first(album_id):
            result = original(album_id); cancel.set(); return result
        client.get_album_meta = stop_after_first
        catalog = ArtistCatalog(client, cancel, ["101"])
        catalog.prepare(lambda _: None)
        self.assertEqual(client.album_calls, ["a"])
        self.assertFalse(catalog.state["complete"])

    def test_partial_release_or_track_lists_do_not_produce_a_complete_preview(self):
        for stage in ("profiles", "tracks"):
            with self.subTest(stage=stage):
                client = CatalogClient()
                if stage == "profiles":
                    client.get_artist_meta = lambda _: iter([{"id": 101, "name": "Main", "albums_count": 2,
                                                             "albums": {"items": [{"id": "a"}]}}])
                else:
                    client.get_album_meta = lambda _: {"title": "Album", "tracks_count": 2,
                                                       "tracks": {"items": [source_track()]}}
                with self.assertRaisesRegex(ValueError, "Incomplete"):
                    self.matcher(client)

    def test_search_profiles_accepts_name_id_and_qobuz_links_and_paginates(self):
        client = CatalogClient(profiles={"101": ("Main", ["a"]), "102": ("Guest", ["a"])})
        for query in ("101", "https://play.qobuz.com/artist/101", "https://www.qobuz.com/no-no/artist/main/101"):
            with self.subTest(query=query):
                result = search_profiles(client, query)
                self.assertEqual(result["artists"][0]["id"], "101")
                self.assertFalse(result["more"])
        result = search_profiles(client, "Main", limit=1)
        self.assertTrue(result["more"])
        self.assertEqual(search_profiles(client, "Main", offset=1, limit=1)["artists"][0]["id"], "102")
        with self.assertRaises(ValueError):
            search_profiles(client, "https://example.com/artist/101")

    def test_profile_ids_are_validated_and_deduplicated(self):
        self.assertEqual(normalize_artist_ids([101, "101", "102"]), ["101", "102"])
        for value in ([True], ["bad"], "101", list(range(21))):
            with self.subTest(value=value), self.assertRaises(ValueError):
                normalize_artist_ids(value)


class MetadataFolderTests(unittest.TestCase):
    def test_metadata_folder_starts_empty_and_is_saved_without_touching_download_folder(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = root / "config.ini"
            original = b"[DEFAULT]\ndefault_folder = My downloads\n"
            config.write_bytes(original)
            library = root / "Older music"; library.mkdir()
            app = Flask(__name__)
            register_metadata_repair_routes(app, get_qobuz=lambda: type("Qobuz", (), {"client": FakeClient()})(),
                                            download_active=lambda: False, config_path=root)
            client = app.test_client()
            self.assertEqual(client.get("/api/metadata-repair/preferences").json["preferences"]["folder"], "")
            with patch.object(MetadataRepairJob, "_spawn", side_effect=lambda target, *args: target(*args)):
                response = client.post("/api/metadata-repair", json={"folder": str(library)})
            self.assertEqual(response.status_code, 202)
            self.assertEqual(config.read_bytes(), original)
            second = Flask("second")
            register_metadata_repair_routes(second, get_qobuz=lambda: None, download_active=lambda: False, config_path=root)
            self.assertEqual(second.test_client().get("/api/metadata-repair/preferences").json["preferences"]["folder"], str(library.resolve()))

    def test_invalid_profiles_or_request_body_are_rejected_before_scanning(self):
        app = Flask(__name__)
        jobs = register_metadata_repair_routes(app, get_qobuz=lambda: type("Qobuz", (), {"client": FakeClient()})(), download_active=lambda: False)
        for body in ({"folder": ".", "artist_ids": ["invalid"]}, [1, 2]):
            with self.subTest(body=body):
                self.assertEqual(app.test_client().post("/api/metadata-repair", json=body).status_code, 400)
        self.assertFalse(jobs.jobs)


if __name__ == "__main__":
    unittest.main()
