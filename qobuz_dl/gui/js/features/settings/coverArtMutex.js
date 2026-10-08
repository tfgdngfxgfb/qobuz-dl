/**
 * Cover art checkbox mutual exclusivity (S2A).
 *
 * "Skip Cover Art" is incompatible with "Write Art to Tracks" and "Full-Res Cover".
 * Wire for whichever prefix is passed ('dl' / 'cfg').
 */
(function () {
  "use strict";
  const QG = (window.QobuzGui = window.QobuzGui || {});
  QG.features = QG.features || {};
  const settings = (QG.features.settings = QG.features.settings || {});

  function init(prefix) {
    const embedArt = document.getElementById(`${prefix}-embed-art`);
    const ogCover = document.getElementById(`${prefix}-og-cover`);
    const noCover = document.getElementById(`${prefix}-no-cover`);
    if (!embedArt || !ogCover || !noCover) return;

    noCover.addEventListener("change", () => {
      if (noCover.checked) {
        embedArt.checked = false;
        ogCover.checked = false;
      }
    });

    embedArt.addEventListener("change", () => {
      if (embedArt.checked) noCover.checked = false;
    });
    ogCover.addEventListener("change", () => {
      if (ogCover.checked) noCover.checked = false;
    });
  }

  settings.coverArtMutex = { init };
})();
