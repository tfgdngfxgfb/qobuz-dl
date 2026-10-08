"""Match existing recordings and preview narrowly scoped metadata updates."""
from dataclasses import asdict, dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
import os
import re
import shutil
import tempfile
import unicodedata

from mutagen.flac import FLAC
from mutagen.id3 import ID3, ID3NoHeaderError, TPE1, TSRC
import mutagen.id3 as id3
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4, MP4FreeForm

from qobuz_dl.credits import artist_tags, normalize_isrc, track_artists
from qobuz_dl.artist_catalog import ArtistCatalog, normalize_artist_ids
from qobuz_dl.metadata import _format_copyright, _format_genres, _get_title_with_version
from qobuz_dl.settings import QobuzDLSettings


AUDIO_SUFFIXES = {".flac", ".mp3", ".m4a"}
BACKUP_DIR = ".qobuz-metadata-backup"
ISRC_ATOM = "----:com.apple.iTunes:ISRC"
QID_ATOM = "----:com.apple.iTunes:QOBUZTRACKID"
OTHER_FIELDS = {
    "TITLE": ("TIT2", "\xa9nam"), "ALBUM": ("TALB", "\xa9alb"),
    "ALBUMARTIST": ("TPE2", "aART"), "COMPOSER": ("TCOM", "\xa9wrt"),
    "DATE": ("TDRC", "\xa9day"), "GENRE": ("TCON", "\xa9gen"),
    "COPYRIGHT": ("TCOP", "cprt"),
    "LABEL": ("TPUB", "----:com.apple.iTunes:LABEL"),
    "BARCODE": ("TXXX:BARCODE", "----:com.apple.iTunes:BARCODE"),
    "PERFORMER": ("TOPE", "----:com.apple.iTunes:PERFORMER"),
}


def _strings(values):
    return [v.decode("utf-8", errors="replace") if isinstance(v, bytes) else str(v)
            for v in values or []]


def _first(values):
    return next((value.strip() for value in _strings(values) if value.strip()), "")


def _key(value):
    text = unicodedata.normalize("NFKD", str(value or "")).casefold()
    return " ".join(re.findall(r"\w+", "".join(c for c in text if not unicodedata.combining(c))))


def _title_key(value):
    # Featured names can be in old TITLE tags rather than in the artist list.
    return _key(re.sub(r"\s+(?:[\[(]\s*)?(?:feat\.?|ft\.?|featuring)\s+.*$", "", value or "", flags=re.I))


def valid_isrc(value):
    value = normalize_isrc(value)
    return value if re.fullmatch(r"[A-Z]{2}[A-Z0-9]{3}\d{7}", value) else ""


def _fingerprint(path):
    stat = path.stat()
    return (stat.st_size, stat.st_mtime_ns)


@dataclass
class LocalRecording:
    path: str
    relative_path: str
    title: str
    artists: list
    album: str
    isrc: str
    duration: float
    qobuz_id: str
    fingerprint: tuple
    other: dict = field(default_factory=dict)

    def public(self):
        values = asdict(self)
        values.pop("path")
        values.pop("fingerprint")
        return values


def read_recording(path, root=None, suffix=None):
    path = Path(path)
    suffix = suffix or path.suffix.lower()
    if suffix == ".flac":
        audio = FLAC(path)
        title, artists, album = _first(audio.get("title")), _strings(audio.get("artist")), _first(audio.get("album"))
        isrc, qid = _first(audio.get("isrc")), _first(audio.get("qobuztrackid"))
        other = {key: _strings(audio.get(key)) for key in OTHER_FIELDS}
    elif suffix == ".mp3":
        audio = MP3(path)
        tags = audio.tags or {}
        def frame(name):
            item = tags.get(name)
            return _strings(item.text) if item is not None else []
        title, artists, album = _first(frame("TIT2")), frame("TPE1"), _first(frame("TALB"))
        isrc, qid = _first(frame("TSRC")), _first(frame("TXXX:QOBUZTRACKID"))
        other = {key: frame(names[0]) for key, names in OTHER_FIELDS.items()}
    elif suffix == ".m4a":
        audio = MP4(path)
        title, artists, album = _first(audio.get("\xa9nam")), _strings(audio.get("\xa9ART")), _first(audio.get("\xa9alb"))
        isrc, qid = _first(audio.get(ISRC_ATOM)), _first(audio.get(QID_ATOM))
        other = {key: _strings(audio.get(names[1])) for key, names in OTHER_FIELDS.items()}
    else:
        raise ValueError("Supported files: FLAC, MP3 and M4A")
    relative = str(path.relative_to(root)) if root else path.name
    return LocalRecording(str(path), relative, title, artists, album, isrc,
                          float(audio.info.length), qid, _fingerprint(path), other)


