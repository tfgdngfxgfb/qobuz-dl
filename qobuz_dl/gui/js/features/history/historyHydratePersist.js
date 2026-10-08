/**
 * Download history DB hydrate, in-memory row store, and persist (H6).
 *
 * Owns `_tsDbItemByKey` semantics (serialized rows for virt/filter/queue counts).
 * Invoked once from `app.js` `initDownload()` via `bootstrapHydratePersist(deps)`.
 */
(function () {
  "use strict";
  const g = window.QobuzGui;
  const hroot = (g.features.history = g.features.history || {});

  function bootstrapHydratePersist(deps) {
    const api = g.api;
    const ti = g.core.trackIdentity;
    const parseTrackRef = ti.parseTrackRef;
    const trackKey = ti.trackKey;
    const normalizeTrackNo = ti.normalizeTrackNo;
    const discTrackSortTuple = ti.discTrackSortTuple;
    const normalizeTrackTitle = ti.normalizeTrackTitle;
    const applyTrackStatusSubLabel = ti.applyTrackStatusSubLabel;
    const syncCardTrackKey = ti.syncCardTrackKey;
    const rebindCardTrackKey = ti.rebindCardTrackKey;
    const qobuzStoreUrlFromHistoryFields = ti.qobuzStoreUrlFromHistoryFields;
    const GUI_PENDING = deps.guiPendingAudioPrefix;

    const dbItemByKey = new Map();
    const audioPathAlbum = new Map();

    function getDbItemByKey() {
      return dbItemByKey;
    }

    function getTrackStatusMap() {
      return dbItemByKey;
    }

    function cardHasResolvedRealAudio(card, snap) {
      const ap = String(
        (card && card.dataset.audioPath) ||
          (snap && snap.audio_path) ||
          "",
      ).trim();
      if (!ap || ap.startsWith(GUI_PENDING)) return false;
      return true;
    }

    function lyricFieldsFromCard(card, existing) {
      const out = {
        lyric_type: String((existing && existing.lyric_type) || ""),
        lyric_provider: String((existing && existing.lyric_provider) || ""),
        lyric_confidence: String((existing && existing.lyric_confidence) || ""),
        lyric_destination: deps.normalizeLyricDestination(
          (existing && existing.lyric_destination) || "",
        ),
      };
      if (!card) return out;
      const chip = card.querySelector(".lyrics-chip");
      if (chip) {
        const parts = (chip.className || "").split(/\s+/);
        const lt = parts.find((c) =>
          ["synced", "plain", "none", "error", "instrumental"].includes(c),
        );
        if (lt) out.lyric_type = lt;
        out.lyric_destination = deps.normalizeLyricDestination(
          chip.dataset.lyricDestination || "",
        );
      }
      const confChip = card.querySelector(".confidence-chip");
      if (confChip) {
        const m = String(confChip.textContent || "").match(/(\d+)/);
        if (m) out.lyric_confidence = m[1];
      }
      return out;
    }

    function reorderKeysForAlbumInOrderAll(lyricAlbum) {
      const albKey = String(lyricAlbum || "").trim().toLowerCase();
      if (!albKey || typeof deps.getOrderAll !== "function") return;
      const orderAll = deps.getOrderAll();
      const indices = [];
      const keys = [];
      for (let i = 0; i < orderAll.length; i++) {
        const k = orderAll[i];
        const it = dbItemByKey.get(k);
        if (!it) continue;
        if (String(it.lyric_album || "").trim().toLowerCase() !== albKey) continue;
        indices.push(i);
        keys.push(k);
      }
      if (keys.length < 2) return;
      keys.sort((ka, kb) => {
        const a = dbItemByKey.get(ka) || {};
        const b = dbItemByKey.get(kb) || {};
        const ta = discTrackSortTuple(a.audio_path || "", a.track_no || "");
        const tb = discTrackSortTuple(b.audio_path || "", b.track_no || "");
        if (ta.disc !== tb.disc) return ta.disc - tb.disc;
        if (ta.track !== tb.track) return ta.track - tb.track;
        return String(a.title || "")
          .trim()
          .localeCompare(String(b.title || "").trim(), undefined, {
            sensitivity: "base",
          });
      });
      for (let j = 0; j < keys.length; j++) {
        orderAll[indices[j]] = keys[j];
      }
    }

    function purgePendingSlotFromMemory(slotId) {
      const sid = String(slotId || "").trim();
      if (!sid) return;
      const pendAp = GUI_PENDING + sid;
      for (const [k, it] of [...dbItemByKey.entries()]) {
        if (String(it.audio_path || "").trim() === pendAp) {
          dbItemByKey.delete(k);
        }
      }
    }

    function registerAudioPathAlbum(audioPath, lyricAlbum) {
      const p = String(audioPath || "").trim();
      if (!p) return;
      audioPathAlbum.set(p, String(lyricAlbum || "").trim());
    }

    function lyricAlbumForAudioPath(audioPath) {
      const ap = String(audioPath || "").trim();
      if (ap && audioPathAlbum.has(ap)) {
        return audioPathAlbum.get(ap) || "";
      }
      return "";
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

    function enrichHistoryItemsForHydrate(items) {
      const byRid = new Map();
      const byAlb = new Map();
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const cover = String(it.cover_url || "").trim();
        const rid = String(it.release_album_id || "").trim();
        const alb = String(it.lyric_album || "").trim().toLowerCase();
        if (cover && rid && !byRid.has(rid)) byRid.set(rid, cover);
        if (cover && alb && !byAlb.has(alb)) byAlb.set(alb, cover);
      }
      return items.map((raw) => {
        const it = { ...raw };
        if (String(it.cover_url || "").trim()) return it;
        const rid = String(it.release_album_id || "").trim();
        const alb = String(it.lyric_album || "").trim().toLowerCase();
        if (rid && byRid.has(rid)) {
          it.cover_url = byRid.get(rid);
          return it;
        }
        if (alb && byAlb.has(alb)) {
          it.cover_url = byAlb.get(alb);
          return it;
        }
        const qctx =
          ti.queueContextForRelease && rid
            ? ti.queueContextForRelease(rid)
            : { cover: "", artist: "" };
        if (qctx.cover) it.cover_url = qctx.cover;
        if (
          !String(it.lyric_artist || "").trim() &&
          qctx.artist
        ) {
          it.lyric_artist = qctx.artist;
        }
        return it;
      });
    }

    function sortHistoryItemsForDisplay(items) {
      return items.slice().sort((a, b) => {
        const albA = (a.lyric_album || "").trim().toLowerCase();
        const albB = (b.lyric_album || "").trim().toLowerCase();
        if (albA !== albB) return 0;
        const ta = discTrackSortTuple(a.audio_path || "", a.track_no || "");
        const tb = discTrackSortTuple(b.audio_path || "", b.track_no || "");
        if (ta.disc !== tb.disc) return ta.disc - tb.disc;
        if (ta.track !== tb.track) return ta.track - tb.track;
        const seqA =
          typeof a.history_seq === "number" ? a.history_seq : 2147483647;
        const seqB =
          typeof b.history_seq === "number" ? b.history_seq : 2147483647;
        if (seqA !== seqB) return seqA - seqB;
        return String(a.title || "")
          .trim()
          .localeCompare(String(b.title || "").trim(), undefined, {
            sensitivity: "base",
          });
      });
    }

    function lyricAlbumForTrackEv(ev) {
      const apEv = String(ev.audio_path || "").trim();
      const fromMap = lyricAlbumForAudioPath(apEv);
      if (fromMap) return fromMap;
      let a =
        ev.lyric_album != null && String(ev.lyric_album).trim() !== ""
          ? String(ev.lyric_album).trim()
          : "";
      if (a) return a;
      const wantN = normalizeTrackNo(ev.track_no);
      const wantT = normalizeTrackTitle(ev.title || "");
      const cards = document.querySelectorAll(
        "#dl-track-status .track-status-card",
      );
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        if (normalizeTrackNo(c.dataset.trackNo) !== wantN) continue;
        const tEl = c.querySelector(".track-status-title");
        const ct = normalizeTrackTitle((tEl && tEl.textContent) || "");
        if (ct !== wantT) continue;
        const da = (c.dataset.lyricAlbum || "").trim();
        if (da) return da;
      }
      return "";
    }

    function applyHistoryDbItemToCard(card, it) {
      const alb = (it.lyric_album || "").trim();
      let artist =
        (it.lyric_artist && String(it.lyric_artist).trim()) ||
        lyricArtistFromAudioPath(it.audio_path || "");
      if (!artist && ti.resolveHistoryArtistForCard) {
        artist = ti.resolveHistoryArtistForCard(card, GUI_PENDING);
      }
      if (artist) {
        card.dataset.lyricArtist = artist;
      }
      if (alb) card.dataset.lyricAlbum = alb;
      if (it.duration_sec) {
        card.dataset.durationSec = String(parseInt(it.duration_sec, 10) || 0);
      }
      if (it.audio_path) {
        const rawAp = String(it.audio_path || "").trim();
        if (rawAp) {
          card.dataset.audioPath = rawAp;
          if (!rawAp.startsWith(GUI_PENDING)) {
            registerAudioPathAlbum(rawAp, alb);
            if (rawAp.toLowerCase().endsWith(".missing.txt")) {
              card.dataset.resolvedBy = "placeholder";
              card.dataset.missingPlaceholderPath = rawAp;
            } else if (
              (it.attach_search_eligible === true ||
                it.attach_search_eligible === 1) &&
              String(it.download_status || "").toLowerCase() === "downloaded"
            ) {
              card.dataset.resolvedBy = "search";
            }
          }
        }
      }
      if (
        String(it.substitute_lyric_title || "").trim() &&
        ti.applySubstituteLyricMetaFromDbItem
      ) {
        ti.applySubstituteLyricMetaFromDbItem(card, it);
        if (!card.dataset.resolvedBy) {
          card.dataset.resolvedBy = "search";
        }
      }
      const coverUrl = String(it.cover_url || "").trim();
      if (coverUrl && typeof deps.setTrackCardCover === "function") {
        deps.setTrackCardCover(card, coverUrl);
      }
      if (it.track_explicit === true || it.track_explicit === false) {
        card.dataset.trackExplicit = it.track_explicit ? "1" : "0";
        deps.setTrackContentRatingBadge(card, it.track_explicit);
      }
      if ((it.slot_track_id || "").trim()) {
        card.dataset.slotTrackId = String(it.slot_track_id).trim();
      }
      if ((it.release_album_id || "").trim()) {
        card.dataset.releaseAlbumId = String(it.release_album_id).trim();
      }
      if (it.attach_search_eligible === true || it.attach_search_eligible === 1) {
        card.dataset.attachSearchEligible = "1";
      } else if (card.dataset.resolvedBy !== "placeholder") {
        delete card.dataset.attachSearchEligible;
      }
      if (card.dataset.resolvedBy === "placeholder") {
        card.dataset.attachSearchEligible = "1";
      }
      applyTrackStatusSubLabel(card);
      const st = String(it.download_status || "downloaded").toLowerCase();
      const detail = String(it.download_detail || "").trim();
      const isFailed = st === "failed";
      const isPurchase = st === "purchase_only";
      const sid = String(it.slot_track_id || "").trim();
      const rid = String(it.release_album_id || "").trim();
      const storeUrl = qobuzStoreUrlFromHistoryFields(detail, rid, sid);
      const showStoreChip =
        storeUrl && (isPurchase || (isFailed && sid && rid));
      if (showStoreChip) {
        deps.setTrackDownloadChip(
          it.track_no,
          it.title,
          "Album Purchase Only",
          "failed",
          {
            href: storeUrl,
            titleAttr:
              "Open album on Qobuz to purchase (full album required for these tracks)",
            slotTrackId: sid,
            releaseAlbumId: rid,
          },
          alb,
        );
      } else {
        deps.setTrackDownloadChip(
          it.track_no,
          it.title,
          isFailed ? "failed" : "downloaded",
          isFailed ? "failed" : "done",
          undefined,
          alb,
        );
      }
      if (typeof deps.remapCardTrackKey === "function") {
        deps.remapCardTrackKey(card);
      } else {
        syncCardTrackKey(card);
      }
      if (it.lyric_type && String(it.lyric_type).toLowerCase() !== "loading") {
        deps.setTrackLyricsChip(
          it.track_no,
          it.title,
          it.lyric_type,
          it.lyric_confidence || null,
          alb,
          it.lyric_provider || "",
          it.lyric_destination || "",
        );
      }
    }

    function applyHistoryDbItemToNewCard(it) {
      const alb = (it.lyric_album || "").trim();
      const card = deps.ensureTrackStatusCard(
        it.track_no || "",
        it.title || "",
        true,
        it.cover_url || "",
        alb,
        String(it.slot_track_id || "").trim(),
        String(it.audio_path || "").trim(),
      );
      if (!card) return;
      applyHistoryDbItemToCard(card, it);
    }

    function resolveCoverUrl(card, key) {
      const img = card && card.querySelector(".track-status-art-img");
      const fromDom = (img && img.getAttribute("src")) || "";
      if (fromDom) return fromDom;
      const lk = String(key || (card && card.dataset.trackKey) || "").trim();
      if (lk) {
        const snap = dbItemByKey.get(lk);
        if (snap && snap.cover_url) return String(snap.cover_url);
      }
      return "";
    }

    function storeDbItemFromTrackStart(ev, evAlb, card, coverUrl) {
      const tk = syncCardTrackKey(card) || (card && card.dataset.trackKey) || "";
      if (!tk) return;
      const tEl = card.querySelector(".track-status-title");
      const existing = dbItemByKey.get(tk) || {};
      const cover =
        String(coverUrl || "").trim() ||
        resolveCoverUrl(card, tk) ||
        String(existing.cover_url || "");
      dbItemByKey.set(tk, {
        ...existing,
        track_no: String(ev.track_no || card.dataset.trackNo || existing.track_no || ""),
        title:
          (tEl && tEl.textContent) ||
          String(ev.title || existing.title || ""),
        lyric_album: evAlb || existing.lyric_album || "",
        cover_url: cover,
        lyric_artist: (card.dataset.lyricArtist || existing.lyric_artist || "").trim(),
        release_album_id:
          String(card.dataset.releaseAlbumId || existing.release_album_id || "").trim(),
        slot_track_id:
          String(card.dataset.slotTrackId || existing.slot_track_id || "").trim(),
        duration_sec:
          parseInt(card.dataset.durationSec || String(existing.duration_sec || "0"), 10) ||
          0,
        track_explicit:
          card.dataset.trackExplicit === "1"
            ? true
            : card.dataset.trackExplicit === "0"
              ? false
              : existing.track_explicit != null
                ? existing.track_explicit
                : null,
        download_status: existing.download_status || "downloading",
      });
    }

    function storeDbItemFromTrackResult(ev, resAlb, card) {
      const tk = syncCardTrackKey(card) || (card && card.dataset.trackKey) || "";
      if (!tk) return;
      const tEl = card.querySelector(".track-status-title");
      const existing = dbItemByKey.get(tk) || {};
      const st = String(ev.status || "").toLowerCase();
      const isFailed = st === "failed";
      const isPurchase = st === "purchase_only";
      const detail = String(ev.detail || "").trim();
      const resolvedKeep =
        (isPurchase || isFailed) &&
        cardHasResolvedRealAudio(card, existing) &&
        String(existing.download_status || "").toLowerCase() === "downloaded";
      const lyricSnap = lyricFieldsFromCard(card, existing);
      const it = {
        track_no: String(ev.track_no || ""),
        title: (tEl && tEl.textContent) || String(ev.title || ""),
        lyric_album: resAlb || "",
        cover_url: resolveCoverUrl(card, tk),
        lyric_artist: (card.dataset.lyricArtist || "").trim(),
        duration_sec: parseInt(card.dataset.durationSec || "0", 10) || 0,
        audio_path: resolvedKeep
          ? String(existing.audio_path || card.dataset.audioPath || "").trim()
          : (card.dataset.audioPath || "").trim(),
        track_explicit:
          card.dataset.trackExplicit === "1"
            ? true
            : card.dataset.trackExplicit === "0"
              ? false
              : null,
        download_status: resolvedKeep
          ? "downloaded"
          : isPurchase
            ? "purchase_only"
            : isFailed
              ? "failed"
              : "downloaded",
        download_detail: resolvedKeep
          ? String(existing.download_detail || "")
          : detail,
        slot_track_id: String(ev.slot_track_id || "").trim(),
        release_album_id: String(ev.release_album_id || "").trim(),
        lyric_type: lyricSnap.lyric_type,
        lyric_provider: lyricSnap.lyric_provider,
        lyric_confidence: lyricSnap.lyric_confidence,
        lyric_destination: lyricSnap.lyric_destination,
        attach_search_eligible: resolvedKeep
          ? existing.attach_search_eligible === true ||
            existing.attach_search_eligible === 1 ||
            card.dataset.attachSearchEligible === "1"
          : card.dataset.attachSearchEligible === "1",
      };
      if (ti.substituteLyricFieldsForPersist) {
        Object.assign(it, ti.substituteLyricFieldsForPersist(card));
      }
      dbItemByKey.set(tk, it);
      const apStore = (card.dataset.audioPath || "").trim();
      if (apStore && !apStore.startsWith(GUI_PENDING)) {
        registerAudioPathAlbum(apStore, (it.lyric_album || "").trim());
      }
      const sidDone = String(ev.slot_track_id || "").trim();
      if (sidDone && it.download_status === "downloaded") {
        purgePendingSlotFromMemory(sidDone);
        for (const [k, row] of [...dbItemByKey.entries()]) {
          if (String(row.slot_track_id || "").trim() !== sidDone) continue;
          if (k !== tk) dbItemByKey.delete(k);
        }
      }
    }

    function updateLyricSnapForKey(key, ev) {
      const lk = String(key || "").trim();
      if (!lk) return false;
      const rowSnap = dbItemByKey.get(lk);
      if (!rowSnap) return false;
      rowSnap.lyric_type = String(ev.lyric_type || "none").toLowerCase();
      rowSnap.lyric_provider =
        ev.provider != null ? String(ev.provider) : "";
      rowSnap.lyric_confidence =
        ev.confidence != null && String(ev.confidence).trim() !== ""
          ? String(ev.confidence).trim()
          : "";
      rowSnap.lyric_destination = deps.normalizeLyricDestination(
        ev.lyric_destination || "",
      );
      return true;
    }

    function persistDownloadHistoryAfterResult(ev, resAlb) {
      const ap = String(ev.audio_path || "").trim();
      if (!ap || String(ev.status || "").toLowerCase() !== "downloaded") return;
      const card = deps.ensureTrackStatusCard(
        ev.track_no,
        ev.title,
        false,
        undefined,
        resAlb,
      );
      if (!card) return;
      const tEl = card.querySelector(".track-status-title");
      const coverUrl = resolveCoverUrl(card, card.dataset.trackKey || "");
      const payload = {
        audio_path: ap,
        track_no: card.dataset.trackNo || String(ev.track_no || ""),
        title: (tEl && tEl.textContent) || String(ev.title || ""),
        cover_url: coverUrl,
        lyric_artist: card.dataset.lyricArtist || "",
        lyric_album: (card.dataset.lyricAlbum || resAlb || "").trim(),
        duration_sec: parseInt(card.dataset.durationSec || "0", 10) || 0,
        track_explicit:
          card.dataset.trackExplicit === "1"
            ? true
            : card.dataset.trackExplicit === "0"
              ? false
              : null,
        download_status: "downloaded",
        download_detail: String(ev.detail || ""),
        lyric_type: "",
        lyric_provider: "",
        lyric_confidence: "",
      };
      const sidEv = String(ev.slot_track_id || "").trim();
      const ridEv = String(ev.release_album_id || "").trim();
      if (sidEv) {
        payload.slot_track_id = sidEv;
        payload.pending_slot_cleanup_id = sidEv;
      }
      if (ridEv) payload.release_album_id = ridEv;
      payload.attach_search_eligible = card.dataset.attachSearchEligible === "1";
      if (ti.substituteLyricFieldsForPersist) {
        Object.assign(payload, ti.substituteLyricFieldsForPersist(card));
      }
      const chip = card.querySelector(".lyrics-chip");
      if (chip) {
        const parts = (chip.className || "").split(/\s+/);
        const lt = parts.find((c) =>
          ["synced", "plain", "none", "error", "instrumental"].includes(c),
        );
        if (lt) payload.lyric_type = lt;
        payload.lyric_destination = deps.normalizeLyricDestination(
          chip.dataset.lyricDestination || "",
        );
      }
      const tk = (card.dataset.trackKey || "").trim();
      const rowSnap = tk ? dbItemByKey.get(tk) : null;
      if (rowSnap && !payload.lyric_type) {
        const snapLt = String(rowSnap.lyric_type || "").toLowerCase();
        if (snapLt && snapLt !== "loading") {
          payload.lyric_type = snapLt;
          payload.lyric_provider = String(rowSnap.lyric_provider || "");
          payload.lyric_confidence = String(rowSnap.lyric_confidence || "");
          payload.lyric_destination = deps.normalizeLyricDestination(
            rowSnap.lyric_destination || "",
          );
        }
      }
      registerAudioPathAlbum(ap, (payload.lyric_album || "").trim());
      if (sidEv) purgePendingSlotFromMemory(sidEv);
      void api.historyApi.upsert(payload).catch(() => {});
    }

    async function persistPlaceholderResolution(card, savedPath) {
      const c = card;
      const sp = String(savedPath || "").trim();
      if (!c || !sp) return;
      const sid = String(c.dataset.slotTrackId || "").trim();
      const rid = String(c.dataset.releaseAlbumId || "").trim();
      const tEl = c.querySelector(".track-status-title");
      const alb = (c.dataset.lyricAlbum || "").trim();
      const trackNo = c.dataset.trackNo || "";
      const title = (tEl && tEl.textContent) || "";

      purgePendingSlotFromMemory(sid);

      const payload = {
        audio_path: sp,
        track_no: trackNo,
        title: title,
        cover_url: resolveCoverUrl(c, c.dataset.trackKey || ""),
        lyric_artist: (c.dataset.lyricArtist || "").trim(),
        lyric_album: alb,
        duration_sec: parseInt(c.dataset.durationSec || "0", 10) || 0,
        track_explicit:
          c.dataset.trackExplicit === "1"
            ? true
            : c.dataset.trackExplicit === "0"
              ? false
              : null,
        download_status: "downloaded",
        download_detail: "",
        attach_search_eligible: 1,
      };
      if (sid) {
        payload.slot_track_id = sid;
        payload.pending_slot_cleanup_id = sid;
      }
      if (rid) payload.release_album_id = rid;

      c.dataset.audioPath = sp;
      c.dataset.missingPlaceholderPath = sp;
      c.dataset.resolvedBy = "placeholder";
      if (ti.clearSubstituteLyricMeta) ti.clearSubstituteLyricMeta(c);
      c.dataset.attachSearchEligible = "1";
      registerAudioPathAlbum(sp, alb);
      if (typeof deps.remapCardTrackKey === "function") {
        deps.remapCardTrackKey(c);
      } else {
        syncCardTrackKey(c);
      }
      applyTrackStatusSubLabel(c);

      const tk = (c.dataset.trackKey || "").trim();
      const lyricSnap = lyricFieldsFromCard(c, tk ? dbItemByKey.get(tk) : null);
      if (tk) {
        dbItemByKey.set(tk, {
          track_no: trackNo,
          title: title,
          lyric_album: alb,
          cover_url: payload.cover_url,
          lyric_artist: payload.lyric_artist,
          duration_sec: payload.duration_sec,
          audio_path: sp,
          track_explicit: payload.track_explicit,
          download_status: "downloaded",
          download_detail: "",
          slot_track_id: sid,
          release_album_id: rid,
          attach_search_eligible: true,
          lyric_type: lyricSnap.lyric_type,
          lyric_provider: lyricSnap.lyric_provider,
          lyric_confidence: lyricSnap.lyric_confidence,
          lyric_destination: lyricSnap.lyric_destination,
        });
      }

      deps.setTrackDownloadChip(
        trackNo,
        title,
        "downloaded",
        "done",
        undefined,
        alb,
      );

      try {
        await api.historyApi.upsert(payload);
      } catch (_) {
        /* ignore */
      }

      reorderKeysForAlbumInOrderAll(alb);

      if (typeof deps.onPlaceholderResolved === "function") {
        deps.onPlaceholderResolved(c);
      }
    }

    function persistPendingSlotDownloadHistory(ev, preCard, resAlb) {
      const sid = String(ev.slot_track_id || "").trim();
      const rid = String(ev.release_album_id || "").trim();
      const st = String(ev.status || "").toLowerCase();
      if (
        !preCard ||
        !sid ||
        !rid ||
        (st !== "purchase_only" && st !== "failed")
      ) {
        return;
      }
      const tk = (preCard.dataset.trackKey || "").trim();
      const existing = tk ? dbItemByKey.get(tk) : null;
      if (cardHasResolvedRealAudio(preCard, existing)) return;
      const tEl = preCard.querySelector(".track-status-title");
      let coverUrl = resolveCoverUrl(preCard, preCard.dataset.trackKey || "");
      if (!coverUrl && ti.queueContextForRelease) {
        coverUrl =
          ti.queueContextForRelease(String(rid || "").trim()).cover || "";
      }
      const payload = {
        audio_path: GUI_PENDING + sid,
        track_no: preCard.dataset.trackNo || String(ev.track_no || ""),
        title: (tEl && tEl.textContent) || String(ev.title || ""),
        cover_url: coverUrl,
        lyric_artist: preCard.dataset.lyricArtist || "",
        lyric_album: (preCard.dataset.lyricAlbum || resAlb || "").trim(),
        duration_sec: parseInt(preCard.dataset.durationSec || "0", 10) || 0,
        track_explicit:
          preCard.dataset.trackExplicit === "1"
            ? true
            : preCard.dataset.trackExplicit === "0"
              ? false
              : null,
        download_status: st,
        download_detail:
          qobuzStoreUrlFromHistoryFields(
            String(ev.detail || ""),
            rid,
            sid,
          ) || String(ev.detail || ""),
        lyric_type: "",
        lyric_provider: "",
        lyric_confidence: "",
        lyric_destination: "",
        slot_track_id: sid,
        release_album_id: rid,
        attach_search_eligible: true,
      };
      const chip = preCard.querySelector(".lyrics-chip");
      if (chip) {
        const parts = (chip.className || "").split(/\s+/);
        const lt = parts.find((c) =>
          ["synced", "plain", "none", "error", "instrumental"].includes(c),
        );
        if (lt) payload.lyric_type = lt;
        payload.lyric_destination = deps.normalizeLyricDestination(
          chip.dataset.lyricDestination || "",
        );
      }
      void api.historyApi.upsert(payload).catch(() => {});
    }

    function countDownloadedForRelease(releaseAlbumId, lyricAlbumTitle) {
      const rid = String(releaseAlbumId || "").trim();
      const albKey = String(lyricAlbumTitle || "").trim().toLowerCase();
      if (!rid && !albKey) return 0;
      const seen = new Set();
      let n = 0;
      for (const it of dbItemByKey.values()) {
        const st = String(it.download_status || "downloaded").toLowerCase();
        if (st !== "downloaded") continue;
        const ap = String(it.audio_path || "").trim();
        if (!ap || ap.startsWith(GUI_PENDING)) continue;
        const ridMatch = rid && String(it.release_album_id || "").trim() === rid;
        const albMatch =
          albKey && String(it.lyric_album || "").trim().toLowerCase() === albKey;
        if (!ridMatch && !albMatch) continue;
        if (seen.has(ap)) continue;
        seen.add(ap);
        n++;
      }
      return n;
    }

    function clearLocalMaps() {
      dbItemByKey.clear();
      audioPathAlbum.clear();
    }

    async function hydrateFromDb() {
      const list = document.getElementById("dl-track-status");
      if (!list) return;
      try {
        const res = await api.historyApi.list();
        const data = await res.json();
        if (!data.ok || !Array.isArray(data.items)) return;
        const items = sortHistoryItemsForDisplay(
          enrichHistoryItemsForHydrate(data.items),
        );
        const stick = deps.scrollContainerAtBottom(list);

        deps.setSkipHistoryFilterApply(true);
        try {
          deps.resetListForHydrate(list);
          clearLocalMaps();

          for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const alb = (it.lyric_album || "").trim();
            const parsed = parseTrackRef(it.track_no || "", it.title || "");
            const key = trackKey(
              parsed.trackNo,
              parsed.title,
              alb,
              it.audio_path || "",
            );
            deps.pushOrderAllKey(key);
            dbItemByKey.set(key, it);
            const ap = (it.audio_path || "").trim();
            if (ap && !ap.startsWith(GUI_PENDING)) {
              registerAudioPathAlbum(ap, alb);
            }
          }

          if (items.length >= deps.virtThreshold) {
            deps.activateVirtForList(list);
          }
        } finally {
          deps.setSkipHistoryFilterApply(false);
        }

        deps.applyHistoryFilter();

        if (items.length >= deps.virtThreshold) {
          deps.runVirtInitialRenderPass(list, stick);
        } else {
          deps.setSkipHistoryFilterApply(true);
          try {
            for (let i = 0; i < items.length; i++) {
              applyHistoryDbItemToNewCard(items[i]);
            }
          } finally {
            deps.setSkipHistoryFilterApply(false);
          }
          deps.applyHistoryFilter();
          if (stick) list.scrollTop = list.scrollHeight;
        }
      } catch (_) {
        deps.setSkipHistoryFilterApply(false);
      }
    }

    async function clearServerAndLocal(list) {
      try {
        await api.historyApi.clear();
      } catch (_) {
        /* ignore */
      }
      if (!list) return;
      deps.resetListForHydrate(list);
      clearLocalMaps();
    }

    return {
      getDbItemByKey,
      getTrackStatusMap,
      registerAudioPathAlbum,
      lyricAlbumForAudioPath,
      lyricAlbumForTrackEv,
      applyHistoryDbItemToCard,
      applyHistoryDbItemToNewCard,
      storeDbItemFromTrackStart,
      storeDbItemFromTrackResult,
      updateLyricSnapForKey,
      persistDownloadHistoryAfterResult,
      persistPlaceholderResolution,
      persistPendingSlotDownloadHistory,
      countDownloadedForRelease,
      hydrateFromDb,
      clearServerAndLocal,
      clearLocalMaps,
    };
  }

  hroot.internals = hroot.internals || {};
  hroot.internals.bootstrapHydratePersist = bootstrapHydratePersist;
})();
