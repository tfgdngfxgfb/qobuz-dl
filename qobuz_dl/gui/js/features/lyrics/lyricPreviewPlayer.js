(function () {
  "use strict";

  const g = window.QobuzGui;
  const features = (g.features = g.features || {});
  const lyrics = (features.lyrics = features.lyrics || {});

  let _deps = {};
  let _lyricPreviewRaf = 0;
  let _lyricPreviewLastActiveIdx = -1;
  let _lyricPreviewSeekMouse = false;

  function mergeDeps(deps) {
    _deps = { ...(_deps || {}), ...(deps || {}) };
  }

  function parseLrcLines(synced) {
    const parser =
      g.features?.lyrics?.internals?.parseLrcLinesForPreview;
    return typeof parser === "function" ? parser(synced) : [];
  }

  function previewAudioUrl(audioPath) {
    if (!audioPath) return "";
    return `/api/lyrics/stream-audio?path=${encodeURIComponent(audioPath)}`;
  }

  function formatLyricPreviewTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function teardown() {
    if (_lyricPreviewRaf) {
      cancelAnimationFrame(_lyricPreviewRaf);
      _lyricPreviewRaf = 0;
    }
    _lyricPreviewSeekMouse = false;
    _lyricPreviewLastActiveIdx = -1;
    const audio = document.getElementById("lyric-search-preview-audio");
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    const playBtn = document.getElementById("lyric-search-preview-play");
    if (playBtn) {
      const playIco = playBtn.querySelector(".lyric-search-preview-play-icon");
      const pauseIco = playBtn.querySelector(".lyric-search-preview-pause-icon");
      if (playIco) playIco.classList.remove("hidden");
      if (pauseIco) pauseIco.classList.add("hidden");
      playBtn.setAttribute("aria-label", "Play");
    }
    const seek = document.getElementById("lyric-search-preview-seek");
    const cur = document.getElementById("lyric-search-preview-cur");
    const dur = document.getElementById("lyric-search-preview-dur");
    if (seek) seek.value = "0";
    if (cur) cur.textContent = "0:00";
    if (dur) dur.textContent = "0:00";
  }

  function lyricPreviewSetPlayingUi(playing) {
    const playBtn = document.getElementById("lyric-search-preview-play");
    if (!playBtn) return;
    const playIco = playBtn.querySelector(".lyric-search-preview-play-icon");
    const pauseIco = playBtn.querySelector(".lyric-search-preview-pause-icon");
    if (playIco) playIco.classList.toggle("hidden", playing);
    if (pauseIco) pauseIco.classList.toggle("hidden", !playing);
    playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
  }

  function lyricPreviewSyncSeekAndTimeFromAudio() {
    if (_lyricPreviewSeekMouse) return;
    const audio = document.getElementById("lyric-search-preview-audio");
    const seek = document.getElementById("lyric-search-preview-seek");
    const cur = document.getElementById("lyric-search-preview-cur");
    if (!audio || !seek || !cur) return;
    const d = audio.duration;
    if (Number.isFinite(d) && d > 0) {
      seek.value = String(Math.round((audio.currentTime / d) * 1000));
    }
    cur.textContent = formatLyricPreviewTime(audio.currentTime);
  }

  function lyricPreviewUpdateActiveLine(progressMs, opts = {}) {
    const body = document.getElementById("lyric-search-preview-body");
    if (!body || !body.classList.contains("lyric-search-preview-body--synced")) {
      return;
    }
    const rows = body.querySelectorAll(".lyric-preview-line");
    if (!rows.length) return;
    let active = -1;
    for (let i = 0; i < rows.length; i++) {
      const start = Number(rows[i].dataset.startMs || 0);
      const end = Number(rows[i].dataset.endMs || Number.POSITIVE_INFINITY);
      if (progressMs >= start && progressMs < end) active = i;
    }
    if (active < 0) {
      for (let i = rows.length - 1; i >= 0; i--) {
        const start = Number(rows[i].dataset.startMs || 0);
        if (progressMs >= start) {
          active = i;
          break;
        }
      }
    }
    for (let i = 0; i < rows.length; i++) {
      rows[i].classList.toggle("is-active", i === active);
    }
    if (active >= 0 && active !== _lyricPreviewLastActiveIdx) {
      const previousActive = _lyricPreviewLastActiveIdx;
      _lyricPreviewLastActiveIdx = active;
      if (!_lyricPreviewSeekMouse || opts.forceScroll) {
        const targetIdx =
          previousActive >= 0 && active < previousActive
            ? Math.max(active - 2, 0)
            : Math.min(active + 2, rows.length - 1);
        const scrollTarget = rows[targetIdx];
        scrollTarget.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    } else if (active < 0) {
      _lyricPreviewLastActiveIdx = -1;
    }
  }

  /** Apply range value to audio (used while dragging and on release). */
  function applyLyricPreviewSeekSliderValue(scrollWhileSeeking = false) {
    const audio = document.getElementById("lyric-search-preview-audio");
    const seek = document.getElementById("lyric-search-preview-seek");
    if (!audio || !seek || seek.disabled) return;
    const d = audio.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    const t = (Number(seek.value) / 1000) * d;
    audio.currentTime = t;
    const cur = document.getElementById("lyric-search-preview-cur");
    if (cur) cur.textContent = formatLyricPreviewTime(t);
    lyricPreviewUpdateActiveLine(t * 1000, { forceScroll: scrollWhileSeeking });
  }

  function lyricPreviewSeekToTime(seconds) {
    const audio = document.getElementById("lyric-search-preview-audio");
    const seek = document.getElementById("lyric-search-preview-seek");
    if (!audio || !seek || seek.disabled || !audio.src) return;
    const d = audio.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    const t = Math.min(Math.max(0, seconds), d);
    audio.currentTime = t;
    seek.value = String(Math.round((t / d) * 1000));
    const cur = document.getElementById("lyric-search-preview-cur");
    if (cur) cur.textContent = formatLyricPreviewTime(t);
    lyricPreviewUpdateActiveLine(t * 1000);
  }

  function lyricPreviewFrame() {
    const audio = document.getElementById("lyric-search-preview-audio");
    if (!audio || audio.paused || audio.ended) {
      _lyricPreviewRaf = 0;
      return;
    }
    lyricPreviewSyncSeekAndTimeFromAudio();
    lyricPreviewUpdateActiveLine(audio.currentTime * 1000);
    _lyricPreviewRaf = requestAnimationFrame(lyricPreviewFrame);
  }

  function renderSynced(body, parsed) {
    body.classList.add("lyric-search-preview-body--synced");
    body.replaceChildren();
    for (let i = 0; i < parsed.length; i++) {
      const row = document.createElement("div");
      row.className = "lyric-preview-line";
      row.dataset.startMs = String(parsed[i].start_ms);
      row.dataset.endMs = String(parsed[i].end_ms);
      const ts = document.createElement("span");
      ts.className = "lyric-preview-ts";
      ts.textContent = parsed[i].timeTag || "";
      const tx = document.createElement("span");
      tx.className = "lyric-preview-text";
      tx.textContent = parsed[i].text || " ";
      row.appendChild(ts);
      row.appendChild(tx);
      body.appendChild(row);
    }
  }

  function renderPlain(body, text) {
    body.classList.remove("lyric-search-preview-body--synced");
    body.textContent = text || "";
  }

  function close() {
    teardown();
    const panel = document.getElementById("lyric-search-preview-panel");
    if (panel) {
      panel.classList.add("hidden");
      panel.setAttribute("aria-hidden", "true");
    }
    const oc = _deps.onOverlayClosed;
    if (typeof oc === "function") {
      oc();
    }
  }

  function init(deps) {
    mergeDeps(deps);

    const playBtn = document.getElementById("lyric-search-preview-play");
    const seek = document.getElementById("lyric-search-preview-seek");
    const audio = document.getElementById("lyric-search-preview-audio");
    const previewRoot = document.getElementById("lyric-search-preview");
    if (!playBtn || !seek || !audio) return;
    if (playBtn.dataset.bound === "1") return;
    playBtn.dataset.bound = "1";
    playBtn.addEventListener("click", () => {
      if (playBtn.disabled || !audio.src) return;
      if (audio.paused) {
        void audio.play();
      } else {
        audio.pause();
      }
    });
    seek.addEventListener("pointerdown", (e) => {
      _lyricPreviewSeekMouse = true;
      try {
        seek.setPointerCapture(e.pointerId);
      } catch (_) {
        /* ignore */
      }
    });
    function finishLyricPreviewSeekDrag() {
      const wasDragging = _lyricPreviewSeekMouse;
      _lyricPreviewSeekMouse = false;
      if (!wasDragging) return;
      _lyricPreviewLastActiveIdx = -1;
      if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
        lyricPreviewUpdateActiveLine(audio.currentTime * 1000);
      }
    }
    seek.addEventListener("pointerup", (e) => {
      try {
        seek.releasePointerCapture(e.pointerId);
      } catch (_) {
        /* ignore */
      }
      finishLyricPreviewSeekDrag();
    });
    seek.addEventListener("pointercancel", () => {
      finishLyricPreviewSeekDrag();
    });
    seek.addEventListener("lostpointercapture", () => {
      finishLyricPreviewSeekDrag();
    });
    seek.addEventListener("change", () => {
      applyLyricPreviewSeekSliderValue();
    });
    seek.addEventListener("input", () => {
      applyLyricPreviewSeekSliderValue(true);
    });
    if (previewRoot && previewRoot.dataset.lineSeekBound !== "1") {
      previewRoot.dataset.lineSeekBound = "1";
      previewRoot.addEventListener("click", (e) => {
        const line = e.target.closest(".lyric-preview-line");
        if (!line || !previewRoot.contains(line)) return;
        const bodyEl = document.getElementById("lyric-search-preview-body");
        if (
          !bodyEl ||
          !bodyEl.classList.contains("lyric-search-preview-body--synced")
        ) {
          return;
        }
        const startMs = Number(line.dataset.startMs);
        if (!Number.isFinite(startMs)) return;
        lyricPreviewSeekToTime(startMs / 1000);
      });
    }
    audio.addEventListener("play", () => {
      lyricPreviewSetPlayingUi(true);
      if (!_lyricPreviewRaf) {
        _lyricPreviewRaf = requestAnimationFrame(lyricPreviewFrame);
      }
    });
    audio.addEventListener("pause", () => {
      lyricPreviewSetPlayingUi(false);
      if (_lyricPreviewRaf) {
        cancelAnimationFrame(_lyricPreviewRaf);
        _lyricPreviewRaf = 0;
      }
    });
    audio.addEventListener("ended", () => {
      lyricPreviewSetPlayingUi(false);
    });
    audio.addEventListener("loadedmetadata", () => {
      const durEl = document.getElementById("lyric-search-preview-dur");
      const d = audio.duration;
      if (durEl && Number.isFinite(d)) {
        durEl.textContent = formatLyricPreviewTime(d);
      }
    });
  }

  lyrics.preview = {
    init,
    close,
    teardown,
    parseLrcLines,
    renderSynced,
    renderPlain,
    previewAudioUrl,
  };
})();
