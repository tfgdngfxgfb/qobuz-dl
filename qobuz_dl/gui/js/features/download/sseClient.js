/**
 * Download SSE / EventSource client (D1F).
 *
 * Invoked once from `app.js` `initDownload()` via `bootstrapSseClient(deps)`.
 */
(function () {
  "use strict";
  const g = window.QobuzGui;
  const dlroot = (g.features.download = g.features.download || {});

  function bootstrapSseClient(deps) {
    let sse = null;
    let reconnectTimer = null;

    function dispatchStatus(ev) {
      const handle = deps.handleStatusEvent;
      if (typeof handle === "function") {
        handle(ev);
        return;
      }
      if (typeof window._handleDlStatus === "function") {
        window._handleDlStatus(ev);
      }
    }

    function startSSE() {
      if (sse) return;

      const url =
        typeof deps.streamUrl === "string" && deps.streamUrl.trim()
          ? deps.streamUrl.trim()
          : "/api/stream";
      sse = new EventSource(url);

      sse.addEventListener("status", (e) => {
        try {
          dispatchStatus(JSON.parse(e.data));
        } catch (_) {}
      });

      sse.onerror = () => {
        if (sse) {
          sse.close();
          sse = null;
        }
        const delay =
          typeof deps.reconnectDelayMs === "number" &&
          deps.reconnectDelayMs >= 0
            ? deps.reconnectDelayMs
            : 3000;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(startSSE, delay);
      };
    }

    function close() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (sse) {
        sse.close();
        sse = null;
      }
    }

    function isConnected() {
      return !!sse;
    }

    return {
      startSSE,
      close,
      isConnected,
    };
  }

  dlroot.internals = dlroot.internals || {};
  dlroot.internals.bootstrapSseClient = bootstrapSseClient;
})();
