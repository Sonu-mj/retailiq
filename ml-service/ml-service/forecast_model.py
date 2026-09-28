"""Leakage-safe hourly demand forecasting for RetailIQ.

The model is deliberately trained outside React. It uses each outlet's completed
POS observations, a chronological holdout, and only lag/rolling values available
before the predicted hour. No synthetic rows enter production storage.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from math import sqrt
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error

MODEL_VERSION = "hist-gradient-hourly-v1"
MIN_DAYS = 21
MIN_ROWS_PER_OUTLET = 168
FEATURES = [
    "outlet_code", "hour", "day_of_week", "day_of_month", "week_of_month", "month",
    "is_weekend", "is_month_start", "is_month_end", "orders_previous_hour",
    "orders_previous_day", "orders_previous_week", "orders_3h_avg", "orders_6h_avg",
    "orders_24h_avg", "orders_7d_avg",
]


def _calendar(frame: pd.DataFrame) -> pd.DataFrame:
    ts = frame["timestamp"]
    frame["hour"] = ts.dt.hour
    frame["day_of_week"] = ts.dt.dayofweek
    frame["day_of_month"] = ts.dt.day
    frame["week_of_month"] = ((ts.dt.day - 1) // 7 + 1).astype(int)
    frame["month"] = ts.dt.month
    frame["is_weekend"] = (ts.dt.dayofweek >= 5).astype(int)
    frame["is_month_start"] = ts.dt.is_month_start.astype(int)
    frame["is_month_end"] = ts.dt.is_month_end.astype(int)
    return frame


def build_hourly_features(observations: list[dict[str, Any]]) -> tuple[pd.DataFrame, dict[int, str]]:
    source = pd.DataFrame(observations)
    if source.empty:
        return pd.DataFrame(), {}
    source["timestamp"] = pd.to_datetime(source["timestamp"], utc=True).dt.floor("h")
    for col in ["orders", "units_sold", "revenue", "average_order_value"]:
        source[col] = pd.to_numeric(source[col], errors="coerce").fillna(0.0)
    frames: list[pd.DataFrame] = []
    outlet_ids = sorted(source["outlet_id"].astype(str).unique())
    decode = {index: outlet_id for index, outlet_id in enumerate(outlet_ids)}
    encode = {value: key for key, value in decode.items()}
    for outlet_id, group in source.groupby("outlet_id"):
        hourly = group.groupby("timestamp", as_index=True).agg(
            orders=("orders", "sum"), units_sold=("units_sold", "sum"), revenue=("revenue", "sum")
        ).sort_index()
        full_index = pd.date_range(hourly.index.min(), hourly.index.max(), freq="h", tz="UTC")
        hourly = hourly.reindex(full_index, fill_value=0.0).rename_axis("timestamp").reset_index()
        hourly["average_order_value"] = np.where(hourly["orders"] > 0, hourly["revenue"] / hourly["orders"], 0.0)
        hourly["outlet_id"] = str(outlet_id)
        hourly["outlet_code"] = encode[str(outlet_id)]
        orders = hourly["orders"].shift(1)
        hourly["orders_previous_hour"] = hourly["orders"].shift(1)
        hourly["orders_previous_day"] = hourly["orders"].shift(24)
        hourly["orders_previous_week"] = hourly["orders"].shift(168)
        hourly["orders_3h_avg"] = orders.rolling(3, min_periods=1).mean()
        hourly["orders_6h_avg"] = orders.rolling(6, min_periods=1).mean()
        hourly["orders_24h_avg"] = orders.rolling(24, min_periods=1).mean()
        hourly["orders_7d_avg"] = orders.rolling(168, min_periods=1).mean()
        frames.append(_calendar(hourly))
    result = pd.concat(frames, ignore_index=True).sort_values(["timestamp", "outlet_id"])
    return result, decode


@dataclass
class TrainedDemandModel:
    model: HistGradientBoostingRegressor
    decode: dict[int, str]
    history: pd.DataFrame
    metrics: dict[str, float | None]


def train_demand_model(observations: list[dict[str, Any]]) -> TrainedDemandModel | None:
    frame, decode = build_hourly_features(observations)
    if frame.empty:
        return None
    eligible_ids = []
    for outlet_id, group in frame.groupby("outlet_id"):
        span_days = (group["timestamp"].max() - group["timestamp"].min()).total_seconds() / 86400
        if len(group) >= MIN_ROWS_PER_OUTLET and span_days >= MIN_DAYS:
            eligible_ids.append(outlet_id)
    frame = frame[frame["outlet_id"].isin(eligible_ids)].dropna(subset=FEATURES + ["orders"]).copy()
    if len(frame) < 168 or not eligible_ids:
        return None
    frame = frame.sort_values("timestamp")
    split = max(1, int(len(frame) * 0.8))
    train, test = frame.iloc[:split], frame.iloc[split:]
    if test.empty:
        return None
    model = HistGradientBoostingRegressor(max_iter=240, learning_rate=0.06, max_leaf_nodes=23, l2_regularization=0.15, random_state=42)
    model.fit(train[FEATURES], train["orders"])
    predicted = np.maximum(0.0, model.predict(test[FEATURES]))
    actual = test["orders"].to_numpy()
    nonzero = actual != 0
    mape = float(np.mean(np.abs((actual[nonzero] - predicted[nonzero]) / actual[nonzero])) * 100) if nonzero.any() else None
    metrics = {"mae": float(mean_absolute_error(actual, predicted)), "rmse": float(sqrt(mean_squared_error(actual, predicted))), "mape": mape}
    model.fit(frame[FEATURES], frame["orders"])
    return TrainedDemandModel(model=model, decode=decode, history=frame, metrics=metrics)


def _lag(values: list[float], distance: int) -> float:
    return values[-distance] if len(values) >= distance else 0.0


def _avg(values: list[float], window: int) -> float:
    if not values:
        return 0.0
    return float(np.mean(values[-window:]))


def generate_forecast(trained: TrainedDemandModel, horizon_hours: int) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for outlet_code, outlet_id in trained.decode.items():
        group = trained.history[trained.history["outlet_id"] == outlet_id].sort_values("timestamp")
        if group.empty:
            continue
        values = [float(value) for value in group["orders"].tolist()]
        cursor = group["timestamp"].max() + timedelta(hours=1)
        for _ in range(horizon_hours):
            row = pd.DataFrame([{
                "outlet_code": outlet_code, "hour": cursor.hour, "day_of_week": cursor.dayofweek,
                "day_of_month": cursor.day, "week_of_month": (cursor.day - 1) // 7 + 1,
                "month": cursor.month, "is_weekend": int(cursor.dayofweek >= 5),
                "is_month_start": int(cursor.is_month_start), "is_month_end": int(cursor.is_month_end),
                "orders_previous_hour": _lag(values, 1), "orders_previous_day": _lag(values, 24),
                "orders_previous_week": _lag(values, 168), "orders_3h_avg": _avg(values, 3),
                "orders_6h_avg": _avg(values, 6), "orders_24h_avg": _avg(values, 24),
                "orders_7d_avg": _avg(values, 168),
            }])
            prediction = max(0.0, float(trained.model.predict(row[FEATURES])[0]))
            values.append(prediction)
            output.append({"outlet_id": outlet_id, "forecast_timestamp": cursor.isoformat(), "predicted_orders": round(prediction, 2)})
            cursor += timedelta(hours=1)
    return output


def run_demand_forecast(payload: dict[str, Any]) -> dict[str, Any]:
    observations = payload.get("observations", [])
    horizon = int(payload.get("horizon_hours", 168))
    trained = train_demand_model(observations)
    if trained is None:
        outlet_count = len({str(row.get("outlet_id")) for row in observations})
        return {"status": "insufficient_data", "model_version": MODEL_VERSION, "training_records": len(observations), "eligible_outlet_count": 0, "message": "More historical transactions are required to establish a reliable hourly demand pattern (minimum 21 days and 168 hourly rows per eligible outlet).", "metrics": None, "forecasts": []}
    forecasts = generate_forecast(trained, horizon)
    return {"status": "completed", "model_version": MODEL_VERSION, "training_records": len(trained.history), "eligible_outlet_count": len(trained.decode), "message": f"Generated {horizon}-hour expected-demand forecasts for {len(trained.decode)} outlets.", "metrics": trained.metrics, "forecasts": forecasts}
