"""Remember the metadata folder independently of download configuration."""
import json
import os
from pathlib import Path
import tempfile
import threading


class MetadataRepairPreferences:
    def __init__(self, config_path):
        self.config_path = config_path
        self.lock = threading.RLock()

    def _path(self):
        root = self.config_path() if callable(self.config_path) else self.config_path
        return Path(root) / "metadata_repair_preferences.json" if root else None

    def read(self):
        with self.lock:
            path = self._path()
            try:
                values = json.loads(path.read_text(encoding="utf-8")) if path else {}
                folder = values.get("folder", "")
                return {"folder": folder if isinstance(folder, str) else ""}
            except (OSError, ValueError, AttributeError):
                return {"folder": ""}

    def save_folder(self, folder):
        with self.lock:
            path = self._path()
            if path is None:
                return
            path.parent.mkdir(parents=True, exist_ok=True)
            descriptor, temporary = tempfile.mkstemp(prefix=".metadata-prefs-", dir=path.parent)
            try:
                with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                    json.dump({"folder": str(folder)}, handle, ensure_ascii=False)
                    handle.write("\n")
                os.replace(temporary, path)
            finally:
                if os.path.isfile(temporary):
                    os.unlink(temporary)