def library_files(root):
    root = Path(root).expanduser().resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Choose a folder containing audio files")
    for folder, directories, filenames in os.walk(root, followlinks=False):
        directories[:] = sorted(name for name in directories
                                if name != BACKUP_DIR and not Path(folder, name).is_symlink()
                                and Path(folder, name).resolve().is_relative_to(root))
        for name in sorted(filenames):
            path = Path(folder, name)
            if path.suffix.lower() in AUDIO_SUFFIXES and not path.is_symlink():
                resolved = path.resolve()
                if resolved.is_relative_to(root):
                    yield resolved


def candidate_from_track(track):
    album = track.get("album") or {}
    title = str(track.get("title") or "")
    version = str(track.get("version") or "")
    if version and _key(version) not in _key(title):
        title += f" ({version})"
    credits = artist_tags(track, album, QobuzDLSettings())
    genre = _format_genres(album.get("genres_list") or [(album.get("genre") or {}).get("name") or ""])
    additional = {
        "TITLE": [title], "ALBUM": [_get_title_with_version(album.get("title") or "", album.get("version") or "")],
        "ALBUMARTIST": credits.get("ALBUMARTIST", []), "COMPOSER": credits.get("COMPOSER", []),
        "DATE": [track.get("release_date_original") or album.get("release_date_original") or ""],
        "GENRE": [genre], "COPYRIGHT": [_format_copyright(track.get("copyright") or album.get("copyright") or "")],
        "LABEL": [(album.get("label") or {}).get("name") or ""],
        "BARCODE": [str(album.get("upc") or "")], "PERFORMER": [track.get("performers") or ""],
    }
    return {"id": str(track.get("id") or ""), "title": title,
            "artists": track_artists(track, album), "album": additional["ALBUM"][0],
            "isrc": valid_isrc(track.get("isrc")), "duration": float(track.get("duration") or 0),
            "other": additional}


def assess_match(local, candidate, profile_names=()):
    title_equal = bool(local.title) and _title_key(local.title) == _title_key(candidate["title"])
    old_names = {_key(name) for name in local.artists if _key(name)}
    new_names = {_key(name) for name in candidate["artists"] if _key(name)}
    artist_equal = bool(old_names & new_names)
    if not artist_equal:
        # Only compare combined credit strings here; never split stored band names.
        combined = " ".join(old_names)
        artist_equal = any(re.search(r"(?:^|\s)" + re.escape(name) + r"(?:$|\s)", combined)
                           for name in new_names if len(name) > 2)
    profile_equal = bool(candidate.get("profile_match") or new_names & {_key(name) for name in profile_names})
    album_equal = bool(local.album) and _key(local.album) == _key(candidate["album"])
    duration_equal = local.duration > 0 and candidate["duration"] > 0 and abs(local.duration - candidate["duration"]) <= 2
    isrc_equal = bool(valid_isrc(local.isrc)) and valid_isrc(local.isrc) == candidate["isrc"]
    conflict = bool(valid_isrc(local.isrc) and candidate["isrc"] and not isrc_equal)
    score = (35 if title_equal else round(15 * SequenceMatcher(None, _title_key(local.title), _title_key(candidate["title"])).ratio()))
    score += 25 * (artist_equal or profile_equal) + 20 * album_equal + 20 * duration_equal
    strong = (isrc_equal and title_equal and duration_equal) or (title_equal and (artist_equal or profile_equal) and album_equal and duration_equal)
    if local.qobuz_id and local.qobuz_id == candidate["id"]:
        strong = title_equal and duration_equal
    reasons = []
    for matches, label in ((title_equal, "title"), (artist_equal, "artist"), (album_equal, "album"), (duration_equal, "duration")):
        if matches:
            reasons.append(label)
    if isrc_equal:
        reasons.append("existing ISRC")
    if profile_equal:
        reasons.append("selected artist profile")
    if conflict:
        reasons.append("different existing ISRC")
    return dict(candidate, score=score, strong=bool(strong and not conflict),
                isrc_conflict=conflict, evidence=reasons)


