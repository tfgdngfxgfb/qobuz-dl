# GUI integration on the Sei969 foundation

The working branch is based on `Sei969/qobuz-dl` commit
`e21f92aeb2413eba8d826663607cd6466f7dcec8` (2.5.9).
The GUI and its supporting services were imported from `peykc/qobuz-dl-gui`
commit `032c566ed61d2bb353a8d9bc7af24292f9dc0022` (1.4.1).
Both projects retain their existing GPL attribution and history.

## Where the code lives

- `qobuz_dl/`: Sei969's downloader, CLI, API client, settings and supporting tools.
- `qobuz_dl/gui/`: the original GUI's HTML, CSS and JavaScript.
- `qobuz_dl/gui_backend/`: the original GUI's login, search, queue, history,
  preferences and lyric tools. Its old downloader provides GUI utilities such
  as missing-track placeholders; normal and replacement audio downloads enter
  `engine_adapter.py` and use the upstream downloader.
- `qobuz_dl/credits.py`: role-aware credit mapping shared by the CLI and GUI.
- `qobuz_dl/mp4_metadata.py`: the same metadata mapped to ALAC/MP4 atoms.

The GUI's OAuth/token login remains in its compatibility client. The adapter
passes that authenticated client to the upstream engine. Downloads fetch
`track/get` details as well as the album listing so that credits and ISRC are
available even when `album/get` omits them.

## Metadata behavior

Track artists include the principal artists, guests and explicitly credited
performers, including vocals and instruments. Each artist is a separate FLAC,
ID3v2.4 or MP4 value. Composer/engineer-only credits retain their own roles.
Band names containing commas, ampersands or slashes stay intact. Album artists
come from the album's main-artist credits. The original full performer string
is also saved in `PERFORMER`, preserving the remaining roles and credits.

ISRC comes from the downloaded track's API metadata. Valid codes are normalized
to uppercase without spaces/hyphens; missing codes are left absent. A manually
selected replacement keeps the actual replacement recording's artists, title,
Qobuz ID and ISRC; the GUI history still associates it with the requested slot.

MP3 uses ID3v2.4 to preserve separate artists and complete dates, including after
the GUI adds lyrics. FLAC and ALAC use per-disc track totals. The default title
and album tags use source metadata; existing user choices to derive titles from
format patterns remain available.

## Existing files without Qobuz IDs

The GUI's **Update artists & ISRC** tool is implemented in `metadata_repair.py`,
with background jobs and API routes in `gui_backend`. It reuses the authenticated
GUI client, full `track/get` metadata and the shared credit parser. It searches
by existing title and artist, comparing album and measured audio duration.
Existing Qobuz IDs are used when present; they are not written into updated files.

Optional selected artist profiles are handled by `artist_catalog.py`. All
`get_artist_meta` pages are consumed, album IDs are deduplicated, and each
returned release's track list is read without the downloader's discography
filters. Profile-scoped searches retain every exact-title edition before
fetching full track details, so the shortlist cannot hide conflicting ISRCs.
Full credits or a performer ID must associate a proposed track with a selected
profile; unrelated tracks from compilations are excluded. A selected profile
can replace missing artist evidence, but title, album and duration still need
to match. Incomplete catalog responses stop the preview rather than producing
recommendations from a partial catalog. Catalog loading supports cancellation.

The metadata folder is persisted in `metadata_repair_preferences.json`, separate
from download configuration. The frontend never derives it from `default_folder`
and preview/write operations never update that setting. It starts empty when
there is no saved metadata folder.

The scan only creates a preview. A unique title/artist/album/duration match is
recommended; matches identifying different ISRC recordings require a manual
choice. Matching ISRC can identify editions of the same recording, while a
conflicting existing ISRC blocks writing. A recommendation is evidence for
review, not a guarantee that an old file contains that recording.

Approved writes replace ARTIST and fill missing ISRC. Other fields are left
alone unless the user enables filling empty text tags; existing values stay
untouched. Each write is prepared in a sibling temporary file, read back and
replaces the original after checking that the previewed file has not changed.
Full original-file backups are on by default. Cover art and audio are preserved;
there is no download, rename, audio conversion or database synchronization.
Older MP3 tags with unsupported frames are skipped rather than losing those
frames during conversion to ID3v2.4.

## Upstream changes kept small

The upstream downloader has optional callbacks for completed tracks and final
album folders, progress reporting, and per-job cancellation. Pause finishes
active audio transfers; Cancel interrupts them. An externally cancelled album
is left incomplete and is not added to the completed-download database. Library
cancellation raises/returns instead of terminating the GUI process.

Metadata writers use the shared credit parser and ID3v2.4. SQLite helpers close
connections after their transaction, which avoids lingering Windows file locks.
Playlist generation also reads ALAC metadata and uses API order when supplied.
The CLI entry point is loaded lazily so importing the GUI does not start CLI
initialization.

The interface opens before saved-account authentication. Config readers accept
UTF-8 (including a BOM) and older Windows encodings; future GUI saves use UTF-8.
This preserves paths with Norwegian characters in existing installations.

GUI lyric retrieval first uses Sei969's native Qobuz lookup by track ID, then the
existing GUI LRCLIB matching service. The GUI's lyric destination switches and
history remain in use. Metadata injection preserves the multi-artist tags.

## Validation

Run `python -m pytest tests -q` in the project environment. FFmpeg is required
for the real-file metadata and integration tests. Tests use generated silence
and a fake Qobuz API; they do not require credentials or download commercial
recordings. They cover file readback, all artists, band-name preservation, ISRC,
dates, credits, disc totals, replacements, playlist order, failures, cancellation
and pause, alongside the original GUI contract tests.

Existing-file tests also check ambiguous versions, preserving existing ISRC and
all unrelated tags and artwork, optional empty tags, stale previews, failed
writes, exact backups and SHA-256 hashes of the encoded audio packets for FLAC,
MP3 and ALAC. GUI smoke tests use generated silence and a synthetic catalog.
Profile tests cover multiple profiles, paginated releases, shared albums,
incomplete old artist tags, alternative artist names, compilation filtering,
ambiguity beyond the shortlist, cancellation, incomplete catalog responses,
profile-link lookup and independent folder persistence.

An actual account/region and its live streaming responses must still be checked
by signing in and downloading an available track through the GUI.

## Continuing maintenance

`origin` points to `tfgdngfxgfb/qobuz-dl`; `upstream` points to Sei969.
`gui-origin`, `gui-upstream`, and branch `gui-original` retain the original GUI
sources. Fetch upstream and merge its updates into `master`, then
run the tests. Review changes to downloader callbacks and metadata explicitly.
The GUI's update checker points to this fork's releases.
