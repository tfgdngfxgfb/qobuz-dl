/* Existing files: preview Qobuz matches, then approve metadata-only writes. */
(function () {
  "use strict";
  const busyPhases = new Set(["scanning", "searching", "applying"]);
  const selected = new Map();
  const choices = new Map();
  let job = null, offset = 0, polling = null, signature = "", opened = false, focusBefore = null;
  const byId = (id) => document.getElementById(id);
  const limit = 50;
  const text = (value) => Array.isArray(value) ? value.join("; ") : String(value || "—");
  const duration = (value) => `${Math.floor((value || 0) / 60)}:${String(Math.round((value || 0) % 60)).padStart(2, "0")}`;
  function element(tag, content, className) {
    const node = document.createElement(tag);
    if (content !== undefined) node.textContent = content;
    if (className) node.className = className;
    return node;
  }
  async function api(path, body) {
    const response = await fetch(path, body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || "Operation failed");
    return data;
  }
  function notice(message) { byId("metadata-repair-error").textContent = message || ""; }
  function controls() {
    const busy = job && busyPhases.has(job.phase);
    byId("metadata-repair-scan").disabled = Boolean(busy);
    byId("metadata-repair-stop").classList.toggle("hidden", !busy);
    byId("metadata-repair-folder").disabled = Boolean(busy);
    byId("metadata-repair-browse").disabled = Boolean(busy);
    byId("metadata-repair-other").disabled = Boolean(busy);
    const samePreview = job && job.root === byId("metadata-repair-folder").value.trim()
      && job.fill_other === byId("metadata-repair-other").checked;
    byId("metadata-repair-apply").disabled = !job || busy || !selected.size || !samePreview || !["ready", "complete"].includes(job.phase);
    byId("metadata-repair-apply").textContent = `Write selected changes (${selected.size})`;
    byId("metadata-repair-prev").disabled = offset === 0 || Boolean(busy);
    byId("metadata-repair-next").disabled = !job || offset + limit >= job.row_count || Boolean(busy);
    byId("metadata-repair-recommended").disabled = !job || Boolean(busy);
    byId("metadata-repair-page").textContent = job && job.row_count
      ? `${offset + 1}–${Math.min(offset + limit, job.row_count)} of ${job.row_count}` : "";
  }
  function renderRow(row) {
    const card = element("article", undefined, "metadata-repair-row");
    const header = element("div", undefined, "metadata-repair-row-head");
    const check = element("input"); check.type = "checkbox"; check.setAttribute("aria-label", `Update ${row.local.relative_path}`);
    const title = element("span", row.local.title || row.local.relative_path, "metadata-repair-row-title");
    header.append(check, title); card.append(header, element("div", row.local.relative_path, "metadata-repair-path"));
    if (row.state === "updated" || row.state === "unchanged") {
      selected.delete(row.id); check.disabled = true;
      card.append(element("div", row.state === "updated" ? "Updated ✓" : "No changes needed", "metadata-repair-evidence"));
      if (row.backup_path) card.append(element("div", `Backup: ${row.backup_path}`, "metadata-repair-path"));
      return card;
    }
    if (row.error) card.append(element("div", row.error, "metadata-repair-error"));
    const select = element("select"); select.setAttribute("aria-label", `Qobuz match for ${row.local.relative_path}`);
    select.disabled = busyPhases.has(job.phase);
    select.append(element("option", "Choose a Qobuz recording…")); select.options[0].value = "";
    for (const candidate of row.candidates) {
      const option = element("option", `${candidate.title} — ${text(candidate.artists)} | ${candidate.album} | ${duration(candidate.duration)} | ${candidate.isrc || "no ISRC"}`);
      option.value = candidate.id; option.disabled = candidate.isrc_conflict; select.append(option);
    }
    if (!choices.has(row.id)) choices.set(row.id, row.recommended || "");
    select.value = choices.get(row.id);
    if (!select.value && choices.get(row.id)) { choices.set(row.id, ""); selected.delete(row.id); }
    const comparison = element("div", undefined, "metadata-repair-comparison");
    const current = element("div"); current.append(element("div", "Current file", "metadata-repair-caption"));
    current.append(element("div", `ARTIST: ${text(row.local.artists)}`), element("div", `ISRC: ${text(row.local.isrc)}`));
    current.append(element("div", `${text(row.local.album)} · ${duration(row.local.duration)}`, "metadata-repair-evidence"));
    const after = element("div"); comparison.append(current, after);
    const evidence = element("div", undefined, "metadata-repair-evidence");
    const additional = element("div", undefined, "metadata-repair-more");
    function change() {
      choices.set(row.id, select.value);
      const candidate = row.candidates.find((c) => c.id === select.value);
      const changes = candidate && candidate.changes;
      check.disabled = !candidate || !changes || !Object.keys(changes).length || busyPhases.has(job.phase) || candidate.isrc_conflict;
      if (check.disabled) selected.delete(row.id);
      else if (selected.has(row.id)) selected.set(row.id, candidate.id);
      check.checked = selected.has(row.id);
      after.replaceChildren(element("div", "Proposed metadata", "metadata-repair-caption"));
      if (candidate) {
        after.append(element("div", `ARTIST: ${text(changes.artists || row.local.artists)}`));
        after.append(element("div", `ISRC: ${text(changes.isrc || row.local.isrc)}${row.local.isrc ? " (kept)" : ""}`));
        evidence.textContent = candidate.strong ? `Strong match: ${candidate.evidence.join(", ")}. Check before writing.` : `Review this recording: ${candidate.evidence.join(", ") || "insufficient identifying tags"}.`;
        if (row.candidates.filter((c) => c.strong).length > 1 && !row.recommended) evidence.textContent = "Multiple recordings match. Choose the correct version manually.";
        additional.replaceChildren();
        for (const [key, values] of Object.entries(changes.other || {})) additional.append(element("div", `Fill ${key}: ${text(values)}`));
        if (!Object.keys(changes).length) evidence.textContent = "These metadata fields are already complete.";
      } else {
        after.append(element("div", "No recording selected")); additional.replaceChildren();
        evidence.textContent = row.candidates.length ? "Choose and review a recording before selecting this file." : "No match found. Try another search below.";
        if (row.candidates.some((c) => c.isrc_conflict)) evidence.textContent += " Conflicting ISRC matches are blocked.";
      }
      controls();
    }
    check.addEventListener("change", () => { if (check.checked) selected.set(row.id, select.value); else selected.delete(row.id); controls(); });
    select.addEventListener("change", change);
    card.append(select, comparison, evidence, additional);
    const search = element("div", undefined, "metadata-repair-search");
    const query = element("input"); query.type = "text"; query.value = [row.local.title, row.local.artists[0]].filter(Boolean).join(" ");
    query.placeholder = "Title and artist"; query.setAttribute("aria-label", `Search another recording for ${row.local.relative_path}`);
    const searchButton = element("button", "Search again", "btn-secondary btn-sm"); searchButton.type = "button"; searchButton.disabled = busyPhases.has(job.phase);
    searchButton.addEventListener("click", async () => {
      try { notice(""); selected.delete(row.id); choices.delete(row.id); await api(`/api/metadata-repair/${job.id}/find`, { row_id: row.id, query: query.value }); await refresh(); }
      catch (error) { notice(error.message); }
    });
    search.append(query, searchButton); card.append(search); change(); return card;
  }
  function render() {
    const status = byId("metadata-repair-status");
    const labels = { scanning: "Finding Qobuz matches", searching: "Searching", applying: "Writing approved metadata", ready: "Preview ready", complete: "Write finished", cancelled: "Stopped", error: "Operation failed" };
    status.textContent = job ? `${labels[job.phase] || job.phase} · ${job.processed}/${job.total} files · ${job.updated} updated${job.error_count ? ` · ${job.error_count} errors` : ""}` : "Choose a folder, then preview matches.";
    if (job && job.error) notice(job.error);
    const rows = byId("metadata-repair-rows");
    rows.replaceChildren();
    if (!job || !job.rows.length) rows.append(element("div", job && job.phase === "ready" ? "No supported audio files found." : "FLAC, MP3 and M4A files are supported. No Qobuz ID is required.", "metadata-repair-empty"));
    else for (const row of job.rows) rows.append(renderRow(row));
    controls();
  }
  async function refresh() {
    if (!job) return;
    const data = await api(`/api/metadata-repair/${job.id}?offset=${offset}&limit=${limit}`);
    job = data.job;
    const next = JSON.stringify(job);
    if (signature !== next) { signature = next; render(); }
    else controls();
    if (opened && busyPhases.has(job.phase)) polling = setTimeout(() => refresh().catch((e) => notice(e.message)), 1000);
  }
  async function open() {
    focusBefore = document.activeElement;
    opened = true; byId("metadata-repair-overlay").classList.remove("hidden");
    byId("metadata-repair-overlay").setAttribute("aria-hidden", "false");
    byId("settings-popover").classList.add("hidden"); byId("settings-backdrop").classList.add("hidden");
    byId("settings-gear-btn").classList.remove("active");
    if (!byId("metadata-repair-folder").value) {
      try { const data = await api("/api/status"); byId("metadata-repair-folder").value = data.config && data.config.default_folder || ""; } catch (_) {}
    }
    render(); byId("metadata-repair-folder").focus();
    if (job) await refresh();
  }
  function close() { opened = false; clearTimeout(polling); byId("metadata-repair-overlay").classList.add("hidden"); byId("metadata-repair-overlay").setAttribute("aria-hidden", "true"); if (focusBefore) focusBefore.focus(); }
  document.addEventListener("DOMContentLoaded", () => {
    byId("settings-metadata-repair-btn").addEventListener("click", () => open().catch((e) => notice(e.message)));
    byId("metadata-repair-close").addEventListener("click", close);
    byId("metadata-repair-folder").addEventListener("input", controls);
    byId("metadata-repair-other").addEventListener("change", controls);
    byId("metadata-repair-browse").addEventListener("click", async () => {
      try { const result = await api("/api/browse_folder", {}); if (result.path) byId("metadata-repair-folder").value = result.path; controls(); }
      catch (_) { notice("Type or paste the folder path when the folder picker is unavailable."); }
    });
    byId("metadata-repair-scan").addEventListener("click", async () => {
      const button = byId("metadata-repair-scan"); button.disabled = true;
      try {
        notice(""); clearTimeout(polling);
        const data = await api("/api/metadata-repair", { folder: byId("metadata-repair-folder").value, fill_other: byId("metadata-repair-other").checked });
        job = data.job; offset = 0; signature = ""; selected.clear(); choices.clear();
        byId("metadata-repair-folder").value = job.root; render(); await refresh();
      } catch (error) { notice(error.message); controls(); }
    });
    byId("metadata-repair-stop").addEventListener("click", async () => {
      try { await api(`/api/metadata-repair/${job.id}/cancel`, {}); byId("metadata-repair-status").textContent = "Stopping after the current request or file…"; }
      catch (error) { notice(error.message); }
    });
    byId("metadata-repair-recommended").addEventListener("click", () => {
      for (const row of job.rows) {
        const candidate = row.candidates.find((c) => c.id === row.recommended);
        if (candidate && row.state !== "updated" && Object.keys(candidate.changes).length) { choices.set(row.id, candidate.id); selected.set(row.id, candidate.id); }
      }
      render();
    });
    byId("metadata-repair-apply").addEventListener("click", async () => {
      byId("metadata-repair-apply").disabled = true;
      try {
        notice(""); await api(`/api/metadata-repair/${job.id}/apply`, {
          selections: [...selected].map(([row_id, candidate_id]) => ({ row_id, candidate_id })), backup: byId("metadata-repair-backup").checked,
        });
        selected.clear(); signature = ""; await refresh();
      } catch (error) { notice(error.message); controls(); }
    });
    for (const [id, step] of [["metadata-repair-prev", -limit], ["metadata-repair-next", limit]]) byId(id).addEventListener("click", async () => {
      offset = Math.max(0, offset + step); signature = ""; try { await refresh(); } catch (error) { notice(error.message); }
    });
    byId("metadata-repair-overlay").addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.stopPropagation(); close(); }
      if (event.key === "Tab") {
        const items = [...byId("metadata-repair-overlay").querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled)")].filter((el) => !el.closest(".hidden"));
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
  });
})();
