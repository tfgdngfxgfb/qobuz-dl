/**
 * History track-status card DOM: cover, row shell, download/lyrics chips (H3).
 *
 * Invoked once from `app.js` `initDownload()` via `bootstrap(deps)`.
 */
(function () {
  "use strict";
  const g = window.QobuzGui;
  const hroot = (g.features.history = g.features.history || {});

  function bootstrap(deps) {
    const api = g.api;
    const ti = g.core.trackIdentity;
    const parseTrackRef = ti.parseTrackRef;
    const trackKey = ti.trackKey;
    const normalizeTrackNo = ti.normalizeTrackNo;
    const normalizeTrackTitle = ti.normalizeTrackTitle;
    const applyTrackStatusSubLabel = ti.applyTrackStatusSubLabel;

    const ic = g.core.icons;
    const TRACK_DL_ICON_SVG = ic.trackDlIconSvg;
    const TRACK_SEARCH_ICON_SVG = ic.trackSearchIconSvg;
    const TRACK_MISSING_NOTE_ICON_SVG = ic.trackMissingNoteIconSvg;
    const MISSING_PLACEHOLDER_BTN_TIP = ic.missingPlaceholderBtnTip;
    const TRACK_FOLDER_ICON_SVG = ic.trackFolderIconSvg;
    const TRACK_DL_FAIL_SVG = ic.trackDlFailSvg;
    const EXPLICIT_BADGE_SVG = ic.explicitBadgeSvg;

    const getCardMap = () => deps.getCardMap();
    const appendTsOrderKey = deps.appendTsOrderKey;
    const getSkipHistoryFilterApply = () => deps.getSkipHistoryFilterApply();
    const applyHistoryFilter = () => deps.applyHistoryFilter();
    const isVirtActive = () => deps.isVirtActive();
    const getVirtInnerEl = () => deps.getVirtInnerEl();
    const getKeyToIndex = () => deps.getKeyToIndex();
    const appendParent = deps.appendParent;
    const positionVirtCard = deps.positionVirtCard;
    const updateVirtInnerHeight = deps.updateVirtInnerHeight;
    const virtMeasureRowH = deps.virtMeasureRowH;
    const virtOnScroll = deps.virtOnScroll;
    const scrollContainerAtBottom = deps.scrollContainerAtBottom;
    const writeAttachMissingPlaceholder = deps.writeAttachMissingPlaceholder;
    const openAttachTrackPopover = deps.openAttachTrackPopover;
    const syncResolutionButtonStates = deps.syncResolutionButtonStates;

    function setTrackCardCover(card, coverUrl) {
      const url = String(coverUrl || "").trim();
      if (!url || !card) return;
      let art = card.querySelector(".track-status-art");
      if (!art) return;
      let img = art.querySelector(".track-status-art-img");
      if (!img) {
        img = document.createElement("img");
        img.className = "track-status-art-img";
        img.alt = "";
        art.appendChild(img);
      }
      art.classList.remove("track-status-art--empty");
      img.referrerPolicy = "no-referrer";
      img.decoding = "async";
      img.loading = "lazy";
      img.onerror = () => {
        img.remove();
        art.classList.add("track-status-art--empty");
      };
      img.src = url;
    }

    function buildTrackStatusCardEl(
      trackNo,
      title,
      lyricAlbum,
      coverUrl,
      audioPathForKey,
    ) {
      const parsed = parseTrackRef(trackNo, title);
      const alb =
        lyricAlbum != null && String(lyricAlbum).trim() !== ""
          ? String(lyricAlbum).trim()
          : "";
      const key = trackKey(
        parsed.trackNo,
        parsed.title,
        alb,
        audioPathForKey || "",
      );
      const card = document.createElement("div");
      card.className = "track-status-card";
      card.dataset.trackKey = key;
      card.dataset.trackNo = normalizeTrackNo(parsed.trackNo);
      card.dataset.trackTitle = normalizeTrackTitle(parsed.title);
      if (alb) card.dataset.lyricAlbum = alb;
      card.innerHTML = `
      <div class="track-status-art track-status-art--empty"></div>
      <div class="track-status-main">
        <span class="track-status-title"></span>
        <div class="track-status-meta-row">
          <span class="track-status-sub"></span>
          <span class="track-content-rating" aria-hidden="true"></span>
        </div>
      </div>
      <div class="track-status-tags"></div>
    `;
      card.querySelector(".track-status-title").textContent =
        parsed.title || "Track";
      applyTrackStatusSubLabel(card);
      if (coverUrl) setTrackCardCover(card, coverUrl);
      return { card, key, parsed, alb };
    }

    function ensureTrackStatusCard(
      trackNo,
      title,
      createNew = false,
      coverUrl,
      lyricAlbum,
      slotTrackId,
      audioPathForKey,
    ) {
      const list = document.getElementById("dl-track-status");
      if (!list) return null;
      const parsed = parseTrackRef(trackNo, title);
      const alb =
        lyricAlbum != null && String(lyricAlbum).trim() !== ""
          ? String(lyricAlbum).trim()
          : "";
      const sid =
        slotTrackId != null && String(slotTrackId).trim() !== ""
          ? String(slotTrackId).trim()
          : "";
      const cardMap = getCardMap();
      if (sid) {
        for (const existing of cardMap.values()) {
          if ((existing.dataset.slotTrackId || "").trim() === sid) {
            if (coverUrl) setTrackCardCover(existing, coverUrl);
            if (alb) existing.dataset.lyricAlbum = alb;
            existing.dataset.slotTrackId = sid;
            return existing;
          }
        }
      }
      const key = trackKey(
        parsed.trackNo,
        parsed.title,
        alb,
        audioPathForKey || "",
      );
      if (key && cardMap.has(key)) {
        const existing = cardMap.get(key);
        if (coverUrl) setTrackCardCover(existing, coverUrl);
        if (alb) existing.dataset.lyricAlbum = alb;
        if (sid) existing.dataset.slotTrackId = sid;
        return existing;
      }
      const apLookup = String(audioPathForKey || "").trim();
      if (apLookup) {
        for (const existing of cardMap.values()) {
          if ((existing.dataset.audioPath || "").trim() !== apLookup) continue;
          if (coverUrl) setTrackCardCover(existing, coverUrl);
          if (alb) existing.dataset.lyricAlbum = alb;
          if (sid) existing.dataset.slotTrackId = sid;
          return existing;
        }
      }
      if (!createNew) return null;

      const { card } = buildTrackStatusCardEl(
        trackNo,
        title,
        lyricAlbum,
        coverUrl,
        audioPathForKey,
      );
      if (sid) card.dataset.slotTrackId = sid;
      const stickToBottom = scrollContainerAtBottom(list);
      const parent = appendParent(list);
      parent.appendChild(card);
      if (key) {
        const isNewRow = !cardMap.has(key);
        if (isNewRow) appendTsOrderKey(key);
        cardMap.set(key, card);
        if (!getSkipHistoryFilterApply() && isNewRow) {
          applyHistoryFilter();
        }
        const virtInner = getVirtInnerEl();
        if (isVirtActive() && virtInner) {
          const idx = getKeyToIndex().get(key);
          if (idx !== undefined) positionVirtCard(card, idx);
          updateVirtInnerHeight();
          requestAnimationFrame(() => {
            virtMeasureRowH();
            virtOnScroll();
          });
        }
      }
      if (stickToBottom) list.scrollTop = list.scrollHeight;
      return card;
    }

    function setTrackContentRatingBadge(card, trackExplicitKnown) {
      if (!card) return;
      const el = card.querySelector(".track-content-rating");
      if (!el) return;
      if (trackExplicitKnown === true) {
        el.innerHTML = `<span class="track-explicit-badge explicit-tag-badge" data-tip="Marked explicit on Qobuz">${EXPLICIT_BADGE_SVG}</span>`;
        el.className = "track-content-rating track-content-rating--explicit";
      } else if (trackExplicitKnown === false) {
        el.innerHTML = "";
        el.className = "track-content-rating";
      } else {
        el.innerHTML = "";
        el.className = "track-content-rating";
      }
    }

    function finalizeSubstituteSearchBtn(tags, card) {
      if (!tags || !card) return;
      const sid = (card.dataset.slotTrackId || "").trim();
      const rid = (card.dataset.releaseAlbumId || "").trim();
      if (!sid || !rid) return;
      tags
        .querySelectorAll(".track-missing-placeholder-btn")
        .forEach((n) => n.remove());

      const mp = document.createElement("button");
      mp.type = "button";
      mp.className = "track-dl-btn track-missing-placeholder-btn";
      mp.setAttribute("data-tip", MISSING_PLACEHOLDER_BTN_TIP);
      mp.setAttribute(
        "aria-label",
        "Save missing-track placeholder (.missing.txt) beside downloads",
      );
      mp.innerHTML = TRACK_MISSING_NOTE_ICON_SVG;
      mp.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        if (mp.disabled) return;
        if (card.dataset.resolvedBy === "placeholder") return;

        const prevAudio = (card.dataset.audioPath || "").trim();
        if (
          card.dataset.resolvedBy === "search" &&
          prevAudio &&
          !prevAudio.toLowerCase().endsWith(".missing.txt")
        ) {
          api.replacementApi
            .deleteResolutionFile({ file_path: prevAudio })
            .catch(() => {});
          delete card.dataset.audioPath;
          delete card.dataset.resolvedBy;
        }

        void writeAttachMissingPlaceholder(card, mp);
      });
      tags.appendChild(mp);

      const sb = document.createElement("button");
      sb.type = "button";
      sb.className = "track-dl-btn track-substitute-search-btn";
      sb.setAttribute("data-tip", "Search to replace track with similar");
      sb.setAttribute("aria-label", "Find track replacement");
      sb.innerHTML = TRACK_SEARCH_ICON_SVG;
      sb.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        openAttachTrackPopover(card);
      });
      tags.appendChild(sb);

      syncResolutionButtonStates(card);
    }

    function setTrackDownloadChip(
      trackNo,
      title,
      statusText,
      cls,
      linkOpts,
      lyricAlbum,
    ) {
      const card = ensureTrackStatusCard(
        trackNo,
        title,
        false,
        undefined,
        lyricAlbum,
      );
      if (!card) return;
      const tags = card.querySelector(".track-status-tags");
      if (!tags) return;
      tags
        .querySelectorAll(".track-substitute-search-btn")
        .forEach((n) => n.remove());
      tags
        .querySelectorAll(".track-missing-placeholder-btn")
        .forEach((n) => n.remove());

      const isDownloading =
        cls !== "done" && cls !== "failed" && !linkOpts?.href;
      if (isDownloading) {
        const activeBtn = card.querySelector(
          "button.download-chip.track-dl-btn--active",
        );
        if (activeBtn) return;
      }

      const old = card.querySelector(".download-chip");
      if (old) old.remove();

      const href = linkOpts && String(linkOpts.href || "").trim();
      const sid = linkOpts && String(linkOpts.slotTrackId || "").trim();
      if (href) {
        if (sid && card) {
          card.dataset.slotTrackId = sid;
        }
        const rid = linkOpts && String(linkOpts.releaseAlbumId || "").trim();
        if (rid && card) {
          card.dataset.releaseAlbumId = rid;
        }
        const el = document.createElement("a");
        el.className = "track-dl-btn download-chip purchase-only";
        el.href = href;
        el.target = "_blank";
        el.rel = "noopener noreferrer";
        if (linkOpts.titleAttr) {
          const tip = String(linkOpts.titleAttr).trim();
          el.setAttribute("data-tip", tip);
          el.setAttribute("aria-label", tip);
          el.removeAttribute("title");
        } else {
          el.setAttribute("aria-label", "Open in Qobuz store");
        }
        el.textContent = statusText || "Purchase";
        tags.appendChild(el);
        finalizeSubstituteSearchBtn(tags, card);
        return;
      }

      const el = document.createElement("button");
      el.type = "button";
      el.className = "track-dl-btn download-chip";
      el.disabled = true;
      el.innerHTML = `<span class="track-dl-btn-fill"></span>${TRACK_DL_ICON_SVG}`;

      const revealPath = (card.dataset.audioPath || "").trim();
      const canReveal = cls === "done" && revealPath !== "";

      if (cls === "done" || cls === "failed") {
        delete card.dataset.dlProgressPct;
      }

      if (cls === "done") {
        el.classList.add("track-dl-btn--done");
        if (canReveal) {
          el.classList.add("track-dl-btn--reveal");
          el.disabled = false;
          el.setAttribute("aria-label", "Show downloaded file in folder");
          el.setAttribute("data-tip", "Show in folder");
          el.innerHTML =
            '<span class="track-dl-btn-fill"></span>' +
            '<span class="track-dl-btn-ico-stack">' +
            `<span class="track-dl-btn-ico-layer track-dl-btn-ico--dl">${TRACK_DL_ICON_SVG}</span>` +
            `<span class="track-dl-btn-ico-layer track-dl-btn-ico--folder">${TRACK_FOLDER_ICON_SVG}</span>` +
            "</span>";
        } else {
          el.setAttribute("aria-label", "Downloaded");
        }
      } else if (cls === "failed") {
        el.classList.add("track-dl-btn--failed");
        const failMsg = String(statusText || "").trim();
        const tip =
          failMsg && failMsg.toLowerCase() !== "failed"
            ? failMsg
            : "Download failed";
        el.setAttribute("data-tip", tip);
        el.setAttribute("aria-label", tip);
        el.innerHTML = TRACK_DL_FAIL_SVG;
      } else {
        el.classList.add("track-dl-btn--active");
        el.setAttribute("aria-label", "Downloading");
        const savedPct = parseInt(card.dataset.dlProgressPct || "0", 10);
        if (Number.isFinite(savedPct) && savedPct > 0) {
          const fillEl = el.querySelector(".track-dl-btn-fill");
          if (fillEl) {
            fillEl.style.transform = `scaleY(${Math.min(100, savedPct) / 100})`;
          }
          el.setAttribute("aria-label", `Downloading, ${savedPct}%`);
        }
      }
      tags.appendChild(el);
      if (cls === "failed") {
        finalizeSubstituteSearchBtn(tags, card);
      } else if (
        cls === "done" &&
        (card.dataset.attachSearchEligible === "1" ||
          card.dataset.resolvedBy === "placeholder")
      ) {
        finalizeSubstituteSearchBtn(tags, card);
      }
    }

    function trackStatusCardForProgress(trackNo, title, lyricAlbum) {
      const parsed = parseTrackRef(trackNo, title);
      const pa =
        lyricAlbum != null && String(lyricAlbum).trim() !== ""
          ? String(lyricAlbum).trim()
          : "";
      const cardMap = getCardMap();
      let key = trackKey(parsed.trackNo, parsed.title, pa);
      let card = key ? cardMap.get(key) : null;
      if (!card && pa) {
        key = trackKey(parsed.trackNo, parsed.title, "");
        card = key ? cardMap.get(key) : null;
      }
      if (!card) {
        const wantN = normalizeTrackNo(parsed.trackNo);
        const wantT = normalizeTrackTitle(parsed.title);
        for (const c of cardMap.values()) {
          const tn = normalizeTrackNo(c.dataset.trackNo || "");
          const tEl = c.querySelector(".track-status-title");
          const tt = normalizeTrackTitle((tEl && tEl.textContent) || "");
          if (tn === wantN && tt === wantT) {
            card = c;
            break;
          }
        }
      }
      return card;
    }

    function updateTrackDownloadProgress(
      trackNo,
      title,
      received,
      total,
      lyricAlbum,
    ) {
      const card = trackStatusCardForProgress(trackNo, title, lyricAlbum);
      if (!card) return;
      const btn = card.querySelector("button.download-chip.track-dl-btn");
      if (!btn || !btn.classList.contains("track-dl-btn--active")) return;
      const t = Number(total);
      const r = Number(received);
      if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(r)) return;
      const rawPct = Math.max(0, Math.min(100, Math.round((r / t) * 100)));
      const prevPct = parseInt(card.dataset.dlProgressPct || "0", 10);
      const pct =
        Number.isFinite(prevPct) && prevPct > 0
          ? Math.max(prevPct, rawPct)
          : rawPct;
      card.dataset.dlProgressPct = String(pct);
      const fill = btn.querySelector(".track-dl-btn-fill");
      if (fill) {
        const f = pct / 100;
        fill.style.transform = `scaleY(${f})`;
      }
      btn.setAttribute("aria-label", `Downloading, ${pct}%`);
    }

    function confidenceChipStyles(pct) {
      const uiTheme = window.QobuzGui?.ui?.theme;
      if (uiTheme && typeof uiTheme.confidenceChipStylesFromPct === "function") {
        return uiTheme.confidenceChipStylesFromPct(pct);
      }
      const p = Math.max(0, Math.min(100, pct)) / 100;
      const r0 = 255;
      const g0 = 77;
      const b0 = 77;
      const r1 = 110;
      const g1 = 231;
      const b1 = 247;
      const r = Math.round(r0 + (r1 - r0) * p);
      const g = Math.round(g0 + (g1 - g0) * p);
      const b = Math.round(b0 + (b1 - b0) * p);
      const tint =
        typeof uiTheme?.chipSurfaceAlphas === "function"
          ? uiTheme.chipSurfaceAlphas().tint
          : 0.12;
      const border =
        typeof uiTheme?.chipSurfaceAlphas === "function"
          ? uiTheme.chipSurfaceAlphas().border
          : 0.45;
      return {
        color: `rgb(${r},${g},${b})`,
        borderColor: `rgba(${r},${g},${b},${border})`,
        background: `rgba(${r},${g},${b},${tint})`,
      };
    }

    function positionConfidenceTooltip(wrap, tip) {
      if (!wrap || !tip || !tip.classList.contains("confidence-chip-tooltip--open"))
        return;
      if (!wrap.isConnected) {
        hideConfidenceTooltip(wrap, tip);
        return;
      }
      if (tip.parentNode !== document.body) document.body.appendChild(tip);
      tip.classList.add("confidence-chip-tooltip--fixed");
      requestAnimationFrame(() => {
        if (!wrap.isConnected) {
          hideConfidenceTooltip(wrap, tip);
          return;
        }
        const r = wrap.getBoundingClientRect();
        if (r.width <= 0 && r.height <= 0) {
          hideConfidenceTooltip(wrap, tip);
          return;
        }
        const tw = tip.offsetWidth;
        const th = tip.offsetHeight;
        const pad = 8;
        let left = r.right - tw;
        left = Math.max(pad, Math.min(left, window.innerWidth - tw - pad));
        let top = r.top - th - pad;
        if (top < pad)
          top = Math.min(r.bottom + pad, window.innerHeight - th - pad);
        tip.style.left = `${Math.round(left)}px`;
        tip.style.top = `${Math.round(Math.max(pad, top))}px`;
      });
    }

    function hideConfidenceTooltip(wrap, tip) {
      if (!tip) return;
      tip.classList.remove("confidence-chip-tooltip--open");
      tip.classList.remove("confidence-chip-tooltip--fixed");
      tip.style.left = "";
      tip.style.top = "";
      if (wrap && wrap.isConnected && tip.parentNode === document.body) {
        wrap.appendChild(tip);
      }
    }

    function dismissAllConfidenceTooltips() {
      document.querySelectorAll(".confidence-chip-wrap").forEach((wrap) => {
        if (typeof wrap._confidenceTooltipTeardown === "function") {
          wrap._confidenceTooltipTeardown();
          return;
        }
        const tip = wrap.querySelector(".confidence-chip-tooltip");
        if (tip) hideConfidenceTooltip(wrap, tip);
      });
      document
        .querySelectorAll(".confidence-chip-tooltip.confidence-chip-tooltip--open")
        .forEach((tip) => {
          tip.classList.remove("confidence-chip-tooltip--open");
          tip.classList.remove("confidence-chip-tooltip--fixed");
          tip.style.left = "";
          tip.style.top = "";
        });
    }

    function bindConfidenceTooltipUi(wrap, tip) {
      const listEl = document.getElementById("dl-track-status");

      function targetInside(container, target) {
        if (!container || !target || !(target instanceof Node)) return false;
        return container === target || container.contains(target);
      }

      function hideUnlessMovingToTip(e) {
        const next = e.relatedTarget;
        if (targetInside(tip, next) || targetInside(wrap, next)) return;
        hideConfidenceTooltip(wrap, tip);
      }

      function showTip() {
        tip.classList.add("confidence-chip-tooltip--open");
        positionConfidenceTooltip(wrap, tip);
      }

      function onScrollOrResize() {
        if (tip.classList.contains("confidence-chip-tooltip--open")) {
          positionConfidenceTooltip(wrap, tip);
        }
      }

      const onMouseEnterWrap = () => showTip();
      const onMouseEnterTip = () => showTip();
      const onMouseLeaveWrap = (e) => hideUnlessMovingToTip(e);
      const onMouseLeaveTip = (e) => hideUnlessMovingToTip(e);
      const onFocusInWrap = () => showTip();
      const onFocusOutWrap = (e) => hideUnlessMovingToTip(e);

      wrap.addEventListener("mouseenter", onMouseEnterWrap);
      wrap.addEventListener("mouseleave", onMouseLeaveWrap);
      tip.addEventListener("mouseenter", onMouseEnterTip);
      tip.addEventListener("mouseleave", onMouseLeaveTip);
      wrap.addEventListener("focusin", onFocusInWrap);
      wrap.addEventListener("focusout", onFocusOutWrap);
      window.addEventListener("resize", onScrollOrResize);
      if (listEl)
        listEl.addEventListener("scroll", onScrollOrResize, { passive: true });
      window.addEventListener("scroll", onScrollOrResize, true);

      wrap._confidenceTooltipTeardown = () => {
        hideConfidenceTooltip(wrap, tip);
        wrap.removeEventListener("mouseenter", onMouseEnterWrap);
        wrap.removeEventListener("mouseleave", onMouseLeaveWrap);
        tip.removeEventListener("mouseenter", onMouseEnterTip);
        tip.removeEventListener("mouseleave", onMouseLeaveTip);
        wrap.removeEventListener("focusin", onFocusInWrap);
        wrap.removeEventListener("focusout", onFocusOutWrap);
        window.removeEventListener("resize", onScrollOrResize);
        if (listEl) listEl.removeEventListener("scroll", onScrollOrResize);
        window.removeEventListener("scroll", onScrollOrResize, true);
        delete wrap._confidenceTooltipTeardown;
      };
    }

    function setLyricConfidenceChip(tags, pct) {
      let wrap = tags.querySelector(".confidence-chip-wrap");
      const chipHtml = `
      <span class="track-status-chip confidence-chip"></span>
      <div class="confidence-chip-tooltip" role="tooltip">
        <div class="confidence-chip-tooltip-title">Lyric match confidence</div>
        <div class="confidence-chip-tooltip-desc">How well the LRCLIB result matches this track’s artist, title, length, and album. Higher means we’re more sure it’s the right song.</div>
      </div>
    `;
      if (wrap) {
        if (typeof wrap._confidenceTooltipTeardown === "function") {
          wrap._confidenceTooltipTeardown();
        }
        wrap.remove();
      }
      wrap = document.createElement("span");
      wrap.className = "confidence-chip-wrap";
      wrap.setAttribute("tabindex", "0");
      wrap.innerHTML = chipHtml;
      const chip = wrap.querySelector(".confidence-chip");
      const tip = wrap.querySelector(".confidence-chip-tooltip");
      chip.textContent = `${pct}%`;
      chip.dataset.confidencePct = String(pct);
      const uiTheme = window.QobuzGui?.ui?.theme;
      if (uiTheme && typeof uiTheme.applyConfidenceChipEl === "function") {
        uiTheme.applyConfidenceChipEl(chip, pct);
      } else {
        const styles = confidenceChipStyles(pct);
        chip.style.color = styles.color;
        chip.style.borderColor = styles.borderColor;
        chip.style.background = styles.background;
      }
      wrap.setAttribute(
        "aria-label",
        `Lyric match confidence ${pct} percent. Hover for details.`,
      );
      const lyricsChip = tags.querySelector(".track-status-chip.lyrics-chip");
      const download = tags.querySelector(".download-chip");
      if (lyricsChip) tags.insertBefore(wrap, lyricsChip);
      else if (download) tags.insertBefore(wrap, download);
      else tags.appendChild(wrap);

      bindConfidenceTooltipUi(wrap, tip);
    }

    function removeLyricConfidenceChip(tags) {
      const wrap = tags.querySelector(".confidence-chip-wrap");
      if (!wrap) return;
      if (typeof wrap._confidenceTooltipTeardown === "function") {
        wrap._confidenceTooltipTeardown();
      }
      wrap.remove();
    }

    function normalizeLyricDestination(destination) {
      const d = String(destination || "")
        .trim()
        .toLowerCase();
      if (
        d === "both" ||
        d === "lrc" ||
        d === ".lrc" ||
        d === "embed" ||
        d === "metadata"
      ) {
        return d === ".lrc" ? "lrc" : d === "metadata" ? "embed" : d;
      }
      return "";
    }

    function lyricDestinationFromOutputs(outputs) {
      const lrc = !!(outputs && outputs.lrc);
      const metadata = !!(outputs && outputs.metadata);
      if (lrc && metadata) return "both";
      if (lrc) return "lrc";
      if (metadata) return "embed";
      return "";
    }

    function lyricDestinationLabel(destination) {
      const d = normalizeLyricDestination(destination);
      if (d === "both") return "both";
      if (d === "lrc") return ".lrc";
      if (d === "embed") return "embed";
      return "";
    }

    function removeDuplicateHistoryCards(keepCard, opts) {
      const cardMap = getCardMap();
      if (!keepCard || !cardMap) return;
      const sid = String(
        (opts && opts.slotTrackId) || keepCard.dataset.slotTrackId || "",
      ).trim();
      const ap = String(
        (opts && opts.audioPath) || keepCard.dataset.audioPath || "",
      ).trim();
      const orderAll =
        typeof deps.getOrderAll === "function" ? deps.getOrderAll() : null;
      const doomed = new Set();
      for (const c of cardMap.values()) {
        if (!c || c === keepCard) continue;
        const sameSid = sid && (c.dataset.slotTrackId || "").trim() === sid;
        const sameAp = ap && (c.dataset.audioPath || "").trim() === ap;
        if (sameSid || sameAp) doomed.add(c);
      }
      for (const c of doomed) {
        const oldKey = (c.dataset.trackKey || "").trim();
        if (oldKey) {
          cardMap.delete(oldKey);
          if (orderAll) {
            const idx = orderAll.indexOf(oldKey);
            if (idx >= 0) orderAll.splice(idx, 1);
          }
        }
        c.remove();
      }
    }

    function setTrackLyricsChip(
      trackNo,
      title,
      lyricType,
      confidence,
      lyricAlbum,
      lyricProvider,
      lyricDestination,
      audioPath,
    ) {
      const card = ensureTrackStatusCard(
        trackNo,
        title,
        false,
        undefined,
        lyricAlbum,
        "",
        audioPath || "",
      );
      if (!card) return;
      const tags = card.querySelector(".track-status-tags");
      let chip = card.querySelector(".track-status-chip.lyrics-chip");
      if (!chip) {
        chip = document.createElement("span");
        chip.className = "track-status-chip lyrics-chip";
        tags.appendChild(chip);
      }
      const lt = String(lyricType || "none").toLowerCase();
      chip.className = `track-status-chip lyrics-chip ${lt}`;
      const confRaw =
        confidence != null && String(confidence).trim() !== ""
          ? String(confidence).trim()
          : "";
      const confNum = confRaw !== "" ? parseInt(confRaw, 10) : NaN;
      const hasConf =
        !Number.isNaN(confNum) && confRaw !== "" && lt !== "loading";
      const dest = normalizeLyricDestination(lyricDestination);

      chip.textContent =
        lt === "none"
          ? "none"
          : lt === "error"
            ? "error"
            : lt === "loading"
              ? "loading"
              : lt;
      if (dest) {
        chip.dataset.lyricDestination = dest;
      } else {
        delete chip.dataset.lyricDestination;
      }
      chip.removeAttribute("title");
      const outputDesc =
        dest === "both"
          ? ".lrc + Embedded"
          : dest === "lrc"
            ? ".lrc"
            : dest === "embed"
              ? "Embedded"
              : "";
      if (outputDesc && lt !== "loading" && lt !== "none" && lt !== "error") {
        chip.setAttribute("aria-label", `${lt} lyrics, ${outputDesc}`);
        chip.setAttribute("data-tip", outputDesc);
      } else {
        chip.removeAttribute("aria-label");
        chip.removeAttribute("data-tip");
      }

      if (lt === "loading" || !hasConf) {
        removeLyricConfidenceChip(tags);
      } else {
        setLyricConfidenceChip(tags, confNum);
      }

      const apHist = (card.dataset.audioPath || "").trim();
      if (apHist && lt !== "loading") {
        void api.historyApi
          .postLyrics({
            audio_path: apHist,
            lyric_type: lt,
            lyric_provider:
              lyricProvider != null ? String(lyricProvider) : "",
            lyric_confidence: confRaw,
            lyric_destination: dest,
          })
          .catch(() => {});
      }
    }

    return {
      setTrackCardCover,
      buildTrackStatusCardEl,
      ensureTrackStatusCard,
      removeDuplicateHistoryCards,
      setTrackContentRatingBadge,
      setTrackDownloadChip,
      setTrackLyricsChip,
      trackStatusCardForProgress,
      updateTrackDownloadProgress,
      normalizeLyricDestination,
      lyricDestinationFromOutputs,
      lyricDestinationLabel,
      dismissAllConfidenceTooltips,
    };
  }

  hroot.internals = hroot.internals || {};
  hroot.internals.bootstrapCardRendering = bootstrap;
})();
