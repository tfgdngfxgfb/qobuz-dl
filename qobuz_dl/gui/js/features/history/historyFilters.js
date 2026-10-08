/**
 * Download history filters: All / Errors tab, error classification, badge (H4).
 *
 * Invoked once from `app.js` `initDownload()` via `bootstrapFilters(deps)`.
 */
(function () {
  "use strict";
  const g = window.QobuzGui;
  const hroot = (g.features.history = g.features.history || {});

  function bootstrapFilters(deps) {
    const ti = g.core.trackIdentity;
    const trackKeyStem = ti.trackKeyStem;
    const cardForHistoryKey = ti.cardForHistoryKey;
    const GUI_PENDING = deps.guiPendingAudioPrefix;

    let filterMode = "all";

    function mountedCardShowsDlTerminal(card) {
      if (!card) return false;
      return Boolean(
        card.querySelector("a.download-chip.purchase-only") ||
          card.querySelector("button.download-chip.track-dl-btn--failed"),
      );
    }

    function computeErrorStemContext() {
      const unsettledStems = new Set();
      const dlTerminalErrStems = new Set();
      const activeDlKeys = deps.getActiveDlKeys();
      const cardMap = deps.getCardMap();
      for (const k of activeDlKeys) {
        const st = trackKeyStem(k);
        if (st) unsettledStems.add(st);
      }
      for (const k of cardMap.keys()) {
        const card = cardMap.get(k);
        if (!card) continue;
        const st = trackKeyStem(k);
        if (!st) continue;
        if (card.querySelector(".lyrics-chip.loading")) unsettledStems.add(st);
        const dlBtn = card.querySelector(
          "button.download-chip.track-dl-btn.track-dl-btn--active",
        );
        if (dlBtn) unsettledStems.add(st);
        if (mountedCardShowsDlTerminal(card)) dlTerminalErrStems.add(st);
      }
      return { unsettledStems, dlTerminalErrStems };
    }

    function dbDownloadOutcomeError(it) {
      if (!it) return false;
      const st = String(it.download_status || "").toLowerCase();
      if (st === "purchase_only" || st === "failed") return true;
      const ap = String(it.audio_path || "").trim();
      return ap.startsWith(GUI_PENDING);
    }

    function dbItemIsError(it) {
      if (dbDownloadOutcomeError(it)) return true;
      const lt = String(it.lyric_type || "").toLowerCase();
      return lt === "error";
    }

    function cardLooksLikeError(card) {
      if (!card) return false;
      if (mountedCardShowsDlTerminal(card)) return true;
      if (card.querySelector(".lyrics-chip.error")) return true;
      return false;
    }

    function dbItemForHistoryKey(dbMap, key) {
      const k = String(key || "").trim();
      if (!k) return null;
      if (dbMap.has(k)) return dbMap.get(k) || null;
      const stem = trackKeyStem(k);
      if (!stem) return null;
      for (const [mapKey, row] of dbMap) {
        if (trackKeyStem(mapKey) === stem) return row || null;
      }
      return null;
    }

    function keyIsErrorInCurrentSession(key, stemCtx) {
      const ctx = stemCtx || computeErrorStemContext();
      const stem = key ? trackKeyStem(key) : "";
      if (stem && ctx.unsettledStems.has(stem)) {
        return ctx.dlTerminalErrStems.has(stem);
      }
      const cardMap = deps.getCardMap();
      const dbMap = deps.getDbItemByKey();
      const row = dbItemForHistoryKey(dbMap, key);
      const card = key ? cardForHistoryKey(cardMap, key) : null;
      const dlGlobally =
        typeof window !== "undefined" && Boolean(window.isDownloading);
      if (dlGlobally) {
        if (dbDownloadOutcomeError(row)) return true;
        if (mountedCardShowsDlTerminal(card)) return true;
        return false;
      }
      if (dbItemIsError(row)) return true;
      return cardLooksLikeError(card);
    }

    function updateErrorHistoryCountBadge(optStemCtx) {
      const badge = document.getElementById("dl-history-errors-count");
      if (!badge) return;
      const stemCtx = optStemCtx != null ? optStemCtx : computeErrorStemContext();
      const orderAll = deps.getOrderAll();
      let n = 0;
      for (let i = 0; i < orderAll.length; i++) {
        if (keyIsErrorInCurrentSession(orderAll[i], stemCtx)) n++;
      }
      if (n === 0) {
        badge.classList.add("hidden");
        badge.textContent = "";
        badge.removeAttribute("aria-label");
      } else {
        badge.classList.remove("hidden");
        badge.textContent = String(n);
        badge.setAttribute(
          "aria-label",
          `${n} error entr${n === 1 ? "y" : "ies"} in download history`,
        );
      }
    }

    function scrollHistoryListToBottom(list) {
      if (!list) return;
      if (deps.isVirtActive()) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            list.scrollTop = list.scrollHeight;
          });
        });
      } else {
        list.scrollTop = list.scrollHeight;
      }
    }

    function applyFilter() {
      if (deps.getSkipHistoryFilterApply()) return;
      const stemCtx = computeErrorStemContext();
      const list = document.getElementById("dl-track-status");
      const stick = list ? deps.scrollContainerAtBottom(list) : false;
      const orderAll = deps.getOrderAll();
      const cardMap = deps.getCardMap();

      if (deps.isVirtActive() && deps.getVirtInnerEl() && list) {
        if (filterMode === "errors") {
          deps.setOrder(
            orderAll.filter((k) => keyIsErrorInCurrentSession(k, stemCtx)),
          );
        } else {
          deps.setOrder(orderAll.slice());
        }
        deps.rebuildKeyIndex();
        deps.runVirtRenderPass({ stickToBottom: stick });
      } else {
        deps.setOrder(orderAll.slice());
        deps.rebuildKeyIndex();
        if (list && cardMap.size > 0) {
          const seen = new Set();
          for (let i = 0; i < orderAll.length; i++) {
            const k = orderAll[i];
            const card = cardForHistoryKey(cardMap, k);
            if (!card || seen.has(card)) continue;
            seen.add(card);
            const show =
              filterMode !== "errors" ||
              keyIsErrorInCurrentSession(k, stemCtx);
            card.classList.toggle("hidden", !show);
            card.setAttribute("aria-hidden", show ? "false" : "true");
          }
          for (const card of cardMap.values()) {
            if (!card || seen.has(card)) continue;
            const show = filterMode !== "errors";
            card.classList.toggle("hidden", !show);
            card.setAttribute("aria-hidden", show ? "false" : "true");
          }
        }
        if (list && stick) {
          list.scrollTop = list.scrollHeight;
        }
      }
      updateErrorHistoryCountBadge(stemCtx);
    }

    function initDownloadHistorySegment() {
      const allBtn = document.getElementById("dl-history-tab-all");
      const errBtn = document.getElementById("dl-history-tab-errors");
      const list = document.getElementById("dl-track-status");
      if (!allBtn || !errBtn) return;
      const applyMode = (mode) => {
        filterMode = mode;
        const allOn = mode === "all";
        allBtn.classList.toggle("is-active", allOn);
        errBtn.classList.toggle("is-active", !allOn);
        allBtn.setAttribute("aria-selected", allOn ? "true" : "false");
        errBtn.setAttribute("aria-selected", allOn ? "false" : "true");
        allBtn.tabIndex = allOn ? 0 : -1;
        errBtn.tabIndex = allOn ? -1 : 0;
        applyFilter();
        scrollHistoryListToBottom(list);
      };
      allBtn.addEventListener("click", () => applyMode("all"));
      errBtn.addEventListener("click", () => applyMode("errors"));
    }

    return {
      applyFilter,
      updateErrorHistoryCountBadge,
      initDownloadHistorySegment,
      getFilterMode: () => filterMode,
    };
  }

  hroot.internals = hroot.internals || {};
  hroot.internals.bootstrapFilters = bootstrapFilters;
})();
