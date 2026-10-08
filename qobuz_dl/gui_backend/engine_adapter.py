"""Keep GUI contracts while delegating audio downloads to Sei969's engine."""
from copy import deepcopy
from concurrent.futures import Future
import logging
import os
import re
import threading

from qobuz_dl.downloader import Download as UpstreamDownload
from qobuz_dl.exceptions import NonStreamable as UpstreamNonStreamable
from qobuz_dl.settings import QobuzDLSettings
from qobuz_dl.credits import track_artists
from qobuz_dl.utils import make_m3u
from qobuz_dl.mp4_metadata import tag_m4a
from qobuz_dl.lyrics_engine import LyricsEngine
from . import downloader as gui
from .exceptions import NonStreamable

logger = logging.getLogger(__name__)


def upstream_pattern(pattern):
    # The original GUI's documented placeholders remain usable.
    return (pattern.replace("{tracknumber}", "{track_number}")
            .replace("{disc_number_unpadded}", "{media_number}"))


class _Client:
    def __init__(self, client):
        self.client = client
        self.lock = threading.RLock()
        self.tracks = {}

    def __getattr__(self, name):
        return getattr(self.client, name)

    def get_track_url(self, *args, **kwargs):
        # Session initialization and API signatures share state in the GUI client.
        with self.lock:
            return self.client.get_track_url(*args, **kwargs)

    def get_track_meta(self, track_id):
        with self.lock:
            key = str(track_id)
            if key not in self.tracks:
                self.tracks[key] = self.client.get_track_meta(track_id)
            return deepcopy(self.tracks[key])


