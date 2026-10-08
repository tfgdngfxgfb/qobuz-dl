import re
import os
import logging

from mutagen.flac import FLAC, Picture
import mutagen.id3 as id3
from mutagen.id3 import ID3NoHeaderError
from mutagen.mp4 import MP4, MP4Cover
from qobuz_dl.gui_backend.utils import flac_fix_md5s, get_album_artist

logger = logging.getLogger(__name__)


# unicode symbols
COPYRIGHT, PHON_COPYRIGHT = "\u00a9", "\u2117"
# if a metadata block exceeds this, mutagen will raise error
# and the file won't be tagged
FLAC_MAX_BLOCKSIZE = 16777215

ID3_LEGEND = {
    "album": id3.TALB,
    "albumartist": id3.TPE2,
    "artist": id3.TPE1,
    "comment": id3.COMM,
    "composer": id3.TCOM,
    "copyright": id3.TCOP,
    "date": id3.TDAT,
    "genre": id3.TCON,
    "isrc": id3.TSRC,
    "mediatype": id3.TMED,
    "itunesadvisory": id3.TXXX,
    "barcode": id3.TXXX,
    "label": id3.TPUB,
    "performer": id3.TOPE,
    "title": id3.TIT2,
    "year": id3.TYER,
}

_DEFAULT_TAG_OPTIONS = {
    "no_album_artist_tag": False,
    "no_album_title_tag": False,
    "no_track_artist_tag": False,
    "no_track_title_tag": False,
    "no_release_date_tag": False,
    "no_media_type_tag": False,
    "no_genre_tag": False,
    "no_track_number_tag": False,
    "no_track_total_tag": False,
    "no_disc_number_tag": False,
    "no_disc_total_tag": False,
    "no_composer_tag": False,
    "no_explicit_tag": False,
    "no_copyright_tag": False,
    "no_label_tag": False,
    "no_upc_tag": False,
    "no_isrc_tag": False,
    "fix_md5s": False,
}


def _resolve_tag_options(tag_options):
    if not tag_options:
        return dict(_DEFAULT_TAG_OPTIONS)
    merged = dict(_DEFAULT_TAG_OPTIONS)
    for key in _DEFAULT_TAG_OPTIONS:
        if isinstance(tag_options, dict) and key in tag_options:
            merged[key] = bool(tag_options[key])
        elif hasattr(tag_options, key):
            merged[key] = bool(getattr(tag_options, key))
    return merged


def _get_title(track_dict):
    title = track_dict["title"]
    version = track_dict.get("version")
    if version:
        title = f"{title} ({version})"
    # for classical works
    if track_dict.get("work"):
        title = f"{track_dict['work']}: {title}"

    return title


def _format_copyright(s: str) -> str:
    if s:
        s = s.replace("(P)", PHON_COPYRIGHT)
        s = s.replace("(C)", COPYRIGHT)
    return s


def _format_genres(genres: list) -> str:
    """Fixes the weirdly formatted genre lists returned by the API.
    >>> g = ['Pop/Rock', 'Pop/Rock→Rock', 'Pop/Rock→Rock→Alternatif et Indé']
    >>> _format_genres(g)
    'Pop, Rock, Alternatif et Indé'
    """
    genres = re.findall(r"([^\u2192\/]+)", "/".join(genres))
    no_repeats = []
    [no_repeats.append(g) for g in genres if g not in no_repeats]
    return ", ".join(no_repeats)


def _embed_flac_img(root_dir, audio: FLAC):
    emb_image = os.path.join(root_dir, "cover.jpg")
    multi_emb_image = os.path.join(
        os.path.abspath(os.path.join(root_dir, os.pardir)), "cover.jpg"
    )
    if os.path.isfile(emb_image):
        cover_image = emb_image
    elif os.path.isfile(multi_emb_image):
        cover_image = multi_emb_image
    else:
        return

    try:
        if os.path.getsize(cover_image) > FLAC_MAX_BLOCKSIZE:
            logger.warning(
                "downloaded cover size too large to embed. "
                "turn off `og_cover` to avoid error"
            )
            return

        image = Picture()
        image.type = 3
        image.mime = "image/jpeg"
        image.desc = "cover"
        with open(cover_image, "rb") as img:
            image.data = img.read()
        audio.add_picture(image)
    except Exception as e:
        logger.debug("Skipping FLAC cover embed: %s", e)


def _embed_id3_img(root_dir, audio: id3.ID3):
    emb_image = os.path.join(root_dir, "cover.jpg")
    multi_emb_image = os.path.join(
        os.path.abspath(os.path.join(root_dir, os.pardir)), "cover.jpg"
    )
    if os.path.isfile(emb_image):
        cover_image = emb_image
    elif os.path.isfile(multi_emb_image):
        cover_image = multi_emb_image
    else:
        return

    try:
        with open(cover_image, "rb") as cover:
            audio.add(id3.APIC(3, "image/jpeg", 3, "", cover.read()))
    except OSError as e:
        logger.debug("Skipping MP3 cover embed: %s", e)


