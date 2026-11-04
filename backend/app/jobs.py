"""Durable scheduled jobs: source refresh + coverage reassessment.

Jobs persist in SQLite with visible status, logs, and next-run times. A
single in-process scheduler thread (started by the app lifespan) executes
due ENABLED jobs; everything is opt-in and rate-limited:

- source_refresh ingests at most config.max_sources (default 5) stale
  enabled sources per run, one fetch per source plus the standard delay.
- coverage_reassess re-runs deterministic gap classification for regions.
  AI summaries are OFF unless config.use_ai is explicitly true.

Autonomous jobs never deploy infrastructure, never commit code, and never
approve findings: they refresh data and write reviewable reports.
"""

import threading
import time
import traceback
import uuid
from datetime import datetime, timedelta, timezone

from . import database as db

SCHEDULER_POLL_S = 30
JOB_KINDS = ("source_refresh", "coverage_reassess")

_thread: threading.Thread | None = None
_stop = threading.Event()


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_default_jobs() -> None:
    conn = db.connect()
    try:
        ts = db.now_iso()
        conn.execute(
            "INSERT OR IGNORE INTO jobs (id, kind, name, config_json,"
            " interval_seconds, enabled, last_status, created_at)"
            " VALUES ('job-source-refresh', 'source_refresh',"
            " 'Nightly source refresh', '{\"max_sources\": 5}', 86400, 0,"
            " 'never_run', ?)",
            (ts,),
        )
        conn.execute(
            "INSERT OR IGNORE INTO jobs (id, kind, name, config_json,"
            " interval_seconds, enabled, last_status, created_at)"
            " VALUES ('job-coverage-reassess', 'coverage_reassess',"
            " 'Daily coverage reassessment', '{\"use_ai\": false}', 86400, 0,"
            " 'never_run', ?)",
            (ts,),
        )
        conn.commit()
    finally:
        conn.close()


def list_jobs() -> list[dict]:
    ensure_default_jobs()
    conn = db.connect()
    try:
        rows = conn.execute("SELECT * FROM jobs ORDER BY name").fetchall()
        out = []
        for r in rows:
            d = db.row_to_dict(r)
            d["config"] = db.load_json(d.pop("config_json") or "{}")
            d["last_result"] = db.load_json(d.pop("last_result_json") or "{}")
            out.append(d)
        return out
    finally:
        conn.close()


def get_job(jid: str) -> dict | None:
    conn = db.connect()
    try:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (jid,)).fetchone()
        if row is None:
            return None
        d = db.row_to_dict(row)
        d["config"] = db.load_json(d.pop("config_json") or "{}")
        d["last_result"] = db.load_json(d.pop("last_result_json") or "{}")
        return d
    finally:
        conn.close()


def update_job(jid: str, enabled: bool | None = None,
               interval_seconds: int | None = None,
               config: dict | None = None) -> dict | None:
    job = get_job(jid)
    if job is None:
        return None
    if interval_seconds is not None and interval_seconds < 300:
        raise ValueError("interval_seconds must be >= 300 (5 minutes)")
    conn = db.connect()
    try:
        if enabled is not None:
            conn.execute("UPDATE jobs SET enabled = ? WHERE id = ?",
                         (1 if enabled else 0, jid))
        if interval_seconds is not None:
            conn.execute("UPDATE jobs SET interval_seconds = ? WHERE id = ?",
                         (interval_seconds, jid))
        if config is not None:
            merged = dict(job["config"])
            merged.update(config)
            conn.execute("UPDATE jobs SET config_json = ? WHERE id = ?",
                         (db.dump_json(merged), jid))
        # Re-enabling schedules the next run from now.
        conn.execute(
            "UPDATE jobs SET next_run = ? WHERE id = ? AND enabled = 1"
            " AND (next_run = '' OR next_run IS NULL)",
            ((_now() + timedelta(seconds=job["interval_seconds"])).isoformat(), jid),
        )
        conn.commit()
    finally:
        conn.close()
    return get_job(jid)


