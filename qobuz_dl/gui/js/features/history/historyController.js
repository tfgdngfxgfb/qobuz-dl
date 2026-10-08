/**
 * History / track-status façade (H1 plug socket only).
 *
 * Exposes stable `QobuzGui.features.history.*` after `app.js` calls `install(impl)`.
 * Until install(), methods return safe defaults.
 *
 * History should own download-history row semantics via `historyHydratePersist.js`
 * (`countDownloadedForRelease` scans the in-memory DB map there).
 */
(function () {
  "use strict";
  const g = window.QobuzGui;
  const features = (g.features = g.features || {});

  let _impl = null;

  function install(impl) {
    _impl = impl;
  }

  function countDownloadedForRelease(releaseAlbumId) {
    if (!_impl || typeof _impl.countDownloadedForRelease !== "function") {
      return 0;
    }
    return _impl.countDownloadedForRelease(releaseAlbumId);
  }

  function applyFilter() {
    if (_impl && typeof _impl.applyFilter === "function") {
      return _impl.applyFilter();
    }
  }

  function ensureTrackCard(trackNo, title, createNew, coverUrl, lyricAlbum) {
    if (!_impl || typeof _impl.ensureTrackCard !== "function") {
      return null;
    }
    return _impl.ensureTrackCard(
      trackNo,
      title,
      createNew,
      coverUrl,
      lyricAlbum,
    );
  }

  function setDownloadChip(
    trackNo,
    title,
    statusText,
    cls,
    linkOpts,
    lyricAlbum,
  ) {
    if (!_impl || typeof _impl.setDownloadChip !== "function") {
      return;
    }
    _impl.setDownloadChip(
      trackNo,
      title,
      statusText,
      cls,
      linkOpts,
      lyricAlbum,
    );
  }

  function setLyricsChip(
    trackNo,
    title,
    lyricType,
    confidence,
    lyricAlbum,
    lyricProvider,
    lyricDestination,
    audioPath,
  ) {
    if (!_impl || typeof _impl.setLyricsChip !== "function") {
      return;
    }
    _impl.setLyricsChip(
      trackNo,
      title,
      lyricType,
      confidence,
      lyricAlbum,
      lyricProvider,
      lyricDestination,
      audioPath,
    );
  }

  features.history = {
    install,
    countDownloadedForRelease,
    applyFilter,
    ensureTrackCard,
    setDownloadChip,
    setLyricsChip,
  };
})();
