"""Write the same canonical Qobuz metadata to ALAC/MP4 files."""
import os
from mutagen.mp4 import MP4, MP4Cover
from qobuz_dl.metadata import _get_tags_to_add, _disc_track_total
from qobuz_dl.settings import QobuzDLSettings


def tag_m4a(filename, root_dir, final_name, track, album, istrack=True,
            em_image=False, settings=None):
    settings = settings or QobuzDLSettings()
    album = track.get("album") or {} if istrack else album
    values = _get_tags_to_add(album, track, settings)
    audio = MP4(filename)
    if audio.tags is None:
        audio.add_tags()
    atoms = {"TITLE": "\u00a9nam", "ALBUM": "\u00a9alb", "ARTIST": "\u00a9ART",
             "ALBUMARTIST": "aART", "COMPOSER": "\u00a9wrt", "DATE": "\u00a9day",
             "GENRE": "\u00a9gen", "COPYRIGHT": "cprt", "WORK": "\u00a9wrk"}
    for key, value in values.items():
        if not value:
            continue
        strings = [str(v) for v in value] if isinstance(value, list) else [str(value)]
        if key in atoms:
            audio[atoms[key]] = strings
        elif key == "COMPILATION":
            audio["cpil"] = True
        elif key == "ITUNESADVISORY":
            audio["rtng"] = [int(value)]
        else:
            audio["----:com.apple.iTunes:" + key] = [v.encode("utf-8") for v in strings]
    if not settings.no_track_number_tag:
        total = 0 if settings.no_track_total_tag else int(_disc_track_total(album, track))
        audio["trkn"] = [(int(track.get("track_number") or 1), total)]
    if not settings.no_disc_number_tag:
        total = 0 if settings.no_disc_total_tag else int(album.get("media_count") or 1)
        audio["disk"] = [(int(track.get("media_number") or 1), total)]
    if em_image:
        for directory in (root_dir, os.path.dirname(root_dir)):
            for name in ("embed_cover.jpg", "cover.jpg"):
                cover = os.path.join(directory, name)
                if os.path.isfile(cover):
                    with open(cover, "rb") as source:
                        audio["covr"] = [MP4Cover(source.read(), imageformat=MP4Cover.FORMAT_JPEG)]
                    break
            if "covr" in audio:
                break
    audio.save()
    if os.path.abspath(filename) != os.path.abspath(final_name):
        os.rename(filename, final_name)
