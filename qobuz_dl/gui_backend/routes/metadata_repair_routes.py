from flask import jsonify, request

from qobuz_dl.gui_backend.services.metadata_repair_service import MetadataRepairJobs


def register_metadata_repair_routes(app, *, get_qobuz, download_active):
    jobs = MetadataRepairJobs()

    def available():
        if download_active():
            raise ValueError("Wait for the current download to finish")
        qobuz = get_qobuz()
        if not qobuz or not qobuz.client:
            raise ValueError("Connect to Qobuz before searching for metadata")
        return qobuz.client

    @app.route("/api/metadata-repair", methods=["POST"])
    def metadata_repair_start():
        try:
            data = request.get_json(silent=True) or {}
            if not isinstance(data.get("folder"), str) or not data["folder"].strip():
                raise ValueError("Choose a music folder")
            job = jobs.create(data["folder"], available(), data.get("fill_other") is True)
            return jsonify(ok=True, job=job.snapshot()), 202
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
            data = request.get_json(silent=True) or {}
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
            data = request.get_json(silent=True) or {}
            job = jobs.get(job_id)
            with jobs.lock:
                jobs.ensure_idle(job_id)
                job.apply(data.get("selections"), backup=data.get("backup", True) is not False)
            return jsonify(ok=True), 202
        except ValueError as error:
            return jsonify(ok=False, error=str(error)), 400
    return jobs
