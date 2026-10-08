/**
 * Search vs placeholder resolution button states on track-status rows (R3).
 */
(function () {
  "use strict";
  const g = window.QobuzGui;
  const rroot = (g.features.replacements = g.features.replacements || {});

  function bootstrapResolutionButtons(deps) {
    const missingPlaceholderBtnTip = deps.missingPlaceholderBtnTip;

    /**
     * Sync the green "resolved" fill on the search/placeholder button pair for a card.
     * card.dataset.resolvedBy === "search"      → search btn gets track-resolution-active
     * card.dataset.resolvedBy === "placeholder" → placeholder btn gets track-resolution-active
     * Anything else (undefined / "none")        → both buttons unfilled.
     */
    function syncResolutionButtonStates(card) {
      if (!card) return;
      const tags = card.querySelector(".track-status-tags");
      if (!tags) return;
      const sb = tags.querySelector(".track-substitute-search-btn");
      const pb = tags.querySelector(".track-missing-placeholder-btn");
      const resolvedBy = (card.dataset.resolvedBy || "").trim();
      if (sb) {
        sb.classList.toggle("track-resolution-active", resolvedBy === "search");
        if (resolvedBy === "search") {
          sb.setAttribute(
            "data-tip",
            "Downloaded replacement, click to search again",
          );
        } else {
          sb.setAttribute("data-tip", "Search to replace track with similar");
        }
      }
      if (pb) {
        pb.classList.toggle(
          "track-resolution-active",
          resolvedBy === "placeholder",
        );
        if (resolvedBy === "placeholder") {
          pb.setAttribute(
            "data-tip",
            "Placeholder .missing.txt written, click to switch to search replacement",
          );
        } else {
          pb.setAttribute("data-tip", missingPlaceholderBtnTip);
        }
      }
    }

    return { syncResolutionButtonStates };
  }

  rroot.internals = rroot.internals || {};
  rroot.internals.bootstrapResolutionButtons = bootstrapResolutionButtons;
})();