def list_runs(job_id: str | None = None, limit: int = 20) -> list[dict]:
    conn = db.connect()
    try:
        if job_id:
            rows = conn.execute(
                "SELECT * FROM job_runs WHERE job_id = ?"
                " ORDER BY started_at DESC LIMIT ?",
                (job_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM job_runs ORDER BY started_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [db.row_to_dict(r) for r in rows]
    finally:
        conn.close()


def _run_source_refresh(config: dict, log: list[str]) -> dict:
    from . import sources as source_module

    max_sources = min(int(config.get("max_sources", 5) or 5), 34)
    candidates = [s for s in source_module.list_sources() if s["enabled"]]
    candidates.sort(key=lambda s: s["last_checked"] or "")
    results = []
    for src in candidates[:max_sources]:
        time.sleep(source_module.SYNC_DELAY_S)
        try:
            res = source_module.ingest_source(src["id"])
        except Exception as exc:
            res = {"id": src["id"], "status": "error",
                   "reason": type(exc).__name__}
        results.append(res)
        log.append(f"{src['id']}: {res.get('status')}"
                   + (f" ({res.get('reason')})" if res.get("reason") else ""))
    ok = sum(1 for r in results if r.get("status") == "ok")
    return {"refreshed": len(results), "ok": ok,
            "failed": len(results) - ok, "results": results}


def _run_coverage_reassess(config: dict, log: list[str]) -> dict:
    from . import coverage as coverage_module

    use_ai = bool(config.get("use_ai", False))
    reports = []
    for region in coverage_module.list_regions():
        report = coverage_module.analyze_region(region["id"], created_by="scheduled_job")
        reports.append({"region_id": region["id"], "report_id": report["id"],
                        "class": report["gap"]["class"]})
        log.append(f"{region['id']}: {report['gap']['class']}")
    summary = None
    if use_ai:
        from . import providers as provider_module

        status = provider_module.provider_status()
        if status["state"] == "configured":
            out = provider_module.chat_json([
                {"role": "system", "content": (
                    "Summarize coverage reassessment results for an engineer. "
                    "Return JSON with keys: headline, notable_changes[], cautions[].")},
                {"role": "user", "content": f"Latest classifications: {reports}"},
            ])
            if out.get("ok"):
                summary = out["data"]
                log.append("AI summary generated.")
            else:
                log.append(f"AI summary skipped: {out.get('error')}")
        else:
            log.append("AI summary skipped: provider not configured.")
    return {"reports": reports, "ai_summary": summary}


RUNNERS = {
    "source_refresh": _run_source_refresh,
    "coverage_reassess": _run_coverage_reassess,
}


def run_job(jid: str, trigger: str = "manual") -> dict:
    """Execute one job synchronously; records the run and updates the job."""
    job = get_job(jid)
    if job is None:
        raise KeyError(f"Unknown job {jid!r}")
    runner = RUNNERS.get(job["kind"])
    if runner is None:
        raise ValueError(f"Unknown job kind {job['kind']!r}")
    run_id = _new_id("run")
    started = _now()
    conn = db.connect()
    try:
        conn.execute(
            "INSERT INTO job_runs (id, job_id, started_at, status, log)"
            " VALUES (?, ?, ?, 'running', ?)",
            (run_id, jid, started.isoformat(), f"trigger={trigger}\n"),
        )
        conn.commit()
    finally:
        conn.close()
    log: list[str] = [f"trigger={trigger}"]
    status = "ok"
    result: dict = {}
    try:
        result = runner(job["config"], log)
    except Exception:
        status = "failed"
        log.append(traceback.format_exc(limit=3))
        result = {"error": "exception"}
    finished = _now()
    conn = db.connect()
    try:
        conn.execute(
            "UPDATE job_runs SET finished_at = ?, status = ?, log = ? WHERE id = ?",
            (finished.isoformat(), status, "\n".join(log)[:8000], run_id),
        )
        conn.execute(
            "UPDATE jobs SET last_run = ?, next_run = ?, last_status = ?,"
            " last_result_json = ? WHERE id = ?",
            (finished.isoformat(),
             (finished + timedelta(seconds=job["interval_seconds"])).isoformat(),
             status, db.dump_json(result), jid),
        )
        conn.commit()
    finally:
        conn.close()
    return {"run_id": run_id, "job_id": jid, "status": status, "result": result,
            "log": "\n".join(log)}


def _due_jobs() -> list[dict]:
    now = _now().isoformat()
    return [j for j in list_jobs()
            if j["enabled"] and (not j["next_run"] or j["next_run"] <= now)]


def _loop() -> None:
    while not _stop.wait(SCHEDULER_POLL_S):
        try:
            for job in _due_jobs():
                try:
                    run_job(job["id"], trigger="schedule")
                except Exception:
                    continue
        except Exception:
            continue


def start_scheduler() -> None:
    global _thread
    if _thread is not None and _thread.is_alive():
        return
    _stop.clear()
    ensure_default_jobs()
    _thread = threading.Thread(target=_loop, name="nexus-scheduler", daemon=True)
    _thread.start()


def stop_scheduler() -> None:
    _stop.set()
