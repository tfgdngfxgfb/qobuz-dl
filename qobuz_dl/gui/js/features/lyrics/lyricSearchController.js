(function () {
  "use strict";
  const g = window.QobuzGui;
  const features = (g.features = g.features || {});
  const lyrics = (features.lyrics = features.lyrics || {});

  let _impl = null;

  function install(impl) {
    _impl = impl;
  }

  function init(deps) {
    if (_impl && typeof _impl.init === "function") {
      return _impl.init(deps);
    }
  }

  function openForCard(card) {
    if (_impl && typeof _impl.openForCard === "function") {
      return _impl.openForCard(card);
    }
  }

  function close() {
    if (_impl && typeof _impl.close === "function") {
      return _impl.close();
    }
  }

  function closePreview() {
    if (_impl && typeof _impl.closePreview === "function") {
      return _impl.closePreview();
    }
  }

  lyrics.search = {
    install,
    init,
    openForCard,
    close,
    closePreview,
  };
})();