class _Engine(UpstreamDownload):
    def __init__(self, owner):
        self.owner = owner
        self.pending = []
        self.pending_lock = threading.Lock()
        self.slot = None
        self.had_completed = False
        settings = QobuzDLSettings(
            **owner.tag_options, max_workers=owner.max_workers,
            segmented_fallback=owner.segmented_fallback,
            delay=owner.delay_seconds, embed_art=owner.embed_art,
            no_cover=owner.no_cover, multi_value_tags=True,
            saved_art_size="org" if owner.cover_og_quality else "600",
            multiple_disc_prefix=owner.multiple_disc_prefix,
            multiple_disc_one_dir=owner.multiple_disc_one_dir,
            multiple_disc_track_format=upstream_pattern(owner.multiple_disc_track_format),
        )
        cancel = owner.cancel_event if owner.cancel_event is not None else threading.Event()
        super().__init__(
            _Client(owner.client), owner.item_id, owner.path, owner.quality,
            embed_art=owner.embed_art, albums_only=owner.albums_only,
            downgrade_quality=owner.downgrade_quality,
            no_cover=owner.no_cover, cover_og_quality=owner.cover_og_quality,
            folder_format=upstream_pattern(owner.folder_format),
            track_format=upstream_pattern(owner.track_format),
            no_credits=owner.no_credits, settings=settings,
            download_db=owner.download_db, cancel_event=cancel,
            abort_stream_event=owner._stream_abort_evt() or threading.Event(),
            on_track_complete=self._saved, on_release_complete=self._release_finished,
            progress_factory=self._progress,
        )

    def _get_filename_attr(self, track_artist, track, album):
        naming = self.slot or track
        values = UpstreamDownload._get_filename_attr(track_artist, naming, album)
        values["media_number"] = int(naming.get("media_number") or 1)
        return values

    @staticmethod
    def _get_track_attr(meta, title, bit_depth, sampling_rate, file_format):
        values = UpstreamDownload._get_track_attr(meta, title, bit_depth, sampling_rate, file_format)
        values.update(gui.Download._get_track_attr(meta, title, bit_depth, sampling_rate, file_format))
        return values

    def _progress(self, track, count, is_track, album):
        return gui._make_throttled_download_progress(
            self.slot or track, count, gui._get_title(self.slot or track),
            is_track=is_track, album_or_track_metadata=album,
        )

    def _track_failed(self, track, album, detail):
        logger.error("Track %s failed: %s", track.get("id"), detail)
        self._emit("", self.slot or track, album, False, "failed", detail)

    def _download_and_tag(self, root_dir, count, parse, track, album, is_track,
                          is_mp3, multiple=None, is_parallel=False):
        if self.cancel_event.is_set():
            return False
        try:
            # album/get can omit detailed credits. track/get supplies artists and ISRC.
            detailed = self.client.get_track_meta(track["id"])
            full = dict(track, **detailed)
            if str(full.get("id")) != str(track["id"]):
                raise ValueError("Qobuz returned metadata for a different track")
            if self.slot is None:
                full["track_number"] = track.get("track_number") or 1
                full["media_number"] = track.get("media_number") or 1
            release = full.get("album") or {} if is_track else album
            marker = self.slot or full
            gui._emit_track_start(
                marker.get("track_number", count), gui._get_title(marker),
                gui._album_cover_thumb(release),
                artist=", ".join(track_artists(full, release)),
                album=gui._get_title(release), duration_sec=full.get("duration") or 0,
                track_explicit=gui._track_explicit_flag(full),
                slot_track_id=str(marker.get("id") or ""),
            )
            ok = super()._download_and_tag(root_dir, count, parse, full,
                                           full if is_track else album, is_track,
                                           is_mp3, multiple, is_parallel)
            if not ok and not self.abort_event.is_set():
                self._track_failed(marker, release, "Download or metadata writing failed")
            return ok
        except Exception as error:
            self._track_failed(track, album, str(error))
            return False

    def _saved(self, path, track, album, is_track, status):
        release = track.get("album") or {} if is_track else album
        title = gui._track_metadata_display_title(track) if self.owner.tag_title_from_track_format else None
        album_title = (self.owner._album_tag_from_folder_format(track, album, is_track, {})
                       if self.owner.tag_album_from_folder_format else None)
        if title or album_title:
            writer = gui.metadata.tag_mp3 if path.lower().endswith(".mp3") else gui.metadata.tag_flac
            writer(path, os.path.dirname(path), path, track, album, is_track, False,
                   tag_options=self.owner.tag_options, tag_display_title=title,
                   tag_display_album=album_title)
        if self.owner.convert_to_alac and path.lower().endswith(".flac"):
            converted = gui._convert_flac_to_alac(path)
            if not converted:
                raise RuntimeError("Could not convert the downloaded FLAC to ALAC")
            tag_m4a(converted, os.path.dirname(path), converted, track, release,
                    False, self.embed_art, settings=self.settings)
            path = converted
        if self.owner.tag_options.get("fix_md5s") and path.lower().endswith(".flac"):
            gui.metadata.flac_fix_md5s(path)
        self.had_completed = True
        with self.pending_lock:
            self.pending.append((path, deepcopy(track), deepcopy(release), is_track, status))

    def _emit(self, path, track, release, is_track, status, detail=""):
        gui._emit_track_marker(
            "TRACK_RESULT", track.get("track_number", 1), gui._get_title(track),
            "downloaded" if status == "already_on_disk" else status,
            detail or ("already-exists" if status == "already_on_disk" else os.path.basename(path)),
            queue_url=self.owner.source_queue_url, local_path=path,
            lyric_album=gui._get_title(release), slot_track_id=str(track.get("id") or ""),
            album_release_id="" if is_track else str(self.item_id),
            substitute_attach=self.slot is not None,
        )

    def _release_finished(self, working_dir, final_dir):
        self.flush(working_dir, final_dir)

    def flush(self, working_dir=None, final_dir=None):
        with self.pending_lock:
            pending, self.pending = self.pending, []
        for path, track, release, is_track, status in pending:
            if working_dir and final_dir and working_dir != final_dir:
                path = os.path.join(final_dir, os.path.relpath(path, working_dir))
            self._emit(path, self.slot or track, release, is_track, status)
            if self.owner.lyrics_any_enabled and not self.abort_event.is_set():
                # Prefer the maintained engine's exact track-ID lookup. The GUI
                # writes the result so its toggles, history and ALAC support stay
                # consistent; its existing LRCLIB matcher handles the fallback.
                native = LyricsEngine()._fetch_qobuz_native(self.client, track.get("id"))
                if native:
                    result = Future()
                    result.set_result({
                        "lyrics": native, "provider": "Qobuz", "confidence": 100,
                        "lyrics_type": "synced" if re.search(r"\[\d+:\d+", native) else "plain",
                    })
                    self.owner._write_track_lyrics_sidecar(path, track, release,
                                                          lyrics_fetch_future=result)
                else:
                    self.owner._write_track_lyrics_sidecar(path, track, release)
        if pending and self.owner.write_m3u and final_dir:
            make_m3u(final_dir)


class Download(gui.Download):
    """Original GUI utilities; all audio transfer/tagging uses the upstream engine."""
    def __init__(self, *args, download_db=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.download_db = download_db

    def download_id_by_type(self, track=True):
        engine = _Engine(self)
        try:
            engine.download_id_by_type(track)
            if not engine.had_completed and not engine.cancel_event.is_set():
                logger.error("No audio files completed for %s", self.item_id)
        except UpstreamNonStreamable as error:
            raise NonStreamable(str(error)) from error
        finally:
            engine.flush()

    def _download_and_tag(self, root_dir, count, parse, track, album, is_track,
                          is_mp3, multiple=None, **kwargs):
        # The replacement UI keeps its album slot, while tags identify the audio
        # actually downloaded (in particular its artists, Qobuz ID and ISRC).
        engine = _Engine(self)
        stream_id = kwargs.get("stream_track_id")
        if stream_id:
            engine.slot = deepcopy(track)
            actual = self.client.get_track_meta(stream_id)
            track = actual
            album = actual.get("album") or album
        try:
            return engine._download_and_tag(root_dir, count, parse, track, album,
                                            is_track, is_mp3, multiple,
                                            kwargs.get("is_parallel", False))
        finally:
            engine.flush()
