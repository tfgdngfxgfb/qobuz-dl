/**
 * Clear download history confirm popover (C1).
 *
 * Invoked once from `app.js` `initDownload()` via `bootstrapClearHistoryConfirm(deps)`.
 */
(function () {
  "use strict";
  const g = window.QobuzGui;
  g.features = g.features || {};
  g.features.history = g.features.history || {};
  g.features.history.internals = g.features.history.internals || {};

  function bootstrapClearHistoryConfirm(deps) {
    function positionClearHistoryConfirm() {
      const btn = document.getElementById("dl-clear-track-status");
      const pop = document.getElementById("dl-clear-history-confirm");
      if (!btn || !pop || pop.classList.contains("hidden")) return;
      const pad = 8;
      const r = btn.getBoundingClientRect();
      const vw = window.innerWidth;
      const mw = Math.min(280, vw - pad * 2);
      pop.style.top = `${Math.round(r.bottom + 6)}px`;
      let left = r.right - mw;
      left = Math.max(pad, Math.min(left, vw - pad - mw));
      pop.style.left = `${Math.round(left)}px`;
      pop.style.right = "auto";
    }

    function clearHistoryBackdrop(e) {
      const pop = document.getElementById("dl-clear-history-confirm");
      const btn = document.getElementById("dl-clear-track-status");
      if (!pop || pop.classList.contains("hidden")) return;
      if ((btn && btn.contains(e.target)) || pop.contains(e.target)) return;
      closeClearHistoryConfirm();
    }

    function clearHistoryEsc(e) {
      if (e.key === "Escape") closeClearHistoryConfirm();
    }

    function closeClearHistoryConfirm() {
      const pop = document.getElementById("dl-clear-history-confirm");
      const btn = document.getElementById("dl-clear-track-status");
      if (!pop || pop.classList.contains("hidden")) return;
      pop.classList.add("hidden");
      document.removeEventListener("mousedown", clearHistoryBackdrop);
      window.removeEventListener("resize", positionClearHistoryConfirm);
      document.removeEventListener("keydown", clearHistoryEsc);
      if (btn) {
        btn.setAttribute("aria-expanded", "false");
        btn.focus();
      }
    }

    function openClearHistoryConfirm() {
      const pop = document.getElementById("dl-clear-history-confirm");
      const btn = document.getElementById("dl-clear-track-status");
      if (!pop || !btn) return;
      pop.classList.remove("hidden");
      btn.setAttribute("aria-expanded", "true");
      positionClearHistoryConfirm();
      requestAnimationFrame(() => {
        document.getElementById("dl-clear-history-cancel")?.focus();
      });
      setTimeout(() => {
        document.addEventListener("mousedown", clearHistoryBackdrop);
        window.addEventListener("resize", positionClearHistoryConfirm);
        document.addEventListener("keydown", clearHistoryEsc);
      }, 0);
    }

    function init() {
      const clearTrackStatusBtn = document.getElementById("dl-clear-track-status");
      const clearHistoryConfirm = document.getElementById("dl-clear-history-confirm");
      const clearHistoryCancel = document.getElementById("dl-clear-history-cancel");
      const clearHistoryDo = document.getElementById("dl-clear-history-confirm-do");
      const onConfirmClear =
        deps && typeof deps.onConfirmClear === "function"
          ? deps.onConfirmClear
          : null;
      const dismissConfidenceTooltips =
        deps && typeof deps.dismissConfidenceTooltips === "function"
          ? deps.dismissConfidenceTooltips
          : null;

      if (clearTrackStatusBtn && clearHistoryConfirm) {
        clearTrackStatusBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (dismissConfidenceTooltips) dismissConfidenceTooltips();
          if (!clearHistoryConfirm.classList.contains("hidden")) {
            closeClearHistoryConfirm();
            return;
          }
          openClearHistoryConfirm();
        });
      }
      clearHistoryCancel?.addEventListener("click", () => {
        closeClearHistoryConfirm();
      });
      clearHistoryDo?.addEventListener("click", async () => {
        if (dismissConfidenceTooltips) dismissConfidenceTooltips();
        closeClearHistoryConfirm();
        if (onConfirmClear) await onConfirmClear();
      });
    }

    init();

    return {
      open: openClearHistoryConfirm,
      close: closeClearHistoryConfirm,
      init,
    };
  }

  g.features.history.internals.bootstrapClearHistoryConfirm =
    bootstrapClearHistoryConfirm;
})();
