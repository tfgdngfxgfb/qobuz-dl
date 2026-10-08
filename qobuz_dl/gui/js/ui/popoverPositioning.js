(function () {
  "use strict";
  const g = window.QobuzGui;
  const ui = (g.ui = g.ui || {});

  /** Place fixed popovers above download history, horizontally centered. */
  function positionAboveDownloadHistory(pop) {
    if (!pop || pop.classList.contains("hidden")) return;
    const hist = document.getElementById("dl-track-status-container");
    const margin = 10;
    const gap = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    let left;
    let top;
    if (hist) {
      const hr = hist.getBoundingClientRect();
      left = hr.left + (hr.width - pw) / 2;
      top = hr.top - ph - gap;
    } else {
      left = (vw - pw) / 2;
      top = margin;
    }
    left = Math.min(Math.max(margin, left), vw - pw - margin);
    if (top < margin) top = margin;
    if (top + ph > vh - margin) {
      top = Math.max(margin, vh - ph - margin);
    }
    pop.style.bottom = "auto";
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }

  ui.popoverPositioning = {
    positionAboveDownloadHistory,
  };
})();
