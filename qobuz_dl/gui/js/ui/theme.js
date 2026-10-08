(function () {
  "use strict";
  const ui = (window.QobuzGui.ui = window.QobuzGui.ui || {});
  const STORAGE_KEY = "qobuz_dl_gui_theme_v1";

  function getTheme() {
    return document.documentElement.getAttribute("data-theme") === "light"
      ? "light"
      : "dark";
  }

  function getStoredTheme() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === "light" ? "light" : "dark";
    } catch (_) {
      return "dark";
    }
  }

  function chipSurfaceAlphas() {
    const style = getComputedStyle(document.documentElement);
    return {
      tint: parseFloat(style.getPropertyValue("--chip-tint-alpha")) || 0.12,
      border: parseFloat(style.getPropertyValue("--chip-border-alpha")) || 0.45,
    };
  }

  function chipQualitySurfaceAlphas() {
    const style = getComputedStyle(document.documentElement);
    return {
      tint:
        parseFloat(style.getPropertyValue("--chip-quality-tint-alpha")) || 0.17,
      border:
        parseFloat(style.getPropertyValue("--chip-quality-border-alpha")) ||
        0.55,
    };
  }

  function confidenceRgbFromPct(pct) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0)) / 100;
    const r0 = 255;
    const g0 = 77;
    const b0 = 77;
    const r1 = 110;
    const g1 = 231;
    const b1 = 247;
    return {
      r: Math.round(r0 + (r1 - r0) * p),
      g: Math.round(g0 + (g1 - g0) * p),
      b: Math.round(b0 + (b1 - b0) * p),
    };
  }

  function setChipRgbVars(el, r, g, b) {
    el.style.setProperty("--chip-r", String(r));
    el.style.setProperty("--chip-g", String(g));
    el.style.setProperty("--chip-b", String(b));
  }

  function clearChipPaint(el) {
    el.style.removeProperty("color");
    el.style.removeProperty("border-color");
    el.style.removeProperty("background");
    el.style.removeProperty("background-color");
  }

  function applyTintChipPaint(el, r, g, b, alphas) {
    el.style.color = `rgb(${r},${g},${b})`;
    el.style.borderColor = `rgba(${r},${g},${b},${alphas.border})`;
    el.style.background = `rgba(${r},${g},${b},${alphas.tint})`;
  }

  function confidenceChipStylesFromPct(pct) {
    const { r, g, b } = confidenceRgbFromPct(pct);
    const { tint, border } = chipSurfaceAlphas();
    return {
      r,
      g,
      b,
      color: `rgb(${r},${g},${b})`,
      borderColor: `rgba(${r},${g},${b},${border})`,
      background: `rgba(${r},${g},${b},${tint})`,
    };
  }

  function applyConfidenceChipEl(chip, pct) {
    if (!chip) return;
    const { r, g, b } = confidenceRgbFromPct(pct);
    setChipRgbVars(chip, r, g, b);
    if (getTheme() === "light") {
      clearChipPaint(chip);
      return;
    }
    applyTintChipPaint(chip, r, g, b, chipSurfaceAlphas());
  }

  function applyQueueQualityEl(el, r, g, b) {
    if (!el) return;
    setChipRgbVars(el, r, g, b);
    if (getTheme() === "light") {
      clearChipPaint(el);
      return;
    }
    applyTintChipPaint(el, r, g, b, chipQualitySurfaceAlphas());
  }

  function refreshThemeColoredChips() {
    document.querySelectorAll(".track-status-chip.confidence-chip").forEach((chip) => {
      const pct = chip.dataset.confidencePct;
      if (pct == null || pct === "") return;
      applyConfidenceChipEl(chip, pct);
    });

    document.querySelectorAll(".queue-card-quality").forEach((el) => {
      const r = parseInt(el.style.getPropertyValue("--chip-r"), 10);
      const g = parseInt(el.style.getPropertyValue("--chip-g"), 10);
      const b = parseInt(el.style.getPropertyValue("--chip-b"), 10);
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
        const m = el.style.color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (!m) return;
        applyQueueQualityEl(el, Number(m[1]), Number(m[2]), Number(m[3]));
        return;
      }
      applyQueueQualityEl(el, r, g, b);
    });
  }

  function syncToggleUi(theme) {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    const isLight = theme === "light";
    btn.setAttribute("aria-checked", isLight ? "true" : "false");
    btn.setAttribute(
      "aria-label",
      isLight ? "Switch to dark mode" : "Switch to light mode",
    );
    btn.setAttribute("data-tip", isLight ? "Light mode" : "Dark mode");
    btn.classList.toggle("sidebar-theme-switch--light", isLight);
  }

  function persistThemeRemote(theme) {
    const api = window.QobuzGui && window.QobuzGui.api;
    if (!api || !api.themeApi || typeof api.themeApi.save !== "function") {
      return Promise.resolve();
    }
    return api.themeApi.save(theme).catch(() => {});
  }

  function applyTheme(theme, opts) {
    const options = opts || {};
    const next = theme === "light" ? "light" : "dark";
    const root = document.documentElement;
    if (next === "light") {
      root.setAttribute("data-theme", "light");
    } else {
      root.removeAttribute("data-theme");
    }
    root.style.colorScheme = next === "light" ? "light" : "dark";
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (_) {}
    syncToggleUi(next);
    refreshThemeColoredChips();
    if (options.persist !== false) {
      void persistThemeRemote(next);
    }
    return next;
  }

  function toggleTheme() {
    return applyTheme(getTheme() === "light" ? "dark" : "light");
  }

  async function syncThemeFromServer() {
    const api = window.QobuzGui && window.QobuzGui.api;
    if (!api || !api.themeApi || typeof api.themeApi.get !== "function") {
      return getTheme();
    }
    try {
      const res = await api.themeApi.get();
      const data = await res.json().catch(() => ({}));
      if (data.ok && (data.theme === "light" || data.theme === "dark")) {
        return applyTheme(data.theme, { persist: false });
      }
    } catch (_) {
      /* ignore */
    }
    return getTheme();
  }

  ui.theme = {
    init() {
      applyTheme(getStoredTheme(), { persist: false });
      const btn = document.getElementById("theme-toggle");
      if (btn) {
        btn.addEventListener("click", toggleTheme);
      }
      void syncThemeFromServer();
    },
    apply: applyTheme,
    get: getTheme,
    toggle: toggleTheme,
    chipSurfaceAlphas,
    chipQualitySurfaceAlphas,
    confidenceChipStylesFromPct,
    applyConfidenceChipEl,
    applyQueueQualityEl,
    refreshThemeColoredChips,
  };
})();
