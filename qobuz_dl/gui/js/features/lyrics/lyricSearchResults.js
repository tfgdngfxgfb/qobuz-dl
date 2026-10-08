(function () {
  "use strict";
  const g = window.QobuzGui;
  const features = (g.features = g.features || {});
  const lyrics = (features.lyrics = features.lyrics || {});

  const PAGE_INITIAL = 10;
  const PAGE_STEP = 5;

  let _deps = {};

  function configure(deps) {
    _deps = { ...(_deps || {}), ...(deps || {}) };
  }

  function kindClass(kind) {
    const k = String(kind || "").toLowerCase();
    if (k === "plain") return "lyric-search-kind lyric-search-kind--plain";
    if (k === "instrumental") {
      return "lyric-search-kind lyric-search-kind--instrumental";
    }
    if (k === "synced") return "lyric-search-kind lyric-search-kind--synced";
    return "lyric-search-kind lyric-search-kind--muted";
  }

  function formatConfidencePct(confVal) {
    const c = Number(confVal);
    if (!Number.isFinite(c)) return "";
    if (Number.isInteger(c)) return String(Math.round(c));
    const r = Math.round(c * 10) / 10;
    return String(r);
  }

  function bindKindConfidenceHover(kindEl, kindLabel, confVal) {
    kindEl.dataset.kindLabel = kindLabel;
    const pct = formatConfidencePct(confVal);
    if (!pct) {
      kindEl.textContent = kindLabel;
      return;
    }
    kindEl.dataset.confidencePct = pct;
    kindEl.classList.add("lyric-search-kind--pct-swap");
    kindEl.textContent = `${pct}%`;
    kindEl.setAttribute(
      "aria-label",
      `LRCLIB match ${pct}% (${kindLabel}); hover shows lyric type.`,
    );

    function showKindLabel() {
      kindEl.textContent = kindEl.dataset.kindLabel || kindLabel;
    }
    function showPct() {
      const p = kindEl.dataset.confidencePct;
      kindEl.textContent = p ? `${p}%` : kindEl.dataset.kindLabel || kindLabel;
    }

    kindEl.addEventListener("mouseenter", showKindLabel);
    kindEl.addEventListener("mouseleave", showPct);
  }

  function showLoading(container, ariaBusyLabel) {
    if (!container) return;
    container.replaceChildren();
    const root = document.createElement("div");
    root.className = "lyric-search-loading";
    root.setAttribute("role", "status");
    root.setAttribute("aria-busy", "true");
    root.setAttribute("aria-label", ariaBusyLabel || "Searching lyrics");
    for (let i = 0; i < 3; i++) {
      const row = document.createElement("div");
      row.className = "lyric-search-skeleton-row";
      const l1 = document.createElement("div");
      l1.className = "lyric-search-skeleton-line lyric-search-skeleton-line--a";
      const l2 = document.createElement("div");
      l2.className = "lyric-search-skeleton-line lyric-search-skeleton-line--b";
      const l3 = document.createElement("div");
      l3.className = "lyric-search-skeleton-line lyric-search-skeleton-line--c";
      const t = document.createElement("span");
      t.className = "lyric-search-skeleton-text";
      const p = document.createElement("span");
      p.className = "lyric-search-skeleton-pill";
      l3.appendChild(t);
      l3.appendChild(p);
      row.appendChild(l1);
      row.appendChild(l2);
      row.appendChild(l3);
      root.appendChild(row);
    }
    container.appendChild(root);
  }

  function renderEmpty() {
    const el = document.getElementById("lyric-search-results");
    if (!el) return;
    el.innerHTML = "";
    el.scrollTop = 0;
    const empty = document.createElement("div");
    empty.className = "lyric-search-empty";
    empty.textContent = "No matches.";
    el.appendChild(empty);
  }

  function createResultRow(row, ctx, callbacks) {
    const div = document.createElement("div");
    div.className = "lyric-search-row";
    const audioPath = ctx && ctx.audioPath;
    const attachedId =
      ctx && ctx.attachedLrclibId != null ? Number(ctx.attachedLrclibId) : null;
    const rowId = row.id != null ? Number(row.id) : NaN;
    const isRowAttached =
      attachedId != null &&
      Number.isFinite(attachedId) &&
      Number.isFinite(rowId) &&
      rowId === attachedId;
    if (isRowAttached) {
      div.classList.add("lyric-search-row--attached");
      div.setAttribute("data-lyric-attached", "1");
    }
    div.dataset.rowId = String(row.id || "");

    const trackNameRaw = row.trackName || "";
    const albumRaw = row.albumName || "";
    const artistRaw = row.artistName || "";

    const line1 = document.createElement("div");
    line1.className = "lyric-search-row-line lyric-search-row-line--title";

    const t = document.createElement("span");
    t.className = "lyric-search-track";
    t.textContent = trackNameRaw;

    const kind = document.createElement("span");
    kind.className = kindClass(row.kind);
    const kindLabelFn = _deps.kindLabel || (() => "\u2014");
    const kindLabel = kindLabelFn(row.kind);
    kind.textContent = kindLabel;
    bindKindConfidenceHover(kind, kindLabel, row.confidence);

    line1.appendChild(t);
    line1.appendChild(kind);

    const ex = document.createElement("span");
    if (row.lyrics_explicit) {
      ex.className =
        "lyric-search-rating lyric-search-rating--explicit explicit-tag-badge";
      ex.innerHTML = _deps.explicitBadgeSvg || "";
      line1.appendChild(ex);
    } else {
      ex.className = "lyric-search-rating lyric-search-rating--clean";
      ex.textContent = "clean";
      line1.appendChild(ex);
    }

    const formatDelta = _deps.formatLyricDeltaSec || (() => "");
    const deltaStr = formatDelta(row.delta_sec);
    if (deltaStr) {
      const d = document.createElement("span");
      d.className = "lyric-search-delta";
      d.textContent = deltaStr;
      d.setAttribute(
        "aria-label",
        "LRCLIB duration vs this track: " + deltaStr + " (mm:ss)",
      );
      line1.appendChild(d);
    }

    const line2 = document.createElement("div");
    line2.className = "lyric-search-row-line lyric-search-row-line--album";
    const albumEl = document.createElement("span");
    albumEl.className = "lyric-search-album";
    albumEl.textContent = albumRaw || "\u2014";
    line2.appendChild(albumEl);

    const line3 = document.createElement("div");
    line3.className = "lyric-search-row-line lyric-search-row-line--footer";

    const artistSpan = document.createElement("span");
    artistSpan.className = "lyric-search-artist";
    artistSpan.textContent = artistRaw || "\u2014";

    const actions = document.createElement("div");
    actions.className = "lyric-search-row-actions";

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "btn-ghost btn-sm";
    prevBtn.textContent = "Preview";
    const rid = row.id;
    prevBtn.dataset.rid = String(rid);
    prevBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (callbacks && typeof callbacks.onPreview === "function") {
        void callbacks.onPreview(rid);
      }
    });

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn-primary btn-sm";
    saveBtn.textContent = "Attach";
    saveBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (saveBtn.disabled) return;
      if (callbacks && typeof callbacks.onAttach === "function") {
        void callbacks.onAttach(rid, row.confidence, row.kind, saveBtn);
      }
    });
    if (!audioPath) {
      saveBtn.disabled = true;
      saveBtn.title =
        "Audio path is available after the track file is saved to disk.";
    }

    actions.appendChild(prevBtn);
    if (isRowAttached) {
      const slot = document.createElement("span");
      slot.className = "lyric-search-attached-slot";
      slot.setAttribute("aria-label", "Already attached to this track");
      slot.setAttribute(
        "data-tip",
        "Lyrics already attached\nThis LRCLIB match is saved using your current lyric output settings. Plex and other players can read sidecar or embedded lyrics.",
      );
      slot.setAttribute("data-tip-icon", "/gui/plex.png");
      slot.innerHTML = _deps.attachedSvg || "";
      actions.appendChild(slot);
    } else {
      actions.appendChild(saveBtn);
    }

    line3.appendChild(artistSpan);
    line3.appendChild(actions);

    div.appendChild(line1);
    div.appendChild(line2);
    div.appendChild(line3);
    return div;
  }

  function appendPage(ctx, isInitial, callbacks) {
    const el = document.getElementById("lyric-search-results");
    if (!el || !ctx || !Array.isArray(ctx.lastSearchResults)) return;
    const all = ctx.lastSearchResults;
    const total = all.length;
    if (!total) return;
    const step = isInitial ? PAGE_INITIAL : PAGE_STEP;
    let shown = ctx.lyricSearchPagedShown || 0;
    if (isInitial) {
      el.innerHTML = "";
      shown = 0;
    }
    const next = Math.min(shown + step, total);
    for (let i = shown; i < next; i++) {
      el.appendChild(createResultRow(all[i], ctx, callbacks));
    }
    ctx.lyricSearchPagedShown = next;
  }

  function scrollToAttachedOrTop(el, list, ctx, callbacks) {
    if (!el || !ctx || !Array.isArray(list) || !list.length) return;
    const attachedId =
      ctx.attachedLrclibId != null ? Number(ctx.attachedLrclibId) : NaN;
    let attachedIdx = -1;
    if (Number.isFinite(attachedId)) {
      attachedIdx = list.findIndex((r) => Number(r.id) === attachedId);
    }
    if (attachedIdx < 0) {
      el.scrollTop = 0;
      return;
    }
    const total = list.length;
    let guard = 0;
    while (
      (ctx.lyricSearchPagedShown || 0) <= attachedIdx &&
      (ctx.lyricSearchPagedShown || 0) < total &&
      guard < 200
    ) {
      appendPage(ctx, false, callbacks);
      guard++;
    }
    requestAnimationFrame(() => {
      const row = el.querySelector(".lyric-search-row--attached");
      if (row) {
        row.scrollIntoView({ block: "center", behavior: "auto" });
      } else {
        el.scrollTop = 0;
      }
    });
  }

  function rebuildVisibleRows(ctx, callbacks) {
    const el = document.getElementById("lyric-search-results");
    if (!ctx || !el || !Array.isArray(ctx.lastSearchResults)) return;
    const all = ctx.lastSearchResults;
    if (!all.length) {
      renderEmpty();
      return;
    }
    const n = Math.min(ctx.lyricSearchPagedShown || 0, all.length);
    el.innerHTML = "";
    for (let i = 0; i < n; i++) {
      el.appendChild(createResultRow(all[i], ctx, callbacks));
    }
    requestAnimationFrame(() => {
      const row = el.querySelector(".lyric-search-row--attached");
      if (row) {
        row.scrollIntoView({ block: "center", behavior: "auto" });
      }
    });
  }

  function renderResults(ctx, rows, callbacks) {
    const el = document.getElementById("lyric-search-results");
    if (!el || !ctx) return;
    const list = Array.isArray(rows) ? rows : [];
    ctx.lastSearchResults = list;
    ctx.lyricSearchPagedShown = 0;
    if (!list.length) {
      renderEmpty();
      el.scrollTop = 0;
      return;
    }
    appendPage(ctx, true, callbacks);
    scrollToAttachedOrTop(el, list, ctx, callbacks);
  }

  function bindScrollPaging(el, getCtx, callbacks) {
    if (!el || el.dataset.pagingScrollBound === "1") return;
    el.dataset.pagingScrollBound = "1";
    let scrollRaf = null;
    el.addEventListener(
      "scroll",
      () => {
        if (scrollRaf != null) {
          cancelAnimationFrame(scrollRaf);
        }
        scrollRaf = requestAnimationFrame(() => {
          scrollRaf = null;
          const ctx = typeof getCtx === "function" ? getCtx() : null;
          if (
            !ctx ||
            !Array.isArray(ctx.lastSearchResults) ||
            !ctx.lastSearchResults.length
          ) {
            return;
          }
          const shown = ctx.lyricSearchPagedShown || 0;
          const total = ctx.lastSearchResults.length;
          if (shown >= total) return;
          const { scrollTop, scrollHeight, clientHeight } = el;
          if (scrollHeight - scrollTop - clientHeight > 100) return;
          appendPage(ctx, false, callbacks);
        });
      },
      { passive: true },
    );
  }

  lyrics.searchResults = {
    configure,
    showLoading,
    renderResults,
    appendPage,
    rebuildVisibleRows,
    bindScrollPaging,
    renderEmpty,
  };
})();