class RecordingMatcher:
    def __init__(self, client, cancel_event, artist_ids=None):
        self.client = client
        self.cancel_event = cancel_event
        self.search_cache = {}
        self.track_cache = {}
        self.artist_ids = normalize_artist_ids(artist_ids)
        self.catalog = ArtistCatalog(client, cancel_event, self.artist_ids) if self.artist_ids else None
        self.catalog_candidates = []
        self.profile_names = []

    def prepare_profiles(self, progress):
        if self.catalog:
            self.catalog.prepare(progress)
            self.profile_names = [p["name"] for p in self.catalog.state["profiles"]]
            self.catalog_candidates = []
            for track in self.catalog.tracks.values():
                candidate = candidate_from_track(track)
                candidate["profile_match"] = self._belongs_to_profile(track, candidate)
                self.catalog_candidates.append(candidate)

    def _belongs_to_profile(self, track, candidate):
        return str((track.get("performer") or {}).get("id")) in self.artist_ids or bool(
            {_key(a) for a in candidate["artists"]}.intersection(_key(n) for n in self.profile_names))

    def _profile_ids(self, local, query):
        if not self.catalog.state["complete"]:
            raise ValueError("Artist catalog preview is incomplete")
        pool = self.catalog_candidates
        if query:
            words = _key(query).split()
            pool = [c for c in pool if all(word in _key(" ".join([c["title"], *c["artists"], c["album"]])) for word in words)]
        ranked = sorted((assess_match(local, c, self.profile_names) for c in pool), key=lambda c: c["score"], reverse=True)
        # Read all exact title/ISRC editions, including those beyond the usual
        # shortlist, so a repeated title cannot hide a conflicting recording.
        exact = [c["id"] for c in ranked if (local.title and _title_key(local.title) == _title_key(c["title"]))
                 or (valid_isrc(local.isrc) and valid_isrc(local.isrc) == c["isrc"]) or local.qobuz_id == c["id"]]
        return list(dict.fromkeys(exact + [c["id"] for c in ranked[:8]]))

    def find(self, local, query=None):
        if not local.title and not local.qobuz_id and not query:
            return []
        if self.catalog:
            ids = self._profile_ids(local, query)
        elif local.qobuz_id and not query:
            ids = [local.qobuz_id]
        else:
            query = query or " ".join(filter(None, [local.title, local.artists[0] if local.artists else ""]))
            if query not in self.search_cache:
                self.search_cache[query] = (self.client.search_tracks(query, limit=30, offset=0).get("tracks") or {}).get("items") or []
            provisional = [assess_match(local, candidate_from_track(track)) for track in self.search_cache[query] if track.get("id")]
            ids = [candidate["id"] for candidate in sorted(provisional, key=lambda c: c["score"], reverse=True)[:8]]
        result = []
        for track_id in dict.fromkeys(ids):
            if self.cancel_event.is_set():
                break
            if track_id not in self.track_cache:
                self.track_cache[track_id] = self.client.get_track_meta(track_id)
            track = self.track_cache[track_id]
            candidate = candidate_from_track(track)
            if candidate["id"] != str(track_id):
                continue
            if self.catalog:
                if not self._belongs_to_profile(track, candidate):
                    continue
                candidate["profile_match"] = True
            result.append(assess_match(local, candidate, self.profile_names))
        return sorted(result, key=lambda c: (c["strong"], c["score"]), reverse=True)


def recommended_candidate(candidates):
    strong = [candidate for candidate in candidates if candidate["strong"] and not candidate["isrc_conflict"]]
    if not strong:
        return None
    if len(strong) == 1:
        return strong[0]["id"]
    # Multiple editions with the same explicit ISRC identify the same recording.
    isrcs = {candidate["isrc"] for candidate in strong}
    return strong[0]["id"] if len(isrcs) == 1 and "" not in isrcs else None


def proposed_changes(local, candidate, fill_other=False):
    changes = {}
    if candidate["artists"] and local.artists != candidate["artists"]:
        changes["artists"] = candidate["artists"]
    if not local.isrc.strip() and candidate["isrc"]:
        changes["isrc"] = candidate["isrc"]
    if fill_other:
        additional = {key: values for key, values in (candidate.get("other") or {}).items()
                      if key in OTHER_FIELDS and any(str(v).strip() for v in values)
                      and not any(str(v).strip() for v in local.other.get(key, []))}
        if additional:
            changes["other"] = additional
    return changes


def _check_id3_conversion(tags):
    # These old frames have no lossless v2.4 mapping in Mutagen. Chapter
    # subframes need the same checks as top-level tags before conversion.
    obsolete = {"RVAD", "EQUA", "TRDA", "TSIZ"}
    if tags.unknown_frames or obsolete.intersection(tags):
        raise ValueError("This older MP3 has unsupported ID3 frames; skipped to preserve them")
    for frame in tags.getall("CHAP") + tags.getall("CTOC"):
        _check_id3_conversion(frame.sub_frames)


