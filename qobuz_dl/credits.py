"""Map explicit Qobuz credits without splitting commas or '&' in band names."""
import re


def role(value):
    return re.sub(r"[^a-z]", "", str(value).casefold())


PERFORMING_ROLES = {
    "vocals", "vocal", "leadvocals", "backgroundvocals", "backingvocals",
    "choir", "orchestra", "ensemble", "conductor", "guitar", "electricguitar",
    "acousticguitar", "bass", "bassguitar", "drums", "piano", "keyboards",
    "synthesizer", "percussion", "violin", "cello", "saxophone", "trumpet",
    "flute", "organ", "programming",
}
ARTIST_ROLES = {"mainartist", "featuredartist", "primaryartist", "artist", "associatedperformer", "performer"} | PERFORMING_ROLES
COMPOSER_ROLES = {"composer", "composerlyricist"}
KNOWN_ROLES = ARTIST_ROLES | COMPOSER_ROLES | {
    "vocals", "vocal", "leadvocals", "backgroundvocals", "backingvocals",
    "choir", "orchestra", "ensemble", "conductor", "lyricist", "arranger",
    "producer", "coproducer", "executiveproducer", "recordingengineer",
    "mixingengineer", "masteringengineer", "engineer", "guitar",
    "electricguitar", "acousticguitar", "bass", "bassguitar", "drums",
    "piano", "keyboards", "synthesizer", "percussion", "violin", "cello",
    "saxophone", "trumpet", "flute", "organ", "programming", "remixer",
    "musicpublisher",
}


def unique_names(values):
    result, seen = [], set()
    for value in values:
        name = str(value or "").strip()
        if name and name.casefold() not in seen:
            result.append(name)
            seen.add(name.casefold())
    return result


def performer_credits(text):
    result = []
    for block in str(text or "").split(" - "):
        parts = [part.strip() for part in block.split(", ")]
        known = [n for n in range(1, len(parts)) if role(parts[n]) in KNOWN_ROLES]
        if known:
            boundary = known[-1]
            while boundary > 1 and role(parts[boundary - 1]) in KNOWN_ROLES:
                boundary -= 1
            result.append((", ".join(parts[:boundary]), [role(p) for p in parts[boundary:]]))
    return result


def structured_artists(metadata, accepted_roles):
    names = []
    for artist in metadata.get("artists") or []:
        if not isinstance(artist, dict):
            continue
        roles = artist.get("roles") or []
        if isinstance(roles, str):
            roles = [roles]
        if {role(r) for r in roles} & accepted_roles:
            names.append(artist.get("name"))
    return unique_names(names)


def album_artists(album):
    return structured_artists(album, {"mainartist", "primaryartist"}) or unique_names([(album.get("artist") or {}).get("name")])


def track_artists(track, album):
    explicit = unique_names(structured_artists(track, ARTIST_ROLES) + [
        name for name, roles in performer_credits(track.get("performers"))
        if set(roles) & ARTIST_ROLES
    ])
    main = (track.get("performer") or {}).get("name") or (track.get("artist") or {}).get("name")
    if main and explicit:
        parts = unique_names(re.split(r"\s+(?:&|feat\.?|ft\.?|featuring)\s+|,\s*", main, flags=re.I))
        if len(parts) > 1 and {p.casefold() for p in parts} <= {p.casefold() for p in explicit}:
            main = None
    return unique_names([main] + explicit) or album_artists(album)


def artist_tags(track, album, settings):
    tags = {}
    if not settings.no_album_artist_tag:
        tags["ALBUMARTIST"] = album_artists(album)
    if not settings.no_track_artist_tag:
        tags["ARTIST"] = track_artists(track, album)
        if track.get("performers"):
            tags["PERFORMER"] = track["performers"]
    if not settings.no_composer_tag:
        tags["COMPOSER"] = unique_names([
            name for name, roles in performer_credits(track.get("performers"))
            if set(roles) & COMPOSER_ROLES
        ]) or unique_names([(track.get("composer") or {}).get("name")])
    return tags


def normalize_isrc(value):
    original = str(value or "").strip()
    normalized = re.sub(r"[\s-]", "", original).upper()
    return normalized if re.fullmatch(r"[A-Z]{2}[A-Z0-9]{3}\d{7}", normalized) else original
