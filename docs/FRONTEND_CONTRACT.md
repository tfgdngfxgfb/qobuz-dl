# Qobuz-DL-GUI Frontend Contract

This document defines **public contracts** for the vanilla JS GUI refactor.
Do not break these during extraction unless a failing test or broken route forces it.

## Script loading

- Use **ordered** `<script>` tags only. No ES modules, Vite, React, TypeScript, or bundlers for this refactor phase.

- **Script order is a real contract.** Later files may assume earlier ones have populated `window.QobuzGui` (especially `namespace.js` after `client.js`). When adding files, preserve load-before dependencies; do not reorder casually without checking each IIFE.

- Current order in [`qobuz_dl/gui/index.html`](../qobuz_dl/gui/index.html) matches this list exactly (excluding `?v=` cache query strings):

  1. `/gui/js/api/client.js` — initializes `window.QobuzGui.api`
  2. `/gui/js/api/extensions.js` — extra API helpers on `QobuzGui.api`
  3. `/gui/js/features/settings/updateBanner.js` — `QobuzGui.features.updateBanner`
  4. `/gui/js/core/namespace.js` — ensures `window.QobuzGui` scaffold
  5. `/gui/js/core/constants.js`
  6. `/gui/js/core/trackIdentity.js`
  7. `/gui/js/core/format.js`
  8. `/gui/js/core/dom.js`
  9. `/gui/js/core/icons.js`
  10. `/gui/js/features/formatBuilder/formatTooltips.js`
  11. `/gui/js/ui/globalTooltip.js`
  12. `/gui/js/ui/textFieldContextMenu.js`
  13. `/gui/js/ui/donationPopover.js`
  14. `/gui/js/ui/collapses.js`
  15. `/gui/js/ui/resetButtons.js`
  16. `/gui/js/ui/popoverPositioning.js` — **`QobuzGui.ui.popoverPositioning.positionAboveDownloadHistory`** (lyric search + attach-track popovers)
  17. `/gui/js/features/lyrics/lyricOutputSettings.js` — `QobuzGui.features.lyrics.lyricOutputSettings` (several downstream scripts assume this exists)
  18. `/gui/js/features/lyrics/lrcPreviewParser.js` — **`QobuzGui.features.lyrics.internals.parseLrcLinesForPreview`** (pure LRC rows; wired for preview player script only)
  19. `/gui/js/features/lyrics/lyricPreviewPlayer.js` — **`QobuzGui.features.lyrics.preview`** (`init`, `close`, `teardown`, `parseLrcLines`, `renderSynced`, `renderPlain`, `previewAudioUrl`)
  20. `/gui/js/features/lyrics/lyricSearchController.js` — **`QobuzGui.features.lyrics.search`** (`install`, `init`, `openForCard`, `close`, `closePreview`); no-op until **`lyricSearchModal.js`** **`install`**
  21. `/gui/js/features/lyrics/lyricSearchResults.js` — **`features.lyrics.searchResults`** (ctx + callbacks renderer; no modal globals)
  22. `/gui/js/features/lyrics/lyricAttach.js` — **`features.lyrics.attach`** (preview-row fetch + attach to file)
  23. `/gui/js/features/lyrics/lyricSearchModal.js` — modal lifecycle; calls **`search.install(realModalHost)`** at load time
  24. `/gui/js/features/status/statusController.js` — **`QobuzGui.features.status`** (`updateStatus`, `checkStatus`); tolerant `/api/status` fallback chain
  25. `/gui/js/features/setup/authTabs.js` — **`QobuzGui.features.setup.authTabs.init()`** (setup overlay auth method tabs)
  26. `/gui/js/features/setup/browseButtons.js` — **`QobuzGui.features.setup.browseButtons.init()`** (binds **all** `.btn-browse` globally — setup + settings)
  27. `/gui/js/features/setup/setupController.js` — **`QobuzGui.features.setup`** (`configure`, `showSetup`, `showApp`, `initSetup`, `resolveInitialView`); uses additive namespace + stored **`_deps`**
  28. `/gui/js/features/settings/settingsForm.js` — `QobuzGui.features.settings.settingsForm` (`loadIntoForm`, `mirrorConfigOntoForms`)
  29. `/gui/js/features/settings/downloadOptionsAutosave.js` — `QobuzGui.features.settings.downloadOptionsAutosave.bind()`
  30. `/gui/js/features/settings/coverArtMutex.js` — **`QobuzGui.features.settings.coverArtMutex.init(prefix)`** (`dl` / `cfg` checkbox mutual exclusivity; registration-only at load)
  31. `/gui/js/features/settings/settingsActions.js` — **`QobuzGui.features.settings.actions.init(deps)`** (settings-popover actions; inert until **`init`**)
  32. `/gui/js/features/queue/queueController.js` — stable `QobuzGui.features.queue` façade (`install`, `addUrl`, …); no-op until `install`
  27. `/gui/js/features/download/downloadController.js` — **`QobuzGui.features.download`** (`install`, `init`, `startSSE`, `handleStatusEvent`, `startFromCurrentQueue`, `pause`, `isDownloading`, `qUrlForPurchaseSlot`); no-op until `app.js` **`install`**
  28. `/gui/js/features/download/downloadProgress.js` — **`bootstrapProgress(deps)`** (progress bar + Start/Pause button chrome)
  29. `/gui/js/features/download/queueIssueBadges.js` — **`bootstrapQueueIssueBadges(deps)`** (purchase-only badges, URL error tips)
  30. `/gui/js/features/download/downloadStatusHandler.js` — **`bootstrapStatusHandler(deps)`** (`window._handleDlStatus`)
  31. `/gui/js/features/download/downloadStartPause.js` — **`bootstrapStartPause(deps)`** (`#dl-btn` click + payload assembly)
  32. `/gui/js/features/download/sseClient.js` — **`bootstrapSseClient(deps)`** (EventSource + reconnect)
  33. `/gui/js/features/queue/queueInternals.js` — **`QobuzGui.features.queue.internals.bootstrap(deps)`** returns queue host (`urlQueue`, persist/restore, cards, `_handleDrop*`)
  33. `/gui/js/features/history/historyController.js` — **`QobuzGui.features.history`** (`install`, `countDownloadedForRelease`, `applyFilter`, `ensureTrackCard`, `setDownloadChip`, `setLyricsChip`); no-op until `app.js` **`install`**
  30. `/gui/js/features/history/historyVirtualization.js` — **`bootstrapVirtualization(deps)`** (windowed DOM for large history lists)
  31. `/gui/js/features/history/historyHydratePersist.js` — **`bootstrapHydratePersist(deps)`** (DB hydrate, row store, persist, release download count)
  32. `/gui/js/features/history/historyFilters.js` — **`bootstrapFilters(deps)`** (All/Errors tab, error classification, badge)
  33. `/gui/js/features/history/historyCardRendering.js` — **`bootstrapCardRendering(deps)`** (track-status card DOM, download/lyrics chips)
  34. `/gui/js/features/history/clearHistoryConfirm.js` — **`bootstrapClearHistoryConfirm(deps)`** (Clear history confirm popover + bindings)
  35. `/gui/js/features/replacements/replacementController.js` — **`QobuzGui.features.replacements`** (`install`, attach popover / placeholder / resolution façade); no-op until `app.js` **`install`**
  35. `/gui/js/features/replacements/attachTrackPopover.js` — **`bootstrapAttachTrackPopover(deps)`** (attach-track popover DOM + API search/submit)
  36. `/gui/js/features/replacements/resolutionButtons.js` — **`bootstrapResolutionButtons(deps)`** (resolution button chrome on history rows)
  37. `/gui/js/features/replacements/missingPlaceholder.js` — **`bootstrapMissingPlaceholder(deps)`** (`.missing.txt` placeholder writes)
  38. `/gui/js/features/search/searchController.js` — `QobuzGui.features.search` (`init`, `syncQueuedHighlights`); uses `features.queue`
  39. `/gui/js/ui/feedbackMessage.js` — `QobuzGui.ui.feedbackMessage`
  40. `/gui/js/features/feedback/issueReportSubsystem.js` — `QobuzGui.features.feedback.issueReport.init(checkStatus)` — launch wiring from **`settings.actions.init`**
  41. `/gui/app.js` — **`init()`**: **`features.setup.configure`** + auth/browse/setup init + **`resolveInitialView`**; **`settings.actions.init(deps)`**; **`initDownload()`**: queue/history/download bootstrap + **`coverArtMutex.init('dl')`**

