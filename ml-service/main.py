import threading
import time
import uuid
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Any

from analyzer import analyze
from config import CONFIG
from forecast_model import run_demand_forecast

app = FastAPI(title="RetailIQ ML Service", version="1.0.0")


class AnalyzeRequest(BaseModel):
    outlets: list[dict[str, Any]] = Field(default_factory=list)
    bills: list[dict[str, Any]] = Field(default_factory=list)
    returns: list[dict[str, Any]] = Field(default_factory=list)
    wastage: list[dict[str, Any]] = Field(default_factory=list)
    costs: list[dict[str, Any]] = Field(default_factory=list)


class ForecastRequest(BaseModel):
    observations: list[dict[str, Any]] = Field(default_factory=list)
    horizon_hours: int = Field(default=168, ge=24, le=168)


# --- Asynchronous forecast jobs -------------------------------------------
# A full forecast computation takes longer than the calling app's per-request
# time budget (45s-2min on the free 0.1 CPU instance), so generation runs on a
# background thread: POST /forecast/jobs returns a job id immediately and the
# caller polls GET /forecast/jobs/{id} with short requests until the result is
# ready. Jobs live in memory only; if the service restarts mid-job the poll
# returns 404 and the caller starts a fresh job.
JOB_TTL_SECONDS = 1800
_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()


def _prune_jobs() -> None:
    cutoff = time.time() - JOB_TTL_SECONDS
    with _jobs_lock:
        stale = [job_id for job_id, job in _jobs.items() if job["created_at"] < cutoff]
        for job_id in stale:
            del _jobs[job_id]


def _run_job(job_id: str, payload: dict[str, Any]) -> None:
    try:
        result = run_demand_forecast(payload)
        with _jobs_lock:
            if job_id in _jobs:
                _jobs[job_id].update(status="completed", result=result, error=None)
    except Exception as exc:  # surfaced to the poller as a failed job
        with _jobs_lock:
            if job_id in _jobs:
                _jobs[job_id].update(status="failed", result=None, error=str(exc))


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "model_version": CONFIG.model_version}


@app.post("/ml/analyze")
def run_analysis(request: AnalyzeRequest) -> dict[str, Any]:
    try:
        return analyze(request.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/forecast/generate")
def run_forecast(request: ForecastRequest) -> dict[str, Any]:
    try:
        return run_demand_forecast(request.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/forecast/jobs", status_code=202)
def start_forecast_job(request: ForecastRequest) -> dict[str, Any]:
    _prune_jobs()
    job_id = uuid.uuid4().hex
    with _jobs_lock:
        _jobs[job_id] = {"status": "running", "result": None, "error": None, "created_at": time.time()}
    thread = threading.Thread(target=_run_job, args=(job_id, request.model_dump()), daemon=True)
    thread.start()
    return {"job_id": job_id, "status": "running"}


@app.get("/forecast/jobs/{job_id}")
def get_forecast_job(job_id: str) -> dict[str, Any]:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Forecast job not found. It may have expired or the service restarted; start a new forecast.")
        return {"job_id": job_id, "status": job["status"], "result": job["result"], "error": job["error"]}