def write_changes(local, candidate, root, job_id, backup=True, fill_other=False):
    """Write an approved proposal atomically; preserve all unrelated tags and audio."""
    root = Path(root).resolve(strict=True)
    path = Path(local.path)
    if path.is_symlink() or path.resolve() != path or not path.is_relative_to(root):
        raise ValueError("File is outside the selected folder")
    if _fingerprint(path) != local.fingerprint:
        raise ValueError("File changed since preview; scan the folder again")
    if candidate.get("isrc_conflict"):
        raise ValueError("Qobuz ISRC conflicts with the existing ISRC; no changes written")
    changes = proposed_changes(local, candidate, fill_other)
    if not changes:
        return {"state": "unchanged", "backup_path": ""}
    descriptor, temporary = tempfile.mkstemp(prefix=".qobuz-repair-", suffix=".tmp", dir=path.parent)
    os.close(descriptor)
    backup_path = ""
    try:
        shutil.copy2(path, temporary)
        suffix = path.suffix.lower()
        if suffix == ".flac":
            tags = FLAC(temporary)
            if "artists" in changes:
                tags["ARTIST"] = changes["artists"]
            if "isrc" in changes:
                tags["ISRC"] = changes["isrc"]
            for key, values in changes.get("other", {}).items():
                tags[key] = values
            tags.save()
        elif suffix == ".mp3":
            try:
                tags = ID3(temporary, translate=False)
            except ID3NoHeaderError:
                tags = ID3()
            if tags.version[1] != 4:
                _check_id3_conversion(tags)
                tags.update_to_v24()
            with open(temporary, "rb") as source:
                source.seek(-128, os.SEEK_END)
                legacy = source.read(128)
            legacy = legacy if legacy.startswith(b"TAG") else None
            if "artists" in changes:
                tags.setall("TPE1", [TPE1(encoding=3, text=changes["artists"])])
            if "isrc" in changes:
                tags.setall("TSRC", [TSRC(encoding=3, text=[changes["isrc"]])])
            for key, values in changes.get("other", {}).items():
                name = OTHER_FIELDS[key][0]
                if name.startswith("TXXX:"):
                    tags.add(id3.TXXX(encoding=3, desc=name.split(":", 1)[1], text=values))
                else:
                    tags.add(getattr(id3, name)(encoding=3, text=values))
            tags.save(temporary, v2_version=4)
            if legacy:
                # Mutagen updates ID3v1 by default; keep its existing data too.
                with open(temporary, "r+b") as source:
                    source.seek(-128, os.SEEK_END)
                    if not source.read(3) == b"TAG":
                        raise ValueError("Could not preserve the original ID3v1 tag")
                    source.seek(-128, os.SEEK_END)
                    source.write(legacy)
        elif suffix == ".m4a":
            tags = MP4(temporary)
            if "artists" in changes:
                tags["\xa9ART"] = changes["artists"]
            if "isrc" in changes:
                tags[ISRC_ATOM] = [MP4FreeForm(changes["isrc"].encode("utf-8"))]
            for key, values in changes.get("other", {}).items():
                name = OTHER_FIELDS[key][1]
                tags[name] = [MP4FreeForm(str(v).encode("utf-8")) for v in values] if name.startswith("----:") else values
            tags.save()
        else:
            raise ValueError("Unsupported audio format")
        verified = read_recording(temporary, suffix=suffix)
        if ("artists" in changes and verified.artists != changes["artists"]) or ("isrc" in changes and verified.isrc != changes["isrc"]):
            raise ValueError("Could not verify the written metadata")
        for key, values in changes.get("other", {}).items():
            if verified.other.get(key) != values:
                raise ValueError(f"Could not verify {key}")
        if _fingerprint(path) != local.fingerprint:
            raise ValueError("File changed while preparing the update; scan again")
        if backup:
            destination = root / BACKUP_DIR / job_id / path.relative_to(root)
            if not destination.resolve().is_relative_to(root) or destination.exists():
                raise ValueError("Backup destination is unavailable")
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)
            backup_path = str(destination.relative_to(root))
        if _fingerprint(path) != local.fingerprint:
            raise ValueError("File changed while preparing the backup; scan again")
        os.replace(temporary, path)
        return {"state": "updated", "backup_path": backup_path}
    finally:
        if os.path.isfile(temporary):
            os.unlink(temporary)