- **Optional later cleanup (non-goal until someone does it deliberately):** a more uniform mental order might be API → core → API extensions → shared UI → features → app. Today's order mixes `features`/`ui`/core somewhat for historical incremental extraction; reordering requires re-validating every cross-file assumption.

### Search vs queue lifecycle

`/gui/js/features/queue/queueController.js` defines the stable façade; **`downloadController.js`** defines the **`features.download`** façade (D1A complete; all download runtime modules extracted). **`downloadProgress.js`**, **`queueIssueBadges.js`**, **`downloadStatusHandler.js`**, **`downloadStartPause.js`**, and **`sseClient.js`** own progress/button chrome, queue issue badges, SSE status dispatch, Start/Pause click + payload assembly, and EventSource reconnect via **`bootstrap*`** helpers. **`queueInternals.js`** implements URL list state, textarea/card mode, server persist/restore, queue cards + resolve worker, drag handlers. **`historyController.js`** defines the **`features.history`** façade (stable methods + **`install(impl)`**); **`historyVirtualization.js`**, **`historyHydratePersist.js`**, **`historyFilters.js`**, and **`historyCardRendering.js`** implement virt scroller, DB row store/hydrate/persist, filter tabs, and card/chip DOM via **`bootstrap*`** helpers. **`replacementController.js`** defines **`features.replacements`**; **`attachTrackPopover.js`**, **`resolutionButtons.js`**, and **`missingPlaceholder.js`** bootstrap before history card rendering so **`historyCardRendering`** receives replacement callbacks. **`app.js`** passes real implementations from in-scope helpers after `_queueHost` exists. **`initDownload()`** calls queue **`bootstrap(...)`**, then download **`bootstrapQueueIssueBadges`** + **`bootstrapProgress`** + **`bootstrapStatusHandler`** + **`bootstrapStartPause`** + **`bootstrapSseClient`**, then history **virt → filter → replacement* → card → hydrate bootstraps**, then **guarded** **`features.history.install`** and **`features.replacements.install`**, then **`features.queue.install`** and **`features.download.install`**, then search **`init()`** from main **`init()`**.

