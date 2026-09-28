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
