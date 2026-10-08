"""Small GUI-only preferences persisted on disk (survives pywebview localStorage loss)."""

from __future__ import annotations

from qobuz_dl.utils import read_config_file
import configparser
import json
import os
from typing import Callable, Union


PathRef = Union[str, Callable[[], str]]


def _resolve(value: PathRef) -> str:
    return value() if callable(value) else value


def normalize_gui_theme(raw) -> str:
    return "light" if str(raw or "").strip().lower() == "light" else "dark"


def read_gui_theme(config_file: PathRef, config_path: PathRef) -> str:
    cf = _resolve(config_file)
    if os.path.isfile(cf):
        try:
            cfg = configparser.ConfigParser()
            read_config_file(cfg, cf)
            if cfg.has_option("DEFAULT", "gui_theme"):
                return normalize_gui_theme(cfg.get("DEFAULT", "gui_theme"))
        except Exception:
            pass

    prefs = os.path.join(_resolve(config_path), "gui_preferences.json")
    if os.path.isfile(prefs):
        try:
            with open(prefs, encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, dict) and data.get("theme"):
                return normalize_gui_theme(data["theme"])
        except Exception:
            pass
    return "dark"


def write_gui_theme(config_file: PathRef, config_path: PathRef, theme: str) -> str:
    theme = normalize_gui_theme(theme)
    cf = _resolve(config_file)
    if os.path.isfile(cf):
        cfg = configparser.ConfigParser()
        read_config_file(cfg, cf)
        if "DEFAULT" not in cfg:
            cfg["DEFAULT"] = {}
        cfg["DEFAULT"]["gui_theme"] = theme
        with open(cf, "w", encoding="utf-8") as fh:
            cfg.write(fh)
        return theme

    cp = _resolve(config_path)
    os.makedirs(cp, exist_ok=True)
    prefs = os.path.join(cp, "gui_preferences.json")
    data: dict = {}
    if os.path.isfile(prefs):
        try:
            with open(prefs, encoding="utf-8") as fh:
                loaded = json.load(fh)
            if isinstance(loaded, dict):
                data = loaded
        except Exception:
            data = {}
    data["theme"] = theme
    with open(prefs, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")
    return theme
