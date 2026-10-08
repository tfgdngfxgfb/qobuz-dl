(function () {
  "use strict";
  const g = window.QobuzGui;
  const api = g && g.api;
  const features = (g.features = g.features || {});
  const lyrics = (features.lyrics = features.lyrics || {});
  const ui = g.ui || {};

  const ANCHOR_CLASS = "lyric-search-anchor";

  let _deps = {};
  let _modalCtx = null;
  let _attachAbort = null;
  let _searchReqAbort = null;
  let _openSession = 0;
  let _searchSeq = 0;

  function preview() {
    return lyrics.preview;
  }

  function results() {
    return lyrics.searchResults;
  }

  function attach() {
    return lyrics.attach;
  }

  function lyricOut() {
    return lyrics.lyricOutputSettings;
  }

  function titleFromDisplay(displayTitle) {
    return String(displayTitle || "").trim();
  }

  function lyricArtistFromAudioPath(audioPath) {
    const p = String(audioPath || "").replace(/\\/g, "/").trim();
    if (!p) return "";
    const parts = p.split("/").filter(Boolean);
    const musicIdx = parts.findIndex((seg) => seg.toLowerCase() === "music");
    if (musicIdx >= 0 && musicIdx + 1 < parts.length) {
      return parts[musicIdx + 1].trim();
    }
    if (parts.length >= 3) {
      return parts[parts.length - 3].trim();
    }
    return "";
  }

  function resolveLyricArtistForCard(card) {
    const ti = g.core && g.core.trackIdentity;
    const pending =
      (g.core && g.core.constants && g.core.constants.GUI_PENDING_AUDIO_PREFIX) ||
      "__GUI_PENDING__:slot:";
    if (ti && typeof ti.resolveHistoryArtistForCard === "function") {
      return ti.resolveHistoryArtistForCard(card, pending);
    }
    if (!card) return "";
    let artist = (card.dataset.lyricArtist || "").trim();
    if (artist) return artist;
    artist = lyricArtistFromAudioPath(card.dataset.audioPath || "");
    if (artist) {
      card.dataset.lyricArtist = artist;
      return artist;
    }
    return "";
  }

  function clearAnchorHighlight() {
    document
      .querySelectorAll(".track-status-card." + ANCHOR_CLASS)
      .forEach((el) => {
        el.classList.remove(ANCHOR_CLASS);
      });
  }

  function setAnchorCard(card) {
    clearAnchorHighlight();
    if (card) card.classList.add(ANCHOR_CLASS);
  }

  function positionPopover() {
    const popPos = ui.popoverPositioning;
    if (popPos && typeof popPos.positionAboveDownloadHistory === "function") {
      popPos.positionAboveDownloadHistory(
        document.getElementById("lyric-search-popover"),
      );
    }
  }

  function abortFetches() {
    if (_attachAbort) {
      try {
        _attachAbort.abort();
      } catch (_) {
        /* ignore */
      }
      _attachAbort = null;
    }
    if (_searchReqAbort) {
      try {
        _searchReqAbort.abort();
      } catch (_) {
        /* ignore */
      }
      _searchReqAbort = null;
    }
  }

  function clearFieldErrors() {
    const ti = document.getElementById("lyric-search-title");
    const ar = document.getElementById("lyric-search-artist");
    if (ti) ti.classList.remove("lyric-search-input-invalid");
    if (ar) ar.classList.remove("lyric-search-input-invalid");
  }

  function applyFieldErrors(hasTitle, hasArtist) {
    const titleEl = document.getElementById("lyric-search-title");
    const artistEl = document.getElementById("lyric-search-artist");
    if (titleEl) {
      titleEl.classList.toggle("lyric-search-input-invalid", !hasTitle);
    }
    if (artistEl) {
      artistEl.classList.toggle("lyric-search-input-invalid", !hasArtist);
    }
  }

  function getCtx() {
    return _modalCtx;
  }

  function resultCallbacks() {
    const att = attach();
    return {
      onPreview: (id) => {
        if (att && typeof att.previewRow === "function") {
          void att.previewRow(_modalCtx, id);
        }
      },
      onAttach: (id, confidence, kind, btn) => {
        if (att && typeof att.attachRow === "function") {
          void att.attachRow(_modalCtx, id, confidence, kind, btn);
        }
      },
    };
  }

  function rebuildVisibleRows(ctx) {
    const res = results();
    if (res && typeof res.rebuildVisibleRows === "function") {
      res.rebuildVisibleRows(ctx, resultCallbacks());
    }
  }

  function close() {
    const pop = document.getElementById("lyric-search-popover");
    if (pop) {
      pop.classList.add("hidden");
      pop.setAttribute("aria-hidden", "true");
    }
    const pv = preview();
    if (pv && typeof pv.close === "function") pv.close();
    abortFetches();
    clearAnchorHighlight();
    clearFieldErrors();
    _modalCtx = null;
  }

  function closePreview() {
    const pv = preview();
    if (pv && typeof pv.close === "function") pv.close();
  }

  async function runSearchFromForm() {
    const statusEl = document.getElementById("lyric-search-status");
    const resultsEl = document.getElementById("lyric-search-results");
    const titleEl = document.getElementById("lyric-search-title");
    const artistEl = document.getElementById("lyric-search-artist");
    const albumEl = document.getElementById("lyric-search-album");
    const title = titleEl ? titleEl.value.trim() : "";
    const artist = artistEl ? artistEl.value.trim() : "";
    const album = albumEl ? albumEl.value.trim() : "";
    const refDur =
      _modalCtx && Number.isFinite(_modalCtx.durationSec)
        ? _modalCtx.durationSec
        : 0;

    if (!title || !artist) {
      applyFieldErrors(!!title, !!artist);
      if (statusEl) {
        statusEl.textContent = "Title and artist are required.";
        statusEl.classList.remove("hidden");
      }
      return;
    }
    clearFieldErrors();

    if (_searchReqAbort) {
      try {
        _searchReqAbort.abort();
      } catch (_) {
        /* ignore */
      }
      _searchReqAbort = null;
    }
    const searchSeq = ++_searchSeq;
    if (_modalCtx) {
      _modalCtx.searchSeq = searchSeq;
    }
    _searchReqAbort = new AbortController();
    const searchSignal = _searchReqAbort.signal;

    if (statusEl) {
      statusEl.textContent = "Searching\u2026";
      statusEl.classList.remove("hidden");
    }
    const res = results();
    if (res && typeof res.showLoading === "function") {
      res.showLoading(resultsEl);
    }
    const pv = preview();
    if (pv && typeof pv.close === "function") pv.close();

    try {
      const response = await api.lyricsApi.search(
        {
          title,
          artist,
          album,
          duration_sec: refDur,
          track_explicit:
            _modalCtx &&
            _modalCtx.trackExplicit !== null &&
            _modalCtx.trackExplicit !== undefined
              ? _modalCtx.trackExplicit
              : null,
          filter_mismatched: true,
        },
        searchSignal,
      );
      const data = await response.json();
      if (!_modalCtx || _modalCtx.searchSeq !== searchSeq) {
        return;
      }
      if (!data.ok) {
        if (statusEl) statusEl.textContent = data.error || "Search failed.";
        if (resultsEl) resultsEl.innerHTML = "";
        return;
      }
      const n = (data.results || []).length;
      if (statusEl) statusEl.textContent = `${n} result(s)`;
      const list = Array.isArray(data.results) ? data.results : [];
      if (_modalCtx) {
        _modalCtx.lastSearchResults = list.slice();
      }
      if (res && typeof res.renderResults === "function") {
        res.renderResults(_modalCtx, list, resultCallbacks());
      }
    } catch (err) {
      if (err && err.name === "AbortError") {
        const ctx = _modalCtx;
        if (ctx && ctx.searchSeq === searchSeq && resultsEl) {
          resultsEl.innerHTML = "";
        }
        return;
      }
      if (!_modalCtx || _modalCtx.searchSeq !== searchSeq) {
        return;
      }
      if (statusEl) statusEl.textContent = "Network error.";
      if (resultsEl) resultsEl.innerHTML = "";
    }
    if (!_modalCtx || _modalCtx.searchSeq !== searchSeq) {
      return;
    }
    const popAfter = document.getElementById("lyric-search-popover");
    if (popAfter && !popAfter.classList.contains("hidden")) {
      requestAnimationFrame(() => positionPopover());
    }
  }

  async function openForCard(card) {
    const pop = document.getElementById("lyric-search-popover");
    if (!pop || !card) return;
    const closeAttach =
      _deps.closeAttachPopover ||
      (features.replacements &&
        typeof features.replacements.closeAttachPopover === "function" &&
        features.replacements.closeAttachPopover.bind(features.replacements));
    if (typeof closeAttach === "function") {
      closeAttach();
    }
    abortFetches();
    const pv = preview();
    if (pv && typeof pv.close === "function") pv.close();
    const openSession = ++_openSession;
    const out = lyricOut();
    if (out && typeof out.syncFromDownload === "function") {
      out.syncFromDownload();
    }
    const tiCore = g.core && g.core.trackIdentity;
    const lctx =
      tiCore && typeof tiCore.lyricSearchContextForCard === "function"
        ? tiCore.lyricSearchContextForCard(card)
        : {
            title: titleFromDisplay(
              (
                (card.querySelector(".track-status-title") &&
                  card.querySelector(".track-status-title").textContent) ||
                ""
              ).trim(),
            ),
            artist: resolveLyricArtistForCard(card),
            album: (card.dataset.lyricAlbum || "").trim(),
            durationSec:
              parseInt(String(card.dataset.durationSec || "0"), 10) || 0,
            trackExplicit: null,
          };
    const title = String(lctx.title || "").trim();
    const artist = String(lctx.artist || "").trim();
    const album = String(lctx.album || "").trim();
    const durationSec = Number.isFinite(lctx.durationSec)
      ? lctx.durationSec
      : 0;
    const audioPath = (card.dataset.audioPath || "").trim();
    const openingPath = audioPath;

    const ti = document.getElementById("lyric-search-title");
    const ar = document.getElementById("lyric-search-artist");
    const al = document.getElementById("lyric-search-album");
    if (ti) ti.value = title;
    if (ar) ar.value = artist;
    if (al) al.value = album;
    clearFieldErrors();

    let trackExplicit = lctx.trackExplicit;
    if (trackExplicit !== true && trackExplicit !== false) {
      const teRaw = card.dataset.trackExplicit;
      if (teRaw === "1") trackExplicit = true;
      else if (teRaw === "0") trackExplicit = false;
      else trackExplicit = null;
    }
    _modalCtx = {
      audioPath,
      durationSec,
      trackExplicit,
      attachedLrclibId: null,
      previewingLrclibId: null,
      lastSearchResults: null,
      lyricSearchPagedShown: 0,
      anchorCard: card,
      openSession,
      searchSeq: 0,
    };
    setAnchorCard(card);

    pop.classList.remove("hidden");
    pop.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => positionPopover());

    const statusEl = document.getElementById("lyric-search-status");
    if (statusEl) statusEl.classList.add("hidden");
    const resultsEl = document.getElementById("lyric-search-results");
    const res = results();
    if (res && typeof res.showLoading === "function") {
      res.showLoading(resultsEl);
    }
    const pflag = document.getElementById("lyric-search-preview-flag");
    if (pflag) {
      pflag.classList.add("hidden");
      pflag.textContent = "";
    }

    _attachAbort = new AbortController();
    const attachSignal = _attachAbort.signal;

    let attachedLrclibId = null;
    if (audioPath) {
      try {
        const response = await api.lyricsApi.attachedId(
          audioPath,
          attachSignal,
        );
        const data = await response.json();
        if (data.ok && data.attached_lrclib_id != null) {
          attachedLrclibId = data.attached_lrclib_id;
        }
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }
    _attachAbort = null;
    if (
      !_modalCtx ||
      _modalCtx.openSession !== openSession ||
      _modalCtx.audioPath !== openingPath
    ) {
      return;
    }
    _modalCtx.attachedLrclibId = attachedLrclibId;
    await runSearchFromForm();
  }

  function bindHistoryListClicks() {
    const list = document.getElementById("dl-track-status");
    if (!list || list.dataset.lyricSearchBound === "1") return;
    list.dataset.lyricSearchBound = "1";
    list.addEventListener("click", (e) => {
      const revealBtn = e.target.closest("button.track-dl-btn--reveal");
      if (revealBtn) {
        e.preventDefault();
        e.stopPropagation();
        const rcard = revealBtn.closest(".track-status-card");
        const rp = rcard && (rcard.dataset.audioPath || "").trim();
        if (!rp) return;
        void (async () => {
          try {
            const res = await api.utilityApi.revealInFolder(rp);
            await res.json();
          } catch (_) {
            /* ignore */
          }
        })();
        return;
      }
      if (e.target.closest(".confidence-chip-tooltip")) return;
      const wrap = e.target.closest(".confidence-chip-wrap");
      const lyricsChip = e.target.closest(".track-status-chip.lyrics-chip");
      if (!wrap && !lyricsChip) return;
      if (lyricsChip && lyricsChip.classList.contains("loading")) return;
      const rowCard = (wrap || lyricsChip).closest(".track-status-card");
      if (!rowCard) return;
      e.preventDefault();
      e.stopPropagation();
      openForCard(rowCard);
    });
  }

  function init(deps) {
    _deps = { ...(_deps || {}), ...(deps || {}) };

    const ic = g.core && g.core.icons;
    const fmt = g.core && g.core.format;
    const res = results();
    if (res && typeof res.configure === "function") {
      res.configure({
        explicitBadgeSvg: ic ? ic.explicitBadgeSvg : "",
        attachedSvg: ic ? ic.lyricSearchAttachedSvg : "",
        kindLabel(kind) {
          const k = String(kind || "").toLowerCase();
          if (k === "synced") return "Synced";
          if (k === "plain") return "Plain";
          if (k === "instrumental") return "Instrumental";
          return "\u2014";
        },
        formatLyricDeltaSec: fmt ? fmt.formatLyricDeltaSec : () => "",
      });
    }

    const att = attach();
    if (att && typeof att.configure === "function") {
      att.configure({
        explicitBadgeSvg: ic ? ic.explicitBadgeSvg : "",
        lyricOutputSettings: lyricOut(),
        setLyricsChip: _deps.setLyricsChip,
        lyricDestinationFromOutputs: _deps.lyricDestinationFromOutputs,
        positionPopover,
        rebuildVisibleRows,
      });
    }

    const pv = preview();
    if (pv && typeof pv.init === "function") {
      pv.init({
        onOverlayClosed() {
          if (_modalCtx) {
            _modalCtx.previewingLrclibId = null;
          }
          document
            .querySelectorAll("#lyric-search-results .btn-ghost")
            .forEach((btn) => {
              btn.classList.remove("is-previewing");
              btn.textContent = "Preview";
              btn.style.width = "";
            });
        },
      });
    }

    const out = lyricOut();
    if (out && typeof out.bindPopoverToggles === "function") {
      out.bindPopoverToggles();
    }

    const pop = document.getElementById("lyric-search-popover");
    if (!pop || pop.dataset.bound === "1") {
      bindHistoryListClicks();
      return;
    }
    pop.dataset.bound = "1";

    let lyricSearchMousedownTarget = null;
    document.addEventListener(
      "mousedown",
      (e) => {
        if (!pop || pop.classList.contains("hidden")) {
          lyricSearchMousedownTarget = null;
          return;
        }
        lyricSearchMousedownTarget = e.target;
      },
      true,
    );
    const closeBtn = document.getElementById("lyric-search-close");
    const previewCloseBtn = document.getElementById(
      "lyric-search-preview-close",
    );
    const submitBtn = document.getElementById("lyric-search-submit");
    if (closeBtn) closeBtn.addEventListener("click", () => close());
    if (previewCloseBtn) {
      previewCloseBtn.addEventListener("click", () => closePreview());
    }
    document.addEventListener("click", (e) => {
      if (!pop || pop.classList.contains("hidden")) return;
      const target = lyricSearchMousedownTarget || e.target;
      if (pop.contains(target)) return;
      if (e.target.closest && e.target.closest("#dl-track-status")) return;
      close();
    });
    window.addEventListener("resize", () => {
      if (!pop || pop.classList.contains("hidden") || !_modalCtx) {
        return;
      }
      positionPopover();
    });
    let popWinScrollRaf = null;
    window.addEventListener(
      "scroll",
      () => {
        if (!pop || pop.classList.contains("hidden") || !_modalCtx) {
          return;
        }
        if (popWinScrollRaf != null) {
          cancelAnimationFrame(popWinScrollRaf);
        }
        popWinScrollRaf = requestAnimationFrame(() => {
          popWinScrollRaf = null;
          positionPopover();
        });
      },
      true,
    );
    if (submitBtn) {
      submitBtn.addEventListener("click", () => {
        void runSearchFromForm();
      });
    }
    const lyricResultsScroll = document.getElementById("lyric-search-results");
    if (res && typeof res.bindScrollPaging === "function") {
      res.bindScrollPaging(lyricResultsScroll, getCtx, resultCallbacks());
    }
    const lyricTitleIn = document.getElementById("lyric-search-title");
    const lyricArtistIn = document.getElementById("lyric-search-artist");
    if (lyricTitleIn) {
      lyricTitleIn.addEventListener("input", () => {
        lyricTitleIn.classList.remove("lyric-search-input-invalid");
      });
    }
    if (lyricArtistIn) {
      lyricArtistIn.addEventListener("input", () => {
        lyricArtistIn.classList.remove("lyric-search-input-invalid");
      });
    }

    bindHistoryListClicks();
  }

  const modalHost = {
    init,
    openForCard,
    close,
    closePreview,
  };

  if (lyrics.search && typeof lyrics.search.install === "function") {
    lyrics.search.install(modalHost);
  }

  const internals = (lyrics.internals = lyrics.internals || {});
  internals.setLyricSearchAnchorCard = setAnchorCard;
  internals.clearLyricSearchAnchorHighlight = clearAnchorHighlight;
  internals.lyricSearchTitleFromDisplay = titleFromDisplay;
  internals.showLyricSearchResultsLoading = (container, ariaBusyLabel) => {
    const res = results();
    if (res && typeof res.showLoading === "function") {
      res.showLoading(container, ariaBusyLabel);
    }
  };
})();
