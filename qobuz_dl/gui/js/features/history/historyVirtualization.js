/**
 * Download history virtual scroller (H5): windowed DOM for large lists.
 *
 * Invoked once from `app.js` `initDownload()` via `bootstrapVirtualization(deps)`.
 */
(function () {
  "use strict";
  const g = window.QobuzGui;
  const hroot = (g.features.history = g.features.history || {});

  function bootstrapVirtualization(deps) {
    const cardForHistoryKey = g.core.trackIdentity.cardForHistoryKey;
    const VIRT_OVERSCAN =
      (g.core.constants && g.core.constants.TS_VIRT_OVERSCAN) || 6;

    let virtActive = false;
    let virtInnerEl = null;
    let virtRowH = 50;
    let scrollHandlerBound = null;
    let scrollRaf = 0;
    let resizeObs = null;

    function isVirtActive() {
      return virtActive;
    }

    function getVirtInnerEl() {
      return virtInnerEl;
    }

    function appendParent(list) {
      if (virtActive && virtInnerEl) return virtInnerEl;
      return list;
    }

    function ensureVirtInner(list) {
      const inner = document.createElement("div");
      inner.id = "ts-virt-inner";
      inner.className = "track-status-virt-inner";
      list.appendChild(inner);
      virtInnerEl = inner;
    }

    function updateVirtInnerHeight() {
      if (!virtInnerEl) return;
      const order = deps.getOrder();
      virtInnerEl.style.minHeight = `${Math.max(0, order.length) * virtRowH}px`;
    }

    function positionVirtCard(card, index) {
      if (!card || !virtActive) return;
      card.classList.add("track-status-card--virt");
      card.style.top = `${index * virtRowH}px`;
      card.style.minHeight = "";
    }

    function pinnedIndices(n) {
      const out = new Set();
      const keyToIndex = deps.getKeyToIndex();
      for (const k of deps.getActiveDlKeys()) {
        const i = keyToIndex.get(k);
        if (i !== undefined && i >= 0 && i < n) out.add(i);
      }
      document
        .querySelectorAll("#dl-track-status .lyric-search-anchor")
        .forEach((c) => {
          const k = c.dataset.trackKey;
          if (!k) return;
          const i = keyToIndex.get(k);
          if (i !== undefined && i >= 0 && i < n) out.add(i);
        });
      return out;
    }

    function measureRowH() {
      if (!virtInnerEl) return;
      const card = virtInnerEl.querySelector(".track-status-card");
      if (!card) return;
      const r = card.getBoundingClientRect();
      const cs = window.getComputedStyle(card);
      const mb = parseFloat(cs.marginBottom) || 0;
      if (r.height > 0) virtRowH = Math.max(48, Math.ceil(r.height + mb));
      updateVirtInnerHeight();
    }

    function purgeVirtDomCards() {
      if (!virtInnerEl) return;
      virtInnerEl.querySelectorAll(".track-status-card").forEach((c) => {
        c.remove();
      });
    }

    function render() {
      if (!virtActive || !virtInnerEl) return;
      const list = document.getElementById("dl-track-status");
      if (!list) return;
      const order = deps.getOrder();
      const n = order.length;
      const H = virtRowH;
      virtInnerEl.style.minHeight = `${Math.max(0, n) * H}px`;
      if (n === 0) {
        purgeVirtDomCards();
        return;
      }

      const st = list.scrollTop;
      const ch = list.clientHeight || 1;
      let start = Math.floor(st / H) - VIRT_OVERSCAN;
      let end = Math.ceil((st + ch) / H) + VIRT_OVERSCAN;
      start = Math.max(0, start);
      end = Math.min(n, end);

      const want = new Set();
      for (let i = start; i < end; i++) want.add(i);
      for (const ii of pinnedIndices(n)) want.add(ii);

      const cardMap = deps.getCardMap();
      const keyToIndex = deps.getKeyToIndex();
      const allowedKeys = new Set(order);
      for (const [k, card] of [...cardMap]) {
        const idx = keyToIndex.get(k);
        if (idx === undefined || !allowedKeys.has(k)) {
          if (card.isConnected) card.remove();
          continue;
        }
        if (!want.has(idx)) {
          if (card.isConnected) card.remove();
          continue;
        }
      }

      const dbMap = deps.getDbItemByKey();
      const sorted = [...want].sort((a, b) => a - b);
      for (let j = 0; j < sorted.length; j++) {
        const i = sorted[j];
        const k = order[i];
        if (!k) continue;
        const existing = cardForHistoryKey(cardMap, k);
        if (existing) {
          if (existing && !existing.isConnected) {
            virtInnerEl.appendChild(existing);
          }
          continue;
        }
        const it = dbMap.get(k);
        if (!it) continue;
        deps.mountDbItemAtIndex(it, i);
      }

      for (const [k, card] of cardMap) {
        const idx = keyToIndex.get(k);
        if (idx !== undefined) positionVirtCard(card, idx);
      }
    }

    function onScroll() {
      if (!virtActive || !virtInnerEl) return;
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        render();
      });
    }

    function teardownVirtScroller() {
      const list = document.getElementById("dl-track-status");
      if (resizeObs) {
        try {
          if (list) resizeObs.unobserve(list);
        } catch (_) {
          /* ignore */
        }
        try {
          resizeObs.disconnect();
        } catch (_) {
          /* ignore */
        }
        resizeObs = null;
      }
      if (list && scrollHandlerBound) {
        list.removeEventListener("scroll", scrollHandlerBound);
        window.removeEventListener("resize", scrollHandlerBound);
      }
      scrollHandlerBound = null;
      virtInnerEl = null;
      virtActive = false;
      if (scrollRaf) {
        cancelAnimationFrame(scrollRaf);
        scrollRaf = 0;
      }
    }

    function activateForList(list) {
      virtActive = true;
      ensureVirtInner(list);
      scrollHandlerBound = () => onScroll();
      list.addEventListener("scroll", scrollHandlerBound, { passive: true });
      window.addEventListener("resize", scrollHandlerBound, { passive: true });
      if (window.ResizeObserver) {
        resizeObs = new ResizeObserver(() => onScroll());
        resizeObs.observe(list);
      }
    }

    function runInitialRenderPass(list, stickToBottom) {
      updateVirtInnerHeight();
      requestAnimationFrame(() => {
        render();
        measureRowH();
        render();
        if (stickToBottom) list.scrollTop = list.scrollHeight;
      });
    }

    function runVirtRenderPass(opts) {
      const stickToBottom = Boolean(opts && opts.stickToBottom);
      const list = document.getElementById("dl-track-status");
      updateVirtInnerHeight();
      requestAnimationFrame(() => {
        render();
        measureRowH();
        render();
        if (stickToBottom && list) {
          list.scrollTop = list.scrollHeight;
        }
      });
    }

    return {
      isVirtActive,
      getVirtInnerEl,
      appendParent,
      teardownVirtScroller,
      activateForList,
      updateVirtInnerHeight,
      positionVirtCard,
      measureRowH,
      onScroll,
      render,
      runInitialRenderPass,
      runVirtRenderPass,
    };
  }

  hroot.internals = hroot.internals || {};
  hroot.internals.bootstrapVirtualization = bootstrapVirtualization;
})();
