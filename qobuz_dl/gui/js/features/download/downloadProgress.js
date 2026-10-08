/**
 * Download progress bar + Start/Pause button state (D1B).
 *
 * Invoked once from `app.js` `initDownload()` via `bootstrapProgress(deps)`.
 */
(function () {
  "use strict";
  const g = window.QobuzGui;
  const dlroot = (g.features.download = g.features.download || {});

  function bootstrapProgress(deps) {
    let urlTotal = 0;
    let urlDone = 0;
    let trackTotal = 0;
    let trackDone = 0;
    let totalLocked = false;
    const trackFinished = new Set();

    function updateProgress() {
      const fill = document.getElementById("dl-progress-fill");
      const label = document.getElementById("dl-progress-label");
      const cap = Math.max(trackTotal, trackDone);

      if (fill) {
        const pct = cap > 0 ? Math.round((trackDone / cap) * 100) : 0;
        fill.style.width = pct + "%";
      }
      if (label) {
        label.textContent = `${trackDone} / ${cap} tracks`;
        label.title = "";
      }
    }

    function setDownloadingState(isDownloading) {
      const dlBtn = document.getElementById("dl-btn");
      const progressWrap = document.getElementById("dl-progress-wrap");
      window.isDownloading = isDownloading;
      if (!dlBtn || !progressWrap) return;

      if (isDownloading) {
        dlBtn.dataset.state = "downloading";
        dlBtn.innerHTML = `
          <span class="dl-btn-body">
            <svg id="dl-btn-icon" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"
                 aria-hidden="true">
              <rect x="4" y="4" width="6" height="16" rx="1.5"/>
              <rect x="14" y="4" width="6" height="16" rx="1.5"/>
            </svg>
            <span id="dl-btn-text">Pause</span>
          </span>`;
        dlBtn.disabled = false;
        progressWrap.classList.remove("hidden");
        updateProgress();
        document
          .querySelectorAll("#dl-queue .queue-card-remove")
          .forEach((b) => {
            b.style.display = "none";
          });
      } else {
        dlBtn.dataset.state = "idle";
        dlBtn.innerHTML = `
          <span class="dl-btn-body">
            <svg id="dl-btn-icon" width="15" height="15" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span id="dl-btn-text">Start Download</span>
          </span>
          <span id="dl-btn-badge" class="dl-btn-badge hidden" aria-live="polite"></span>`;
        const updateBadge = deps.updateQueueBadge;
        if (typeof updateBadge === "function") {
          updateBadge();
        } else if (typeof window._updateQueueBadge === "function") {
          window._updateQueueBadge();
        }
        dlBtn.disabled = false;
        document
          .querySelectorAll("#dl-queue .queue-card-remove")
          .forEach((b) => {
            b.style.display = "";
          });
        setTimeout(() => progressWrap.classList.add("hidden"), 2000);
      }
    }

    function resetForStart(opts) {
      const o = opts || {};
      urlTotal = o.urlQueued || 0;
      urlDone = 0;
      trackTotal = o.trackTotal || 0;
      trackDone = 0;
      totalLocked = false;
      trackFinished.clear();
    }

    function onTotalTracks(count) {
      trackTotal = count;
      totalLocked = true;
      updateProgress();
    }

    function recordTrackFinished(slotKey) {
      const key = String(slotKey || "");
      if (!key || trackFinished.has(key)) return false;
      trackFinished.add(key);
      trackDone++;
      if (!totalLocked && trackDone > trackTotal) {
        trackTotal = trackDone + 1;
      }
      return true;
    }

    function onUrlDone() {
      urlDone++;
      if (trackDone > trackTotal) trackTotal = trackDone;
      updateProgress();
    }

    function onUrlError() {
      urlDone++;
      updateProgress();
    }

    function finalizeOnDlComplete(ev) {
      trackTotal = Math.max(trackTotal, trackDone);
      const fill = document.getElementById("dl-progress-fill");
      const holdProg = Boolean(ev && (ev.cancelled || ev.paused));
      if (fill) {
        fill.style.width = holdProg ? fill.style.width : "100%";
      }
      const label = document.getElementById("dl-progress-label");
      if (label) {
        label.textContent = `${trackDone} track${trackDone !== 1 ? "s" : ""}`;
        label.title = "";
      }
    }

    function isDownloading() {
      return !!window.isDownloading;
    }

    return {
      resetForStart,
      onTotalTracks,
      recordTrackFinished,
      onUrlDone,
      onUrlError,
      updateProgress,
      setDownloadingState,
      finalizeOnDlComplete,
      isDownloading,
    };
  }

  dlroot.internals = dlroot.internals || {};
  dlroot.internals.bootstrapProgress = bootstrapProgress;
})();
