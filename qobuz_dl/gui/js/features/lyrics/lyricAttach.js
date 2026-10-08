(function () {
  "use strict";
  const g = window.QobuzGui;
  const api = g && g.api;
  const features = (g.features = g.features || {});
  const lyrics = (features.lyrics = features.lyrics || {});

  let _deps = {};

  function configure(deps) {
    _deps = { ...(_deps || {}), ...(deps || {}) };
  }

  function preview() {
    return lyrics.preview;
  }

  function positionPopover() {
    const fn = _deps.positionPopover;
    if (typeof fn === "function") {
      fn();
    }
  }

  async function previewRow(ctx, id) {
    const pv = preview();
    if (!pv) return;
    if (ctx && ctx.previewingLrclibId === id) return;
    if (ctx) ctx.previewingLrclibId = id;
    pv.teardown();
    const panel = document.getElementById("lyric-search-preview-panel");
    const prev = document.getElementById("lyric-search-preview");
    const body = document.getElementById("lyric-search-preview-body");
    const flag = document.getElementById("lyric-search-preview-flag");
    const audio = document.getElementById("lyric-search-preview-audio");
    const playBtn = document.getElementById("lyric-search-preview-play");
    const seek = document.getElementById("lyric-search-preview-seek");
    const audioPath = ctx && ctx.audioPath ? String(ctx.audioPath).trim() : "";
    const idNum = id != null ? Number(id) : NaN;
    const attachedId =
      ctx && ctx.attachedLrclibId != null ? Number(ctx.attachedLrclibId) : NaN;
    const shouldUseLocal =
      audioPath &&
      Number.isFinite(idNum) &&
      Number.isFinite(attachedId) &&
      idNum === attachedId;
    if (!prev || !body) return;
    pv.renderPlain(body, "Loading\u2026");
    if (playBtn) playBtn.disabled = true;
    if (seek) seek.disabled = true;
    if (flag) {
      flag.classList.add("hidden");
      flag.textContent = "";
    }
    if (panel) {
      panel.classList.remove("hidden");
      panel.setAttribute("aria-hidden", "false");
      requestAnimationFrame(() => positionPopover());
    }

    let currentPreviewBtn = null;
    document
      .querySelectorAll("#lyric-search-results .btn-ghost")
      .forEach((btn) => {
        if (btn.dataset.rid === String(id)) {
          currentPreviewBtn = btn;
          btn.classList.add("is-previewing");
          const w = btn.offsetWidth;
          if (w > 0) btn.style.width = w + "px";
          btn.innerHTML = '<span class="spinner"></span>';
        } else {
          btn.classList.remove("is-previewing");
          btn.textContent = "Preview";
          btn.style.width = "";
        }
      });

    try {
      let res;
      if (shouldUseLocal) {
        res = await api.lyricsApi.local(audioPath);
        if (!res.ok) {
          res = await api.lyricsApi.fetchById(id);
        }
      } else {
        res = await api.lyricsApi.fetchById(id);
      }
      const data = await res.json();
      if (!data.ok) {
        pv.renderPlain(body, data.error || "Fetch failed.");
        return;
      }
      const rec = data.record || {};
      const synced = (rec.syncedLyrics || "").trim();
      const plain = (rec.plainLyrics || "").trim();
      if (synced) {
        const parsed = pv.parseLrcLines(synced);
        if (parsed.length) {
          pv.renderSynced(body, parsed);
        } else {
          pv.renderPlain(body, synced || plain || "(empty)");
        }
      } else {
        pv.renderPlain(body, plain || "(empty)");
      }
      if (audioPath && audio) {
        audio.src = pv.previewAudioUrl(audioPath);
        if (playBtn) playBtn.disabled = false;
        if (seek) seek.disabled = false;
      } else {
        if (audio) {
          audio.removeAttribute("src");
          audio.load();
        }
        if (playBtn) playBtn.disabled = true;
        if (seek) seek.disabled = true;
      }
      if (flag) {
        flag.classList.remove("hidden");
        const badge = _deps.explicitBadgeSvg || "";
        if (data.lyrics_explicit) {
          flag.className =
            "lyric-search-preview-flag lyric-search-preview-flag--explicit";
          flag.innerHTML = `${badge}<span class="lyric-search-preview-flag-text">Explicit: Lyric text contains explicit language.</span>`;
        } else {
          flag.className =
            "lyric-search-preview-flag lyric-search-preview-flag--clean";
          flag.innerHTML =
            '<span class="lyric-search-preview-flag-text lyric-search-preview-flag-text--clean">Clean: No explicit language detected in these lyrics.</span>';
        }
      }
    } catch (_) {
      pv.renderPlain(body, "Network error.");
    } finally {
      if (currentPreviewBtn && currentPreviewBtn.dataset.rid === String(id)) {
        currentPreviewBtn.textContent = "Preview";
        currentPreviewBtn.style.width = "";
      }
      requestAnimationFrame(() => positionPopover());
    }
  }

  async function attachRow(ctx, id, confidence, kind, triggerBtn) {
    if (!ctx || !ctx.audioPath) return;
    const idNum = id != null ? Number(id) : NaN;
    if (!Number.isFinite(idNum)) return;
    const lyricTypeRaw =
      kind != null && String(kind).trim() !== ""
        ? String(kind).trim().toLowerCase()
        : "synced";
    let confForChip = "";
    if (confidence != null && String(confidence).trim() !== "") {
      const n = Math.round(Number(confidence));
      if (Number.isFinite(n)) {
        confForChip = String(Math.max(0, Math.min(100, n)));
      }
    }
    const prevBtnText = triggerBtn ? triggerBtn.textContent : "";
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.textContent = "Attaching\u2026";
    }
    const statusEl = document.getElementById("lyric-search-status");
    const lyricOut = _deps.lyricOutputSettings;
    const lyricOutputs =
      lyricOut && typeof lyricOut.readChecks === "function"
        ? lyricOut.readChecks("popover")
        : { lrc: true, metadata: true };
    try {
      const res = await api.lyricsApi.attach({
        audio_path: ctx.audioPath,
        lrclib_id: idNum,
        write_sidecar: lyricOutputs.lrc,
        write_metadata: lyricOutputs.metadata,
      });
      const data = await res.json();
      if (!data.ok) {
        if (statusEl) {
          statusEl.textContent = data.error || "Attach failed.";
          statusEl.classList.remove("hidden");
        }
        if (triggerBtn) {
          triggerBtn.disabled = false;
          triggerBtn.textContent = prevBtnText;
        }
        return;
      }
      ctx.attachedLrclibId = idNum;
      const anchor = ctx.anchorCard;
      const setChip = _deps.setLyricsChip;
      const destFn = _deps.lyricDestinationFromOutputs;
      if (anchor && typeof setChip === "function") {
        const tEl = anchor.querySelector(".track-status-title");
        const tTitle = ((tEl && tEl.textContent) || "").trim();
        const tNo = (anchor.dataset.trackNo || "").trim();
        if (tNo && tTitle) {
          setChip(
            tNo,
            tTitle,
            lyricTypeRaw,
            confForChip !== "" ? confForChip : null,
            (anchor.dataset.lyricAlbum || "").trim(),
            "Lrclib",
            typeof destFn === "function" ? destFn(lyricOutputs) : "",
          );
        }
      }
      if (ctx.lastSearchResults && ctx.lastSearchResults.length) {
        const rebuild = _deps.rebuildVisibleRows;
        if (typeof rebuild === "function") rebuild(ctx);
      }
      if (statusEl) {
        statusEl.textContent = "Lyrics attached to file.";
        statusEl.classList.remove("hidden");
      }
      requestAnimationFrame(() => positionPopover());
    } catch (_) {
      if (statusEl) {
        statusEl.textContent = "Network error.";
        statusEl.classList.remove("hidden");
      }
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.textContent = prevBtnText;
      }
    }
  }

  lyrics.attach = {
    configure,
    previewRow,
    attachRow,
  };
})();