**Download dependency rule (D1B–D1F):** download modules must use **`features.queue.*`**, **`features.history.*`**, **`features.replacements.*`**, or explicit injected deps — not **`_queueHost`** or other bootstrap hosts from **`app.js`**.

**Setup dependency rule (S1):** setup modules may call **`features.status.*`** and **`features.settings.settingsForm.*`**. Setup must **not** import download hosts — receive **`startDownloadSse`** via **`features.setup.configure({ ... })`**. **`configure()` must run before `initSetup()`**. Use additive **`QG.features.setup = QG.features.setup || {}`** in every setup script (never reassign the whole object).

**Status dependency rule (S1):** **`features.status`** must not depend on setup or download.

## Namespace rule

- Prefer `window.QobuzGui = window.QobuzGui || {}` and attach subtrees, e.g. `QobuzGui.core.trackIdentity`, `QobuzGui.ui.globalTooltip`, `QobuzGui.features.queue`.
- **Implemented (from extra scripts + `app.js`):**
  - `QobuzGui.api` groups on `client.js` + `extensions.js`; **`replacementApi`** (attach search/download, missing placeholder write, resolution file delete) is consumed only by **`features/replacements/*`** internals — no standalone `replacementApi.js` file.
  - `QobuzGui.features.updateBanner` (`js/features/settings/updateBanner.js`)
  - `QobuzGui.features.settings.settingsForm` (`js/features/settings/settingsForm.js`)
  - `QobuzGui.features.settings.downloadOptionsAutosave` (`js/features/settings/downloadOptionsAutosave.js`)
  - **`QobuzGui.features.settings.coverArtMutex`** (`js/features/settings/coverArtMutex.js`) — **`init(prefix)`** wires **`${prefix}-embed-art`**, **`${prefix}-og-cover`**, **`${prefix}-no-cover`** mutual exclusivity; no-op if elements missing. **`initDownload()`** calls **`init('dl')`**; **`settings.actions.init`** calls **`init('cfg')`**.
  - **`QobuzGui.features.settings.actions`** (`js/features/settings/settingsActions.js`) — **`init(deps)`** owns **settings-popover actions**: re-auth OAuth poll, manual update check, purge DB, and **issue-report launch wiring** via **`feedback.issueReport.init(checkStatus)`** (not a feedback-subsystem move). **`deps`:** **`checkStatus`**, **`updateStatus`**, **`loadSettingsForm`** with safe no-op fallbacks. Registration-only at load; DOM binding inside **`init`** only.
  - `QobuzGui.features.search` (`js/features/search/searchController.js`)
  - `QobuzGui.features.queue` (`queueController.js` + **`install`** wired from `initDownload`)
  - **`QobuzGui.features.download`** (`js/features/download/downloadController.js`) — **`install(impl)`** from **`initDownload()`** (guarded). Public: `init`, `startSSE`, `handleStatusEvent`, `startFromCurrentQueue`, `pause`, `isDownloading`, `qUrlForPurchaseSlot`. Safe defaults until **`install`** runs; **`pause()`** resolves without throwing when uninstalled or API missing. **D1A:** impl forwards to inline **`app.js`** closures; compatibility globals unchanged.
  - **`QobuzGui.features.download.internals.bootstrapProgress`** (`js/features/download/downloadProgress.js`) — **`deps`:** `updateQueueBadge`; owns URL/track counters, progress bar DOM, Start/Pause button state, **`window.isDownloading`**; invoked once from **`initDownload()`** after queue bootstrap. **`app.js`** calls via **`_dlProgress()`** host from SSE handler + dl-btn start/pause paths.
  - **`QobuzGui.features.download.internals.bootstrapQueueIssueBadges`** (`js/features/download/queueIssueBadges.js`) — **`deps`:** `trackKey`, `findQueueItemByUrl`, `albumQueueItemNeedsToStayVisible`, `refreshAlbumQueueCardMetas`, `removeFromQueue`; owns purchase-only key map, queue card badges/tips, **`window._qUrlForPurchaseSlot`**; invoked once from **`initDownload()`** after queue bootstrap. **`app.js`** calls via **`_dlQueueIssues()`** host from SSE handler + dl-btn start path.
  - **`QobuzGui.features.download.internals.bootstrapStatusHandler`** (`js/features/download/downloadStatusHandler.js`) — **`deps`:** history/progress/queue-issue getters, track identity helpers, history store + virt hooks, queue card ops, replacement file delete; owns **`window._handleDlStatus`**; invoked once from **`initDownload()`** after history hydrate bootstrap. **`features.download.handleStatusEvent`** delegates to status host when present.
  - **`QobuzGui.features.download.internals.bootstrapStartPause`** (`js/features/download/downloadStartPause.js`) — **`deps`:** progress/queue-issue getters, text-mode + queue URL helpers, **`startDownload`/`pauseDownload`** API callbacks; owns **`#dl-btn`** click listener + download options payload assembly; binds on bootstrap. **`features.download.startFromCurrentQueue`** delegates to start-pause host when present; **`features.download.pause`** remains direct API (no button UI).
  - **`QobuzGui.features.download.internals.bootstrapSseClient`** (`js/features/download/sseClient.js`) — **`deps`:** `streamUrl`, `reconnectDelayMs`, **`handleStatusEvent`**; owns EventSource lifecycle + reconnect. **`features.download.startSSE`** / **`handleStatusEvent`** wired from **`app.js`** via **`_startDownloadSse`** / **`_dispatchDownloadStatusEvent`**.
  - `QobuzGui.features.queue.internals.bootstrap` (`js/features/queue/queueInternals.js`) — **`deps`:** `getTrackStatusMap()`, `guiPendingAudioPrefix`, `syncSearchQueuedHighlights`; exposes URL queue state/helpers including `countHistoryDownloadedForRelease`, `calcProgressDenominatorFromQueue`; invoked once from **`initDownload()`**
  - `QobuzGui.features.history` (`js/features/history/historyController.js`) — **`install(impl)`** from **`initDownload()`** (guarded so a missing script does not throw). Public: `countDownloadedForRelease`, `applyFilter`, `ensureTrackCard`, `setDownloadChip`, `setLyricsChip`. **`countDownloadedForRelease`** is implemented by **`historyHydratePersist`** (scans in-memory row map); queue internals still read the same map via **`getTrackStatusMap`** for album progress badges.
  - `QobuzGui.features.history.internals.bootstrapHydratePersist` (`js/features/history/historyHydratePersist.js`) — **`deps`:** chip/card helpers, filter apply, order/virt hooks; owns **`dbItemByKey`** + **`audioPathAlbum`** maps; returns hydrate/persist/store APIs and **`countDownloadedForRelease`**
  - `QobuzGui.features.history.internals.bootstrapVirtualization` (`js/features/history/historyVirtualization.js`) — **`deps`:** order/key/card/db maps, active download keys, **`mountDbItemAtIndex(it, index)`** callback; returns virt scroller API (`isVirtActive`, `appendParent`, `teardownVirtScroller`, `activateForList`, `runInitialRenderPass`, etc.); invoked once from **`initDownload()`** before filter/card bootstraps
  - `QobuzGui.features.history.internals.bootstrapCardRendering` (`js/features/history/historyCardRendering.js`) — **`deps`:** card map, virt scroller hooks, filter apply, attach-track substitute callbacks; returns `ensureTrackStatusCard`, `setTrackDownloadChip`, `setTrackLyricsChip`, etc.; **`app.js`** keeps thin `_`-prefixed delegates wired into **`history.install`**
  - `QobuzGui.features.history.internals.bootstrapFilters` (`js/features/history/historyFilters.js`) — **`deps`:** card/db maps, order arrays, virt hooks, pending-audio prefix; returns `applyFilter`, `updateErrorHistoryCountBadge`, `initDownloadHistorySegment`; tab UI calls local `applyFilter` (not façade loop)
  - **`QobuzGui.features.history.internals.bootstrapClearHistoryConfirm`** (`js/features/history/clearHistoryConfirm.js`) — **`deps`:** **`onConfirmClear`** (async; **`app.js`** wires **`_resetTrackStatusCards`**); owns **`#dl-clear-history-confirm`** popover open/close/position + button bindings; invoked once from **`initDownload()`** after history card bootstrap
  - **`QobuzGui.features.status`** (`js/features/status/statusController.js`) — **`updateStatus(ready)`**, **`checkStatus()`** (`statusApi.fetchRaw` → **`getJson`** → **`fetch`** tolerant parse)
  - **`QobuzGui.features.setup`** (`js/features/setup/setupController.js` + leaf scripts) — additive namespace. **`authTabs.init`**, **`browseButtons.init`** (global `.btn-browse`). Controller: **`configure(deps)`**, **`showSetup`**, **`showApp`**, **`initSetup`**, **`resolveInitialView`**. **`deps`:** **`startDownloadSse`**, **`loadSettingsForm`**, **`connect`**. **`app.js`** calls **`configure()`** before **`initSetup()`**; **`resolveInitialView()`** after **`initDownload()`**.
  - `QobuzGui.features.replacements` (`replacementController.js`) — **`install(impl)`** from **`initDownload()`** (guarded). Public: `openAttachPopover`, `closeAttachPopover`, `writeMissingPlaceholder`, `syncResolutionButtonStates`. Safe defaults until **`install`** runs.
  - `QobuzGui.features.replacements.internals.bootstrapAttachTrackPopover` (`js/features/replacements/attachTrackPopover.js`) — returns `open`, `close`, `init`, **`getAnchorCard`**, **`getStatusElementForCard`**; lyric anchor/loading helpers from **`features.lyrics.internals`**; positioning from **`ui.popoverPositioning`**; **`search.close`** for mutual dismiss.
  - `QobuzGui.features.replacements.internals.bootstrapResolutionButtons` (`js/features/replacements/resolutionButtons.js`)
  - `QobuzGui.features.replacements.internals.bootstrapMissingPlaceholder` (`js/features/replacements/missingPlaceholder.js`) — **`deps`:** **`getAttachAnchorCard`**, **`getAttachStatusElementForCard`** from attach host only (no hidden anchor state).
  - **`QobuzGui.ui.feedbackMessage`** (`js/ui/feedbackMessage.js`): `show`, `showButton` for `.feedback-msg` and the settings update-check button.
  - **`QobuzGui.features.feedback.issueReport`** (`js/features/feedback/issueReportSubsystem.js`): `init(checkStatus)` — settings gear popover, issue-report / sent-history UX, worker submit endpoint, logs modal (**invoked from `settings.actions.init`** with injected **`checkStatus`**).
  - **`QobuzGui.features.lyrics.lyricOutputSettings`** (`js/features/lyrics/lyricOutputSettings.js`): download ↔ settings lyric toggles sync and `/api/config` persist.
  - **`QobuzGui.features.lyrics.preview`** (`js/features/lyrics/lyricPreviewPlayer.js`): lyric search **`#lyric-search-preview-*`** playback and body render. Public: **`init(deps)`** (optional **`onOverlayClosed`** in **`deps`**), **`close()`**, **`teardown()`**, **`parseLrcLines`**, **`renderSynced`**, **`renderPlain`**, **`previewAudioUrl`**. **`teardown()`** resets audio/seek UI and internal highlight state only; **`close()`** runs **`teardown()`**, hides **`#lyric-search-preview-panel`**, then invokes **`deps.onOverlayClosed`** (modal clears **`previewingLrclibId`** / result-row **Preview** buttons).
  - **`QobuzGui.features.lyrics.search`** (`lyricSearchController.js` + **`lyricSearchModal.js`**): **`install(impl)`**, **`init(deps)`**, **`openForCard(card)`**, **`close()`**, **`closePreview()`**. Modal owns ctx/session/abort guards; results renderer uses ctx + callbacks only.
  - **`QobuzGui.features.lyrics.searchResults`** (`lyricSearchResults.js`): **`configure`**, **`showLoading`**, **`renderResults`**, **`appendPage`**, **`rebuildVisibleRows`**, **`bindScrollPaging`** — must not read modal globals.
  - **`QobuzGui.features.lyrics.attach`** (`lyricAttach.js`): **`previewRow(ctx, id)`**, **`attachRow(ctx, id, confidence, kind, btn)`**.
  - **`QobuzGui.ui.popoverPositioning`** (`js/ui/popoverPositioning.js`): **`positionAboveDownloadHistory(pop)`**.
  - **`QobuzGui.features.lyrics.internals`** (anchor/title/loading helpers set by **`lyricSearchModal.js`**; **`parseLrcLinesForPreview`** from **`lrcPreviewParser.js`**): attach-track bootstrap reads anchor helpers here; callers should prefer **`preview.parseLrcLines`** and **`search.openForCard`** / **`search.close`**.
