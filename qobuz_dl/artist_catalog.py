"""Metadata-only catalog of releases listed on selected Qobuz artist profiles."""
from copy import deepcopy
import re
from urllib.parse import urlparse


def normalize_artist_ids(values):
    if values is None:
        return []
    if not isinstance(values, list) or len(values) > 20:
        raise ValueError("Choose up to 20 artist profiles")
    ids = []
    for value in values:
        if isinstance(value, bool) or not isinstance(value, (str, int)):
            raise ValueError("Invalid Qobuz artist ID")
        value = str(value).strip()
        if not re.fullmatch(r"[0-9]{1,20}", value):
            raise ValueError("Invalid Qobuz artist ID")
        if value not in ids:
            ids.append(value)
    return ids


def profile_summary(meta):
    return {"id": str(meta["id"]), "name": str(meta.get("name") or "Unknown artist"),
            "albums": int(meta.get("albums_count") or 0)}


def search_profiles(client, query, offset=0, limit=20):
    """Search by name, or resolve a numeric ID / Qobuz artist-profile URL."""
    artist_id = query if re.fullmatch(r"[0-9]{1,20}", query) else None
    if "://" in query:
        url = urlparse(query)
        if url.scheme != "https" or not (url.hostname == "qobuz.com" or (url.hostname or "").endswith(".qobuz.com")):
            raise ValueError("Use a Qobuz artist-profile link")
        match = re.search(r"/artist/(?:[^/]+/)?([0-9]{1,20})/?$", url.path)
        if not match:
            raise ValueError("Use a Qobuz artist-profile link")
        artist_id = match.group(1)
    if artist_id:
        meta = client.api_call("artist/get", id=artist_id, offset=0)
        if not meta or str(meta.get("id")) != artist_id:
            raise ValueError("Artist profile not found")
        return {"artists": [profile_summary(meta)], "more": False}
    raw = client.search_artists(query, limit=limit, offset=offset)
    container = raw.get("artists") or {}
    items = container.get("items") or []
    total = container.get("total")
    return {"artists": [profile_summary(meta) for meta in items if meta.get("id")],
            "more": offset + len(items) < int(total) if total is not None else len(items) == limit}


class ArtistCatalog:
    def __init__(self, client, cancel_event, artist_ids):
        self.client, self.cancel = client, cancel_event
        self.artist_ids = normalize_artist_ids(artist_ids)
        self.tracks = {}
        self.state = {"profiles": [], "albums_total": 0, "albums_loaded": 0, "tracks": 0, "complete": False}

    def prepare(self, progress):
        albums = {}
        for artist_id in self.artist_ids:
            chunks = iter(self.client.get_artist_meta(artist_id))
            profile = None
            listed, expected = 0, 0
            while not self.cancel.is_set():
                meta = next(chunks, None)
                if meta is None:
                    break
                if str(meta.get("id")) != artist_id or not meta.get("name"):
                    raise ValueError(f"Could not read artist profile {artist_id}")
                if profile is None:
                    profile = profile_summary(meta)
                    self.state["profiles"].append(profile)
                container = meta.get("albums") or {}
                items = container.get("items") or []
                expected = max(expected, int(container.get("total") or meta.get("albums_count") or 0))
                listed += len(items)
                for album in items:
                    if album.get("id"):
                        albums.setdefault(str(album["id"]), album)
                self.state["albums_total"] = len(albums)
                progress(deepcopy(self.state))
            if self.cancel.is_set():
                return
            if profile is None:
                raise ValueError(f"Artist profile {artist_id} was not found")
            if listed < expected:
                raise ValueError(f"Incomplete release list for {profile['name']}; preview stopped")
        # Keep every returned edition, single and compilation; versions matter
        # when recovering ISRC. Shared albums are fetched only once.
        for album_id in albums:
            if self.cancel.is_set():
                return
            album = self.client.get_album_meta(album_id)
            container = album.get("tracks") or {}
            tracks = container.get("items") or []
            expected = max(int(album.get("tracks_count") or 0), int(container.get("total") or 0))
            if expected > len(tracks):
                raise ValueError(f"Incomplete track list for {album.get('title') or album_id}; preview stopped")
            context = {key: value for key, value in album.items() if key != "tracks"}
            for track in tracks:
                if track.get("id"):
                    self.tracks.setdefault(str(track["id"]), dict(track, album=context))
            self.state["albums_loaded"] += 1
            self.state["tracks"] = len(self.tracks)
            progress(deepcopy(self.state))
        if self.cancel.is_set():
            return
        self.state["complete"] = True
        progress(deepcopy(self.state))
