import unittest
from unittest.mock import MagicMock, patch

from qobuz_dl.gui_backend.downloader import (
    _decrypt_qobuz_segment,
    _download_track_with_fallback,
    _get_qobuz_segment_uuid,
)


class QobuzSegmentDownloadTests(unittest.TestCase):
    def test_get_qobuz_segment_uuid_reads_mp4_box(self):
        uuid_bytes = b"\x01" * 16
        size = 24 + 8
        segment = bytearray(size + 4)
        segment[0:4] = size.to_bytes(4, "big")
        segment[4:8] = b"uuid"
        segment[8:24] = uuid_bytes
        self.assertEqual(_get_qobuz_segment_uuid(segment), uuid_bytes)

    def test_decrypt_qobuz_segment_noop_without_uuid(self):
        raw = b"plain-bytes"
        self.assertEqual(_decrypt_qobuz_segment(raw, b"\x00" * 16, None), raw)

    def test_download_track_with_fallback_uses_native_segments(self):
        calls = {"segments": 0}

        def getter(force_segments=False):
            if force_segments:
                calls["segments"] += 1
                return {
                    "url_template": "https://example.invalid/$SEGMENT$.m4s",
                    "n_segments": 1,
                    "raw_key": b"\x00" * 16,
                }
            return {"url": "https://example.invalid/direct.flac"}

        with patch(
            "qobuz_dl.gui_backend.downloader.tqdm_download",
            side_effect=ConnectionError("Akamai block"),
        ), patch(
            "qobuz_dl.gui_backend.downloader._tqdm_download_qobuz_segments"
        ) as m_segments:
            _download_track_with_fallback(
                getter,
                "/tmp/track.flac",
                "track.flac",
                use_range_segmented_fallback=False,
            )

        self.assertEqual(calls["segments"], 1)
        m_segments.assert_called_once()

    def test_download_track_with_fallback_requires_ffmpeg_for_segments(self):
        def getter(force_segments=False):
            if force_segments:
                return {
                    "url_template": "https://example.invalid/$SEGMENT$.m4s",
                    "n_segments": 1,
                    "raw_key": b"\x00" * 16,
                }
            return {"url": "https://example.invalid/direct.flac"}

        with patch(
            "qobuz_dl.gui_backend.downloader.tqdm_download",
            side_effect=ConnectionError("Akamai block"),
        ), patch("qobuz_dl.gui_backend.downloader._ffmpeg_on_path", return_value=False):
            with self.assertRaises(ConnectionError) as ctx:
                _download_track_with_fallback(
                    getter,
                    "/tmp/track.flac",
                    "track.flac",
                    use_range_segmented_fallback=False,
                )
        self.assertIn("ffmpeg", str(ctx.exception).lower())

    def test_get_track_url_force_segments_uses_file_url(self):
        from qobuz_dl.gui_backend.qopy import Client

        client = Client.__new__(Client)
        client.sec = "ab" * 16
        client.session_id = None
        client.session = MagicMock()
        client.session.headers = {}

        segment_payload = {
            "url_template": "https://cdn.example/$SEGMENT$.m4s",
            "n_segments": 2,
            "key": "a.b.c",
        }

        with patch.object(
            client,
            "api_call",
            side_effect=[
                {"session_id": "sess", "infos": "c2FsdA==.aW5mbw=="},
                segment_payload,
            ],
        ) as m_call, patch.object(
            client, "_derive_session_key", return_value=b"\x01" * 16
        ), patch.object(
            client, "_unwrap_track_key", return_value=b"\x02" * 16
        ):
            out = client.get_track_url(123, 27, force_segments=True)

        self.assertEqual(out["url_template"], segment_payload["url_template"])
        called = [c.args[0] for c in m_call.call_args_list]
        self.assertIn("session/start", called)
        self.assertIn("file/url", called)


if __name__ == "__main__":
    unittest.main()
