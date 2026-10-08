/**
 * Setup overlay auth method tabs (S1).
 */
(function () {
  "use strict";
  const QG = (window.QobuzGui = window.QobuzGui || {});
  QG.features = QG.features || {};
  QG.features.setup = QG.features.setup || {};

  function init() {
    document.querySelectorAll(".auth-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document
          .querySelectorAll(".auth-tab")
          .forEach((t) => t.classList.remove("active"));
        document
          .querySelectorAll(".auth-panel")
          .forEach((p) => p.classList.add("hidden"));
        tab.classList.add("active");
        document
          .getElementById("auth-panel-" + tab.dataset.auth)
          .classList.remove("hidden");
      });
    });
  }

  QG.features.setup.authTabs = { init };
})();
