/**
 * Replacement / attach-track substitute façade (R1).
 *
 * Wired from `app.js` via `install(impl)` after internals bootstrap.
 */
(function () {
  "use strict";
  const g = window.QobuzGui;
  const features = (g.features = g.features || {});

  let _impl = null;

  function install(impl) {
    _impl = impl;
  }

  function openAttachPopover(card) {
    if (_impl && typeof _impl.openAttachPopover === "function") {
      return _impl.openAttachPopover(card);
    }
  }

  function closeAttachPopover() {
    if (_impl && typeof _impl.closeAttachPopover === "function") {
      return _impl.closeAttachPopover();
    }
  }

  function writeMissingPlaceholder(card, triggerBtn) {
    if (_impl && typeof _impl.writeMissingPlaceholder === "function") {
      return _impl.writeMissingPlaceholder(card, triggerBtn);
    }
  }

  function syncResolutionButtonStates(card) {
    if (_impl && typeof _impl.syncResolutionButtonStates === "function") {
      return _impl.syncResolutionButtonStates(card);
    }
  }

  features.replacements = {
    install,
    openAttachPopover,
    closeAttachPopover,
    writeMissingPlaceholder,
    syncResolutionButtonStates,
  };
})();
