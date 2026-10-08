/**
 * Write .missing.txt placeholder for attach-track substitute workflow (R3).
 */
(function () {
  "use strict";
  const g = window.QobuzGui;
  const rroot = (g.features.replacements = g.features.replacements || {});

  function bootstrapMissingPlaceholder(deps) {
    const api = g.api;

    async function writeMissingPlaceholder(card, triggerBtnOpt) {
      const c = card && card.dataset ? card : deps.getAttachAnchorCard();
      const sid = ((c && c.dataset && c.dataset.slotTrackId) || "").trim();
      const statusEl = deps.getAttachStatusElementForCard(c);

      const triggerBtn = triggerBtnOpt || null;
      const clearBusy = () => {
        if (triggerBtn instanceof HTMLElement) {
          triggerBtn.disabled = false;
          triggerBtn.removeAttribute("aria-busy");
        }
      };

      if (!c) {
        clearBusy();
        return;
      }
      if (!sid) {
        if (statusEl) {
          statusEl.textContent =
            "No queued track linked, use a purchase/failed queue row.";
          statusEl.classList.remove("hidden");
        }
        clearBusy();
        return;
      }

      const albumId = ((c.dataset.releaseAlbumId) || "").trim();
      const payload = { slot_track_id: sid };
      if (albumId) payload.album_id = albumId;
      let qs = ((c.dataset.queueSourceUrl) || "").trim();
      const qUrlFn = deps.getQueueUrlForPurchaseSlot;
      if (!qs && typeof qUrlFn === "function") {
        qs = qUrlFn(sid) || "";
      }
      if (qs) payload.queue_source_url = qs;
      if (typeof api.replacementApi.lyricDownloadOptionsFromUi === "function") {
        Object.assign(payload, api.replacementApi.lyricDownloadOptionsFromUi());
      }

      if (triggerBtn instanceof HTMLElement) {
        triggerBtn.disabled = true;
        triggerBtn.setAttribute("aria-busy", "true");
      }

      try {
        const res = await api.replacementApi.writeMissingPlaceholder(payload);
        const data = await res.json().catch(() => ({}));

        if (data.ok) {
          const sp = String(data.saved_path || "").trim();
          if (sp) c.dataset.missingPlaceholderPath = sp;
          if (
            typeof deps.persistPlaceholderResolution === "function" &&
            sp
          ) {
            await deps.persistPlaceholderResolution(c, sp);
          } else {
            c.dataset.resolvedBy = "placeholder";
            deps.syncResolutionButtonStates(c);
          }
          if (statusEl) {
            const bn = String(data.basename || "").trim();
            statusEl.textContent = bn ? `Saved: ${bn}` : "Placeholder saved.";
            statusEl.classList.remove("hidden");
          }
        } else {
          const msg = String(data.error || "Could not save placeholder.");
          if (statusEl) {
            statusEl.textContent = msg;
            statusEl.classList.remove("hidden");
          } else {
            console.warn(msg);
          }
        }
      } catch (_) {
        if (statusEl) {
          statusEl.textContent = "Network error.";
          statusEl.classList.remove("hidden");
        }
      } finally {
        clearBusy();
      }
    }

    return { writeMissingPlaceholder };
  }

  rroot.internals = rroot.internals || {};
  rroot.internals.bootstrapMissingPlaceholder = bootstrapMissingPlaceholder;
})();
