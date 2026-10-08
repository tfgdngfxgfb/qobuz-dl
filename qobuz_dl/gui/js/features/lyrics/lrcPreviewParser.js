(function () {
  "use strict";

  function parseLrcLinesForPreview(synced) {
    const out = [];
    const lines = String(synced || "").split(/\r?\n/);
    const re = /^\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]\s*(.*)$/;
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      const m = t.match(re);
      if (!m) continue;
      const mm = parseInt(m[1], 10);
      const ss = parseFloat(m[2]);
      if (Number.isNaN(mm) || Number.isNaN(ss)) continue;
      const start_ms = Math.round((mm * 60 + ss) * 1000);
      const lyricText = (m[3] || "").trim();
      const tag = t.match(/^\[[^\]]+\]/);
      out.push({
        start_ms,
        text: lyricText,
        timeTag: tag ? tag[0] : "",
      });
    }
    out.sort((a, b) => a.start_ms - b.start_ms);
    for (let i = 0; i < out.length; i++) {
      out[i].end_ms =
        i + 1 < out.length ? out[i + 1].start_ms : Number.POSITIVE_INFINITY;
    }
    return out;
  }

  const g = window.QobuzGui;
  const features = (g.features = g.features || {});
  const lyrics = (features.lyrics = features.lyrics || {});
  const internals = (lyrics.internals = lyrics.internals || {});
  internals.parseLrcLinesForPreview = parseLrcLinesForPreview;
})();
