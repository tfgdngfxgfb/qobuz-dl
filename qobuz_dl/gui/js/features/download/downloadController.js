/**
 * Download / SSE façade (D1A plug socket only).
 *
 * Exposes stable `QobuzGui.features.download.*` after `app.js` calls `install(impl)`.
 * Until install(), methods return safe defaults.
 */
(function () {
  "use strict";
  const g = window.QobuzGui;
  const features = (g.features = g.features || {});

  let _impl = null;

  function install(impl) {
    _impl = impl;
  }

  function init(deps) {
    if (_impl && typeof _impl.init === "function") {
      return _impl.init(deps);
    }
  }

  function startSSE() {
    if (_impl && typeof _impl.startSSE === "function") {
      return _impl.startSSE();
    }
  }

  function handleStatusEvent(ev) {
    if (_impl && typeof _impl.handleStatusEvent === "function") {
      return _impl.handleStatusEvent(ev);
    }
  }

  function startFromCurrentQueue() {
    if (_impl && typeof _impl.startFromCurrentQueue === "function") {
      return _impl.startFromCurrentQueue();
    }
  }

  function pause() {
    if (_impl && typeof _impl.pause === "function") {
      return _impl.pause();
    }
    return Promise.resolve(null);
  }

  function isDownloading() {
    if (_impl && typeof _impl.isDownloading === "function") {
      return _impl.isDownloading();
    }
    return false;
  }

  function qUrlForPurchaseSlot(slotId) {
    if (_impl && typeof _impl.qUrlForPurchaseSlot === "function") {
      return _impl.qUrlForPurchaseSlot(slotId);
    }
    return "";
  }

  features.download = {
    install,
    init,
    startSSE,
    handleStatusEvent,
    startFromCurrentQueue,
    pause,
    isDownloading,
    qUrlForPurchaseSlot,
  };
})();