- Do not introduce unrelated globals except the compatibility adapters listed below.

## Extraction sequencing (human process)

The queue façade (`queueController.js` + **`install(impl)`**) and **`queueInternals.bootstrap(deps)`** load before search. Prefer **deliberate** sequencing for history virtualization / SSE and other splits until intentionally scheduled.

## Compatibility globals (must keep working)

Until all callers are migrated, these must remain functional:

| Global | Role |
|--------|------|
| `window._handleDlStatus(ev)` | SSE status event handler |
| `window._qUrlForPurchaseSlot(slotId)` | Purchase-only URL lookup for a slot |
| `window._updateQueueBadge()` | Queue badge refresh |
| `window._handleDrop(e)` | Drag/drop (card mode) |
| `window._handleDropText(e)` | Drag/drop (text mode) |
| `window.isDownloading` | Download-in-progress flag |

`app.js` registers `EventSource` and calls `window._handleDlStatus` when present.

## DOM id contract (do not rename)

These ids are relied on by `app.js` and/or HTML. **Do not rename** during refactor:

- `#dl-track-status`, `#dl-track-status-container`
- `#dl-history-tab-all`, `#dl-history-tab-errors`, `#dl-history-errors-count`
- `#dl-queue`, `#dl-queue-empty`, `#dl-urls`, `#dl-url-input`, `#dl-url-add`
- `#dl-btn`, `#dl-btn-badge`, `#dl-progress-fill`, `#dl-progress-label`
- `#lyric-search-popover`, `#lyric-search-results`, `#lyric-search-preview-audio`
- `#attach-track-popover`
- `#search-results`, `#search-results-container`, `#search-query`, `#search-type`, `#search-btn`
- `#settings-popover`, `#settings-gear-btn`, `#issue-report-popover`
- `#global-tooltip`, `#text-field-context-menu`
- `#setup-overlay`, `#app`, `#update-banner` and related update banner ids
- Setup/auth: `#oauth-btn`, `#token-btn`, `#setup-btn`, panels, errors, etc. (see `index.html`)

## CSS and copy

- Do not rename CSS classes for styling hooks used by JS unless unavoidable and tested.
- Do not change visible user-facing copy as part of refactor-only work.

## API contract

- **Do not** change Flask endpoint paths or JSON response shapes consumed by the GUI.
- API wrappers in `QobuzGui.api.*` must call the same paths as current `fetch()` usage.

## Dependency direction

- `api` — no DOM, no app business state
- `core` — pure helpers / constants; minimal DOM
- `ui` — generic DOM utilities; no Qobuz-specific queue/history rules
- `features` — may use `api`, `core`, `ui`
- `main` (future) — wires feature `init()` calls

Lower layers must not call upward into unfinished feature modules.

## Empty modules

- **Do not** add placeholder files with no moved code. Add a file only when code moves into it or an adapter imports it.
