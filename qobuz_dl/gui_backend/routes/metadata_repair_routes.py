from flask import jsonify, request
import logging

from qobuz_dl.artist_catalog import normalize_artist_ids, search_profiles
from qobuz_dl.gui_backend.services.metadata_repair_service import MetadataRepairJobs
from qobuz_dl.gui_backend.services.metadata_repair_preferences import MetadataRepairPreferences


def register_metadata_repair_routes(app, *, get_qobuz, download_active, config_path=None):
    jobs = MetadataRepairJobs()
    preferences = MetadataRepairPreferences(config_path)

    def body():
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            raise ValueError("Invalid request")
        return data

    def available():
        if download_active():
            raise ValueError("Wait for the current download to finish")
        qobuz = get_qobuz()
        if not qobuz or not qobuz.client:
            raise ValueError("Connect to Qobuz before searching for metadata")
        return qobuz.client

    @app.route("/api/metadata-repair/preferences", methods=["GET"])
    def metadata_repair_preferences():
        return jsonify(ok=True, preferences=preferences.read())

    @app.route("/api/metadata-repair/artists", methods=["GET"])
    def metadata_repair_artists():
        try:
            query = request.args.get("q", "").strip()
            if not (1 <= len(query) <= 250 and (len(query) >= 2 or query.isdecimal())):
                raise ValueError("Enter an artist name, profile link or ID")
            offset = max(0, int(request.args.get("offset", 0)))
            return jsonify(ok=True, **search_profiles(available(), query, offset))
        except ValueError as error:
            return jsonify(ok=False, error=str(error)), 400
        except Exception as error:
            return jsonify(ok=False, error=str(error)), 502

    @app.route("/api/metadata-repair", methods=["POST"])
    def metadata_repair_start():
        try:
            data = body()
            if not isinstance(data.get("folder"), str) or not data["folder"].strip():
                raise ValueError("Choose a music folder")
            artist_ids = normalize_artist_ids(data.get("artist_ids"))
            job = jobs.create(data["folder"], available(), data.get("fill_other") is True, artist_ids)
            warning = ""
            try:
                preferences.save_folder(job.root)
            except OSError:
                logging.warning("Could not save the metadata folder preference")
                warning = "Preview started, but this folder could not be remembered."
            return jsonify(ok=True, job=job.snapshot(), warning=warning), 202
        except (ValueError, OSError) as error:
            return jsonify(ok=False, error=str(error)), 400

    @app.route("/api/metadata-repair/<job_id>", methods=["GET"])
    def metadata_repair_status(job_id):
        try:
            offset = max(0, int(request.args.get("offset", 0)))
            limit = max(1, min(100, int(request.args.get("limit", 50))))
            return jsonify(ok=True, job=jobs.get(job_id).snapshot(offset, limit))
        except ValueError as error:
            return jsonify(ok=False, error=str(error)), 400

    @app.route("/api/metadata-repair/<job_id>/cancel", methods=["POST"])
    def metadata_repair_cancel(job_id):
        try:
            jobs.get(job_id).cancel.set()
            return jsonify(ok=True)
        except ValueError as error:
            return jsonify(ok=False, error=str(error)), 400

    @app.route("/api/metadata-repair/<job_id>/find", methods=["POST"])
    def metadata_repair_find(job_id):
        try:
            available()
            data = body()
            query = data.get("query", "")
            if not isinstance(query, str) or not 2 <= len(query.strip()) <= 250:
                raise ValueError("Enter a title and artist to search")
            job = jobs.get(job_id)
            with jobs.lock:
                jobs.ensure_idle(job_id)
                job.find_again(data.get("row_id"), query.strip())
            return jsonify(ok=True), 202
        except ValueError as error:
            return jsonify(ok=False, error=str(error)), 400

    @app.route("/api/metadata-repair/<job_id>/apply", methods=["POST"])
    def metadata_repair_apply(job_id):
        try:
            available()
            data = body()
            job = jobs.get(job_id)
            with jobs.lock:
                jobs.ensure_idle(job_id)
                job.apply(data.get("selections"), backup=data.get("backup", True) is not False)
            return jsonify(ok=True), 202
        except ValueError as error:
            return jsonify(ok=False, error=str(error)), 400
    return jobs
