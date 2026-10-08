"""Background scan/preview/write jobs for existing local music files."""
from copy import deepcopy
from pathlib import Path
import secrets
import threading

from qobuz_dl.metadata_repair import (
    RecordingMatcher, library_files, proposed_changes, read_recording,
    recommended_candidate, write_changes,
)


BUSY_PHASES = {"scanning", "searching", "applying"}


class MetadataRepairJob:
    def __init__(self, root, client, fill_other=False):
        self.id = secrets.token_hex(12)
        self.root = Path(root).expanduser().resolve(strict=True)
        if not self.root.is_dir():
            raise ValueError("Choose a folder")
        self.fill_other = bool(fill_other)
        self.cancel = threading.Event()
        self.lock = threading.RLock()
        self.matcher = RecordingMatcher(client, self.cancel)
        self.phase = "scanning"
        self.rows = []
        self.total = 0
        self.processed = 0
        self.updated = 0
        self.error = ""

    def _spawn(self, target, *args):
        threading.Thread(target=target, args=args, daemon=True).start()

    def start(self):
        self._spawn(self.scan)

    def scan(self):
        try:
            files = list(library_files(self.root))
            with self.lock:
                self.total = len(files)
            for path in files:
                if self.cancel.is_set():
                    break
                row = {"id": str(len(self.rows)), "state": "pending", "error": "", "candidates": [], "recommended": None}
                try:
                    local = read_recording(path, self.root)
                    row["recording"] = local
                    row["local"] = local.public()
                    row["candidates"] = self.matcher.find(local)
                    for candidate in row["candidates"]:
                        candidate["changes"] = proposed_changes(local, candidate, self.fill_other)
                    row["recommended"] = recommended_candidate(row["candidates"])
                except Exception as error:
                    row["error"] = str(error)
                    row["local"] = row.get("local") or {"relative_path": str(path.relative_to(self.root)), "title": "", "artists": [], "isrc": "", "album": "", "duration": 0}
                with self.lock:
                    self.rows.append(row)
                    self.processed += 1
            with self.lock:
                self.phase = "cancelled" if self.cancel.is_set() else "ready"
        except Exception as error:
            with self.lock:
                self.phase, self.error = "error", str(error)

    def snapshot(self, offset=0, limit=50):
        with self.lock:
            rows = []
            for row in self.rows[offset:offset + limit]:
                rows.append({key: deepcopy(value) for key, value in row.items() if key != "recording"})
            return {"id": self.id, "phase": self.phase, "root": str(self.root), "fill_other": self.fill_other,
                    "total": self.total, "processed": self.processed, "updated": self.updated,
                    "error": self.error, "row_count": len(self.rows), "rows": rows,
                    "offset": offset, "limit": limit,
                    "error_count": sum(bool(r["error"]) for r in self.rows),
                    "review_count": sum(not r["recommended"] for r in self.rows)}

    def find_again(self, row_id, query):
        with self.lock:
            if self.phase in BUSY_PHASES:
                raise ValueError("Wait for the current operation to finish")
            row = next((r for r in self.rows if r["id"] == str(row_id)), None)
            if not row or "recording" not in row or row["state"] == "updated":
                raise ValueError("This file cannot be searched again; scan the folder again")
            self.phase = "searching"
            self.cancel.clear()
        self._spawn(self._find_again, row, query)

    def _find_again(self, row, query):
        try:
            candidates = self.matcher.find(row["recording"], query)
            for candidate in candidates:
                candidate["changes"] = proposed_changes(row["recording"], candidate, self.fill_other)
            with self.lock:
                row.update(candidates=candidates, recommended=recommended_candidate(candidates), error="")
        except Exception as error:
            with self.lock:
                row["error"] = str(error)
        finally:
            with self.lock:
                self.phase = "cancelled" if self.cancel.is_set() else "ready"

    def apply(self, selections, backup=True):
        if not isinstance(selections, list) or not 0 < len(selections) <= 500:
            raise ValueError("Select between 1 and 500 files")
        with self.lock:
            if self.phase not in {"ready", "complete"}:
                raise ValueError("Finish the preview before writing changes")
            targets, seen = [], set()
            for selection in selections:
                if not isinstance(selection, dict):
                    raise ValueError("Invalid selection")
                row_id = str(selection.get("row_id", ""))
                row = next((r for r in self.rows if r["id"] == row_id), None)
                if not row or row_id in seen or row["state"] == "updated" or "recording" not in row:
                    raise ValueError("Invalid or already updated file")
                candidate = next((c for c in row["candidates"] if c["id"] == str(selection.get("candidate_id", ""))), None)
                if not candidate or candidate["isrc_conflict"]:
                    raise ValueError("Choose a previewed Qobuz match without an ISRC conflict")
                targets.append((row, candidate))
                seen.add(row_id)
            self.phase = "applying"
            self.cancel.clear()
        self._spawn(self._apply, targets, backup)

    def _apply(self, targets, backup):
        for row, candidate in targets:
            if self.cancel.is_set():
                break
            try:
                result = write_changes(row["recording"], candidate, self.root, self.id, backup, self.fill_other)
                with self.lock:
                    row.update(result)
                    row["error"] = ""
                    self.updated += result["state"] == "updated"
            except Exception as error:
                with self.lock:
                    row.update(state="error", error=str(error))
        with self.lock:
            self.phase = "cancelled" if self.cancel.is_set() else "complete"


class MetadataRepairJobs:
    def __init__(self):
        self.jobs = {}
        self.lock = threading.RLock()

    def ensure_idle(self, job_id):
        if any(job.id != job_id and job.phase in BUSY_PHASES for job in self.jobs.values()):
            raise ValueError("Another existing-file operation is running")

    def create(self, root, client, fill_other=False):
        with self.lock:
            if any(job.phase in BUSY_PHASES for job in self.jobs.values()):
                raise ValueError("An existing-file operation is already running")
            while len(self.jobs) >= 2:
                self.jobs.pop(next(iter(self.jobs)))
            job = MetadataRepairJob(root, client, fill_other)
            self.jobs[job.id] = job
            job.start()
            return job

    def get(self, job_id):
        with self.lock:
            if job_id not in self.jobs:
                raise ValueError("Preview expired; scan the folder again")
            return self.jobs[job_id]
