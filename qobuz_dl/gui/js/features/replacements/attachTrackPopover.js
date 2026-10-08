/**
 * Attach-track substitute popover — search Qobuz, attach replacement (R2).
 *
 * Invoked once from `app.js` via `bootstrapAttachTrackPopover(deps)` before card rendering.
 */
(function () {
  "use strict";
  const g = window.QobuzGui;
  const api = g.api;
  const ti = g.core.trackIdentity;
  const rroot = (g.features.replacements = g.features.replacements || {});

  function bootstrapAttachTrackPopover(deps) {
    let anchorCard = null;
    const pendingPrefix =
      (g.core && g.core.constants && g.core.constants.GUI_PENDING_AUDIO_PREFIX) ||
      "__GUI_PENDING__:slot:";

    function resolveAttachArtist(card) {
      const ti = g.core && g.core.trackIdentity;
      if (ti && typeof ti.resolveHistoryArtistForCard === "function") {
        return ti.resolveHistoryArtistForCard(card, pendingPrefix);
      }
      return (card && card.dataset.lyricArtist) || "";
    }

    const formatAttachDur = deps.formatAttachDur;
    const formatLyricDeltaSec = deps.formatLyricDeltaSec;
    const EXPLICIT_BADGE_SVG = deps.explicitBadgeSvg;

    function attachNormTokens(s) {
      return String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/gi, " ")
        .split(/\s+/)
        .filter(Boolean);
    }

    function attachDurationDeltaLabel(anchorSec, candSec) {
      const ref = parseInt(String(anchorSec || 0), 10);
      const dur = parseInt(String(candSec || 0), 10);
      if (
        !Number.isFinite(ref) ||
        !Number.isFinite(dur) ||
        ref <= 0 ||
        dur <= 0
      ) {
        return "";
      }
      const delta = dur - ref;
      if (delta === 0) return "";
      return formatLyricDeltaSec(delta);
    }

    function normalizeSamplingRateHz(raw) {
      return g.core.format.normalizeSamplingRateHz(raw);
    }

    function attachQualitySpecsTooltip(t) {
      const bd = parseInt(String(t.maximum_bit_depth || ""), 10);
      let srHz = normalizeSamplingRateHz(t.maximum_sampling_rate);
      if (!Number.isFinite(bd) || bd <= 0) {
        return "";
      }
      if (srHz == null || !Number.isFinite(srHz) || srHz <= 0) {
        return "";
      }
      const khz = srHz / 1000;
      const kStr = Number.isInteger(khz)
        ? String(khz)
        : khz.toFixed(4).replace(/\.?0+$/, "");
      return `${bd}-bit / ${kStr} kHz`;
    }

    function createAttachQualityBadge(t) {
      const tier = String(t.quality_tier || "LOSSLESS").toUpperCase();
      const specs = attachQualitySpecsTooltip(t);
      const tipHires =
        "Hi-Res lossless on Qobuz, above CD quality; up to 24-bit / 192 kHz.";
      const tipLossless =
        "CD-quality lossless on Qobuz, 16-bit / 44.1 kHz FLAC.";
      const tipMp3 = "Lossy stream (e.g. ~320 kbps), not lossless.";
      const tipSuffix = specs ? `\n${specs} (catalog max)` : "";

      const badge = document.createElement("span");
      badge.className = "result-badge attach-track-quality-badge";
      badge.removeAttribute("title");

      if (tier === "HI-RES") {
        badge.classList.add("badge-hires");
        badge.setAttribute("data-tip", tipHires + tipSuffix);
        const icon = document.createElement("img");
        icon.src = "/gui/hi-res.jpg";
        icon.className = "quality-icon";
        icon.alt = "";
        badge.appendChild(icon);
        return badge;
      }
      if (tier === "MP3") {
        badge.classList.add("badge-mp3");
        badge.textContent = "MP3";
        badge.setAttribute("data-tip", tipMp3 + tipSuffix);
        return badge;
      }
      badge.classList.add("badge-lossless");
      badge.setAttribute("data-tip", tipLossless + tipSuffix);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 32 32");
      svg.setAttribute("class", "quality-icon");
      svg.innerHTML =
        `<path d="M16 22.7368C17.8785 22.7368 19.471 22.0837 20.7773 20.7773C22.0837 19.471 22.7368 17.8785 22.7368 16C22.7368 14.1215 22.0837 12.529 20.7773 11.2227C19.471 9.91635 17.8785 9.26318 16 9.26318C14.1215 9.26318 12.529 9.91635 11.2227 11.2227C9.91635 12.529 9.26318 14.1215 9.26318 16C9.26318 17.8785 9.91635 19.471 11.2227 20.7773C12.529 22.0837 14.1215 22.7368 16 22.7368ZM16 17.6842C15.5228 17.6842 15.1228 17.5228 14.8 17.2C14.4772 16.8772 14.3158 16.4772 14.3158 16C14.3158 15.5228 14.4772 15.1228 14.8 14.8C15.1228 14.4772 15.5228 14.3158 16 14.3158C16.4772 14.3158 16.8772 14.4772 17.2 14.8C17.5228 15.1228 17.6842 15.5228 17.6842 16C17.6842 16.4772 17.5228 16.8772 17.2 17.2C16.8772 17.5228 16.4772 17.6842 16 17.6842ZM16.0028 32C13.7899 32 11.7098 31.5801 9.76264 30.7402C7.81543 29.9003 6.12164 28.7606 4.68128 27.3208C3.24088 25.8811 2.10057 24.188 1.26034 22.2417C0.420114 20.2954 0 18.2158 0 16.0028C0 13.7899 0.419931 11.7098 1.25979 9.76264C2.09965 7.81543 3.23945 6.12165 4.67917 4.68128C6.11892 3.24088 7.81196 2.10057 9.7583 1.26034C11.7046 0.420115 13.7842 0 15.9972 0C18.2101 0 20.2902 0.419933 22.2374 1.25979C24.1846 2.09966 25.8784 3.23945 27.3187 4.67917C28.7591 6.11892 29.8994 7.81197 30.7397 9.7583C31.5799 11.7046 32 13.7842 32 15.9972C32 18.2101 31.5801 20.2902 30.7402 22.2374C29.9003 24.1846 28.7606 25.8784 27.3208 27.3187C25.8811 28.7591 24.188 29.8994 22.2417 30.7397C20.2954 31.5799 18.2158 32 16.0028 32ZM16 29.4737C19.7614 29.4737 22.9474 28.1685 25.5579 25.5579C28.1685 22.9474 29.4737 19.7614 29.4737 16C29.4737 12.2386 28.1685 9.05261 25.5579 6.44208C22.9474 3.83155 19.7614 2.52628 16 2.52628C12.2386 2.52628 9.05261 3.83155 6.44208 6.44208C3.83155 9.05261 2.52628 12.2386 2.52628 16C2.52628 19.7614 3.83155 22.9474 6.44208 25.5579C9.05261 28.1685 12.2386 29.4737 16 29.4737Z" fill="currentColor"></path>`;
      badge.appendChild(svg);
      return badge;
    }

    function attachTrackMatchPct(
      anchorTitle,
      anchorArtist,
      candTitle,
      candArtist,
    ) {
      const a = new Set([
        ...attachNormTokens(anchorTitle),
        ...attachNormTokens(anchorArtist),
      ]);
      const b = new Set([
        ...attachNormTokens(candTitle),
        ...attachNormTokens(candArtist),
      ]);
      if (!a.size || !b.size) return 0;
      let inter = 0;
      for (const x of b) {
        if (a.has(x)) inter += 1;
      }
      return Math.round((100 * (2 * inter)) / (a.size + b.size));
    }

    function createAttachTrackSearchRow(t, matchPct, anchorDurSec, onAttach) {
      const div = document.createElement("div");
      div.className = "lyric-search-row";
      div.setAttribute("role", "option");

      const line1 = document.createElement("div");
      line1.className =
        "lyric-search-row-line lyric-search-row-line--title";

      const tSpan = document.createElement("span");
      tSpan.className = "lyric-search-track";
      tSpan.textContent = String(t.title || "");

      line1.appendChild(tSpan);

      if (Number.isFinite(matchPct) && matchPct > 0) {
        const mp = document.createElement("span");
        mp.className = "attach-track-match-pct";
        mp.textContent = `${matchPct}%`;
        mp.setAttribute(
          "aria-label",
          `Approximate title and artist overlap: ${matchPct} percent`,
        );
        line1.appendChild(mp);
      }

      if (t.explicit) {
        const ex = document.createElement("span");
        ex.className =
          "lyric-search-rating lyric-search-rating--explicit explicit-tag-badge";
        ex.innerHTML = EXPLICIT_BADGE_SVG;
        line1.appendChild(ex);
      } else {
        const cl = document.createElement("span");
        cl.className = "lyric-search-rating lyric-search-rating--clean";
        cl.textContent = "clean";
        line1.appendChild(cl);
      }

      const deltaStr = attachDurationDeltaLabel(anchorDurSec, t.duration_sec);
      if (deltaStr) {
        const d = document.createElement("span");
        d.className = "lyric-search-delta";
        d.textContent = deltaStr;
        d.setAttribute(
          "aria-label",
          "Candidate duration vs album slot track: " +
            deltaStr +
            " (mm:ss)",
        );
        line1.appendChild(d);
      }

      const line2 = document.createElement("div");
      line2.className =
        "lyric-search-row-line lyric-search-row-line--album";
      const albumEl = document.createElement("span");
      albumEl.className = "lyric-search-album";
      albumEl.textContent =
        String(t.album_title || "").trim() || "\u2014";
      line2.appendChild(albumEl);
      const qBadge = createAttachQualityBadge(t);
      if (qBadge) {
        line2.appendChild(document.createTextNode(" · "));
        line2.appendChild(qBadge);
      }
      const durStr = t.duration_sec ? formatAttachDur(t.duration_sec) : "";
      if (durStr) {
        line2.appendChild(document.createTextNode(" · "));
        const du = document.createElement("span");
        du.className = "attach-track-inline-dur";
        du.textContent = durStr;
        line2.appendChild(du);
      }

      const line3 = document.createElement("div");
      line3.className =
        "lyric-search-row-line lyric-search-row-line--footer";

      const artistSpan = document.createElement("span");
      artistSpan.className = "lyric-search-artist";
      artistSpan.textContent =
        String(t.artist || "").trim() || "\u2014";

      const actions = document.createElement("div");
      actions.className = "lyric-search-row-actions";

      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "btn-primary btn-sm";
      saveBtn.textContent = "Attach";
      saveBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (saveBtn.disabled) return;
        void onAttach(saveBtn);
      });

      line3.appendChild(artistSpan);
      line3.appendChild(actions);
      actions.appendChild(saveBtn);

      div.appendChild(line1);
      div.appendChild(line2);
      div.appendChild(line3);
      return div;
    }

    function close() {
      anchorCard = null;
      deps.clearLyricSearchAnchorHighlight();
      const pop = document.getElementById("attach-track-popover");
      if (!pop) return;
      pop.classList.add("hidden");
      pop.setAttribute("aria-hidden", "true");
    }

    function position() {
      deps.positionPopoverAboveDownloadHistory(
        document.getElementById("attach-track-popover"),
      );
    }

    function getAnchorCard() {
      return anchorCard;
    }

    function getStatusElementForCard(card) {
      const pop = document.getElementById("attach-track-popover");
      if (
        !pop ||
        pop.classList.contains("hidden") ||
        anchorCard !== card
      ) {
        return null;
      }
      return document.getElementById("attach-track-status");
    }

    async function submitAttachSubstitute(track) {
      const card = anchorCard;
      const sid = ((card && card.dataset.slotTrackId) || "").trim();
      const albumId = ((card && card.dataset.releaseAlbumId) || "").trim();
      const subId = String((track && track.id) || "").trim();
      if (!sid || !subId) return;
      if (ti && typeof ti.applySubstituteLyricMetaToCard === "function") {
        ti.applySubstituteLyricMetaToCard(card, track);
      }
      try {
        const payload = {
          slot_track_id: sid,
          substitute_track_id: subId,
        };
        if (albumId) payload.album_id = albumId;
        let qs = (card.dataset.queueSourceUrl || "").trim();
        const qUrlFn = deps.getQueueUrlForPurchaseSlot;
        if (
          !qs &&
          typeof qUrlFn === "function"
        ) {
          qs = qUrlFn(sid) || "";
        }
        if (qs) payload.queue_source_url = qs;
        if (typeof api.replacementApi.lyricDownloadOptionsFromUi === "function") {
          Object.assign(payload, api.replacementApi.lyricDownloadOptionsFromUi());
        }
        const res = await api.replacementApi.downloadAttachTrack(payload);
        const data = await res.json();
        if (!data.ok) {
          console.warn(data.error || "Attach failed");
          return;
        }
        close();
      } catch (_) {
        /* ignore */
      }
    }

    function open(card) {
      const sid = (
        (card && card.dataset && card.dataset.slotTrackId) ||
        ""
      ).trim();
      if (!sid || !card) return;
      deps.closeLyricSearchModal();
      anchorCard = card;
      deps.setLyricSearchAnchorCard(card);
      const pop = document.getElementById("attach-track-popover");
      const ti = document.getElementById("attach-track-title");
      const ar = document.getElementById("attach-track-artist");
      const statusEl = document.getElementById("attach-track-status");
      const resultsEl = document.getElementById("attach-track-results");
      if (!pop || !ti || !ar || !resultsEl) return;
      if (statusEl) {
        statusEl.textContent = "";
        statusEl.classList.add("hidden");
      }
      resultsEl.replaceChildren();
      const tEl = card.querySelector(".track-status-title");
      const displayTitle = ((tEl && tEl.textContent) || "").trim();
      ti.value = deps.lyricSearchTitleFromDisplay(displayTitle);
      ar.value = resolveAttachArtist(card);
      pop.classList.remove("hidden");
      pop.setAttribute("aria-hidden", "false");
      requestAnimationFrame(() => position());
      void runAttachTrackSearch(false);
    }

    async function runAttachTrackSearch(forceShowErrors) {
      const card = anchorCard;
      const ti = document.getElementById("attach-track-title");
      const ar = document.getElementById("attach-track-artist");
      const statusEl = document.getElementById("attach-track-status");
      const resultsEl = document.getElementById("attach-track-results");
      if (!card || !ti || !ar || !resultsEl) return;
      const titleQ = ti.value.trim();
      const artistQ = ar.value.trim();
      const query = [titleQ, artistQ].filter(Boolean).join(" ").trim();
      if (query.length < 2) {
        if (forceShowErrors && statusEl) {
          statusEl.textContent =
            "Enter at least 2 characters (title and/or artist).";
          statusEl.classList.remove("hidden");
        }
        return;
      }
      let anchor_explicit = null;
      const te = card.dataset.trackExplicit;
      if (te === "1") anchor_explicit = true;
      else if (te === "0") anchor_explicit = false;
      const body = { query };
      if (anchor_explicit !== null) body.anchor_explicit = anchor_explicit;
      if (statusEl) {
        statusEl.textContent = "Searching…";
        statusEl.classList.remove("hidden");
      }
      deps.showLyricSearchResultsLoading(resultsEl, "Searching Qobuz");
      try {
        const res = await api.replacementApi.searchAttachTracks(body);
        const data = await res.json();
        if (!data.ok) {
          resultsEl.replaceChildren();
          if (statusEl) {
            statusEl.textContent = data.error || "Search failed.";
            statusEl.classList.remove("hidden");
          }
          return;
        }
        const tracks = data.tracks || [];
        const sidSlot = ((card.dataset.slotTrackId) || "").trim();
        const tElA = card.querySelector(".track-status-title");
        const displayAnchor = ((tElA && tElA.textContent) || "").trim();
        const anchorTitle = deps.lyricSearchTitleFromDisplay(displayAnchor);
        const anchorArtist = resolveAttachArtist(card);
        const anchorDur =
          parseInt(String(card.dataset.durationSec || "0"), 10) || 0;
        const scored = [];
        for (let i = 0; i < tracks.length; i++) {
          const t = tracks[i];
          if (sidSlot && String(t.id || "") === sidSlot) continue;
          const mp = attachTrackMatchPct(
            anchorTitle,
            anchorArtist,
            String(t.title || ""),
            String(t.artist || ""),
          );
          scored.push({ t, mp });
        }
        scored.sort((a, b) => b.mp - a.mp);

        resultsEl.replaceChildren();
        if (statusEl) {
          if (!scored.length) {
            statusEl.textContent =
              anchor_explicit === null
                ? "No matches."
                : "No matches with the same explicit/clean flag.";
            statusEl.classList.remove("hidden");
          } else {
            statusEl.textContent = `${scored.length} result(s)`;
            statusEl.classList.remove("hidden");
          }
        }
        if (!scored.length) {
          const empty = document.createElement("div");
          empty.className = "lyric-search-empty";
          empty.textContent =
            anchor_explicit === null
              ? "No matches."
              : "No matches with the same explicit/clean flag.";
          resultsEl.appendChild(empty);
        } else {
          for (let j = 0; j < scored.length; j++) {
            const { t, mp } = scored[j];
            resultsEl.appendChild(
              createAttachTrackSearchRow(t, mp, anchorDur, async (btn) => {
                btn.disabled = true;
                await submitAttachSubstitute(t);
                btn.disabled = false;
              }),
            );
          }
        }
      } catch (_) {
        resultsEl.replaceChildren();
        if (statusEl) {
          statusEl.textContent = "Network error.";
          statusEl.classList.remove("hidden");
        }
      } finally {
        const ap = document.getElementById("attach-track-popover");
        if (ap && !ap.classList.contains("hidden") && anchorCard) {
          requestAnimationFrame(() => position());
        }
      }
    }

    function init() {
      const closeBtn = document.getElementById("attach-track-close");
      const submitBtn = document.getElementById("attach-track-submit");
      const pop = document.getElementById("attach-track-popover");
      const ti = document.getElementById("attach-track-title");
      const ar = document.getElementById("attach-track-artist");
      let attachTrackMousedownTarget = null;
      document.addEventListener(
        "mousedown",
        (e) => {
          if (!pop || pop.classList.contains("hidden")) {
            attachTrackMousedownTarget = null;
            return;
          }
          attachTrackMousedownTarget = e.target;
        },
        true,
      );
      document.addEventListener("click", (e) => {
        if (!pop || pop.classList.contains("hidden")) return;
        const target = attachTrackMousedownTarget || e.target;
        if (pop.contains(target)) return;
        if (e.target.closest && e.target.closest("#dl-track-status")) return;
        close();
      });
      if (closeBtn) {
        closeBtn.addEventListener("click", () => close());
      }
      if (submitBtn && ti && ar) {
        submitBtn.addEventListener("click", () =>
          void runAttachTrackSearch(true),
        );
        const onEnter = (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            void runAttachTrackSearch(true);
          }
        };
        ti.addEventListener("keydown", onEnter);
        ar.addEventListener("keydown", onEnter);
      }
      if (pop) {
        pop.addEventListener("click", (ev) => {
          if (ev.target === pop) close();
        });
        window.addEventListener("resize", () => {
          if (pop.classList.contains("hidden") || !anchorCard) {
            return;
          }
          position();
        });
        let attachPopWinScrollRaf = null;
        window.addEventListener(
          "scroll",
          () => {
            if (pop.classList.contains("hidden") || !anchorCard) {
              return;
            }
            if (attachPopWinScrollRaf != null) {
              cancelAnimationFrame(attachPopWinScrollRaf);
            }
            attachPopWinScrollRaf = requestAnimationFrame(() => {
              attachPopWinScrollRaf = null;
              position();
            });
          },
          true,
        );
      }
    }

    return {
      open,
      close,
      init,
      position,
      getAnchorCard,
      getStatusElementForCard,
    };
  }

  rroot.internals = rroot.internals || {};
  rroot.internals.bootstrapAttachTrackPopover = bootstrapAttachTrackPopover;
})();