# Use KeyError catching instead of dict.get to avoid empty tags
def _canonical_tag(writer, filename, root_dir, final_name, d, album, istrack,
                   em_image, tag_options, tag_display_title, tag_display_album):
    from copy import deepcopy
    from qobuz_dl.settings import QobuzDLSettings
    options = _resolve_tag_options(tag_options)
    track = deepcopy(d)
    release = deepcopy(track.get("album") or {} if istrack else album)
    if tag_display_title:
        track["title"], track["version"] = tag_display_title, ""
    if tag_display_album:
        release["title"], release["version"] = tag_display_album, ""
    if istrack:
        track["album"] = release
    writer(filename, root_dir, final_name, track, release, istrack, em_image,
           settings=QobuzDLSettings(**options))
    if options["fix_md5s"] and str(final_name).lower().endswith(".flac"):
        flac_fix_md5s(final_name)


def tag_flac(filename, root_dir, final_name, d, album, istrack=True, em_image=False,
             tag_options=None, *, tag_display_title=None, tag_display_album=None):
    from qobuz_dl.metadata import tag_flac as writer
    _canonical_tag(writer, filename, root_dir, final_name, d, album, istrack,
                   em_image, tag_options, tag_display_title, tag_display_album)


def tag_mp3(filename, root_dir, final_name, d, album, istrack=True, em_image=False,
            tag_options=None, *, tag_display_title=None, tag_display_album=None):
    from qobuz_dl.metadata import tag_mp3 as writer
    _canonical_tag(writer, filename, root_dir, final_name, d, album, istrack,
                   em_image, tag_options, tag_display_title, tag_display_album)


def tag_m4a(filename, root_dir, final_name, d, album, istrack=True, em_image=False,
            tag_options=None, *, tag_display_title=None, tag_display_album=None):
    from qobuz_dl.mp4_metadata import tag_m4a as writer
    _canonical_tag(writer, filename, root_dir, final_name, d, album, istrack,
                   em_image, tag_options, tag_display_title, tag_display_album)


def _embed_mp4_img(root_dir, tags) -> None:
    emb_image = os.path.join(root_dir, "cover.jpg")
    multi_emb_image = os.path.join(
        os.path.abspath(os.path.join(root_dir, os.pardir)), "cover.jpg"
    )
    if os.path.isfile(emb_image):
        cover_image = emb_image
    elif os.path.isfile(multi_emb_image):
        cover_image = multi_emb_image
    else:
        return
    try:
        with open(cover_image, "rb") as cover:
            tags["covr"] = [MP4Cover(cover.read(), imageformat=MP4Cover.FORMAT_JPEG)]
    except OSError as e:
        logger.debug("Skipping M4A cover embed: %s", e)


def set_itunes_explicit_from_lyrics_content(audio_path: str, lyrics_text: str) -> bool:
    """If lyric text matches the explicit-vocabulary heuristic, set ITUNESADVISORY to 1."""
    from qobuz_dl.gui_backend import lyrics as lyrics_mod

    if not lyrics_mod.lyrics_text_indicates_explicit(lyrics_text or ""):
        return False
    return _set_audio_itunes_explicit_one(audio_path)


def write_lyrics_metadata(audio_path: str, lyrics_text: str) -> bool:
    """Embed lyric text in the audio file metadata.

    FLAC/Vorbis uses ``LYRICS``. MP3/ID3 uses ``USLT`` and keeps LRC timestamps
    in the text so synced lyric-capable players can still parse them.
    """
    body = (lyrics_text or "").strip()
    if not body:
        return False
    ext = os.path.splitext(audio_path or "")[1].lower()
    try:
        if ext == ".flac":
            audio = FLAC(audio_path)
            audio["LYRICS"] = body
            audio.save()
            return True
        if ext == ".mp3":
            try:
                audio = id3.ID3(audio_path)
            except ID3NoHeaderError:
                audio = id3.ID3()
            audio.delall("USLT")
            audio.add(id3.USLT(encoding=3, lang="eng", desc="", text=body))
            audio.save(audio_path, v2_version=4)
            return True
        if ext == ".m4a":
            audio = MP4(audio_path)
            if audio.tags is None:
                audio.add_tags()
            audio.tags["\xa9lyr"] = [body]
            audio.save()
            return True
    except Exception as e:
        logger.warning("Could not write embedded lyrics metadata: %s", e)
    return False


def _set_audio_itunes_explicit_one(audio_path: str) -> bool:
    ext = os.path.splitext(audio_path)[1].lower()
    try:
        if ext == ".flac":
            audio = FLAC(audio_path)
            audio["ITUNESADVISORY"] = "1"
            audio.save()
            return True
        if ext == ".mp3":
            try:
                audio = id3.ID3(audio_path)
            except ID3NoHeaderError:
                logger.warning("No ID3 header; skipping explicit tag update: %s", audio_path)
                return False
            audio.delall("TXXX:ITUNESADVISORY")
            audio.add(id3.TXXX(encoding=3, desc="ITUNESADVISORY", text="1"))
            audio.save(audio_path, v2_version=4)
            return True
    except Exception as e:
        logger.warning("Could not set ITUNESADVISORY from lyrics: %s", e)
    return False
