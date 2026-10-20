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


class HistogramGradientBoostingRegressor:
    """Histogram-based gradient boosting for squared loss, NumPy only.

    Mirrors the scikit-learn HistGradientBoostingRegressor configuration this
    module previously used (binned features, leaf-wise growth, L2 leaf
    regularization) so forecasts keep the same model version and behaviour
    without requiring scikit-learn on the host.
    """

    def __init__(self, max_iter: int = 240, learning_rate: float = 0.06, max_leaf_nodes: int = 23,
                 l2_regularization: float = 0.15, min_samples_leaf: int = 20, max_bins: int = 64,
                 random_state: int = 42):
        self.max_iter = max_iter
        self.learning_rate = learning_rate
        self.max_leaf_nodes = max_leaf_nodes
        self.l2_regularization = l2_regularization
        self.min_samples_leaf = min_samples_leaf
        self.max_bins = max_bins
        self.random_state = random_state
        self.bin_thresholds: list[np.ndarray] = []
        self.trees: list[dict[str, np.ndarray]] = []
        self.init_prediction = 0.0

    def _bin(self, values: np.ndarray) -> np.ndarray:
        binned = np.empty(values.shape, dtype=np.int32)
        for j in range(values.shape[1]):
            binned[:, j] = np.searchsorted(self.bin_thresholds[j], values[:, j], side="right")
        return binned

    def _fit_bin_thresholds(self, values: np.ndarray) -> None:
        self.bin_thresholds = []
        for j in range(values.shape[1]):
            column = values[:, j]
            uniques = np.unique(column)
            if len(uniques) <= self.max_bins:
                thresholds = (uniques[:-1] + uniques[1:]) / 2.0
            else:
                quantiles = np.linspace(0.0, 1.0, self.max_bins + 1)[1:-1]
                thresholds = np.unique(np.quantile(column, quantiles))
            self.bin_thresholds.append(np.asarray(thresholds, dtype=float))

    def _best_split(self, binned: np.ndarray, residuals: np.ndarray, indices: np.ndarray):
        total = float(residuals[indices].sum())
        count = len(indices)
        base = total * total / (count + self.l2_regularization)
        best: tuple[float, int, int] | None = None
        for feature in range(binned.shape[1]):
            n_bins = int(binned[indices, feature].max()) + 1 if count else 0
            if n_bins < 2:
                continue
            sums = np.bincount(binned[indices, feature], weights=residuals[indices], minlength=n_bins)
            counts = np.bincount(binned[indices, feature], minlength=n_bins)
            cum_sum = np.cumsum(sums)[:-1]
            cum_count = np.cumsum(counts)[:-1]
            valid = (cum_count >= self.min_samples_leaf) & ((count - cum_count) >= self.min_samples_leaf)
            if not valid.any():
                continue
            gains = (cum_sum * cum_sum / (cum_count + self.l2_regularization)
                     + (total - cum_sum) ** 2 / ((count - cum_count) + self.l2_regularization) - base)
            gains = np.where(valid, gains, -np.inf)
            split = int(np.argmax(gains))
            gain = float(gains[split])
            if best is None or gain > best[0]:
                best = (gain, feature, split)
        return best

    def _grow_tree(self, binned: np.ndarray, residuals: np.ndarray) -> dict[str, np.ndarray]:
        features: list[int] = []
        thresholds: list[int] = []
        lefts: list[int] = []
        rights: list[int] = []
        leaf_values: list[float] = []
        leaf_indices: list[np.ndarray | None] = [np.arange(len(residuals))]
        leaf_best: list[tuple[float, int, int] | None] = [self._best_split(binned, residuals, leaf_indices[0])]
        n_nodes = 1
        while n_nodes < self.max_leaf_nodes:
            candidate: tuple[float, int] | None = None
            for leaf_id, best in enumerate(leaf_best):
                if best is not None and best[0] > 0 and (candidate is None or best[0] > candidate[0]):
                    candidate = (best[0], leaf_id)
            if candidate is None:
                break
            leaf_id = candidate[1]
            best = leaf_best[leaf_id]
            if best is None or leaf_indices[leaf_id] is None:
                break
            _, feature, split = best
            indices = leaf_indices[leaf_id]
            goes_left = binned[indices, feature] <= split
            left_idx = indices[goes_left]
            right_idx = indices[~goes_left]
            left_id = len(leaf_indices)
            right_id = left_id + 1
            while len(features) < leaf_id + 1:
                features.append(-1); thresholds.append(-1); lefts.append(-1); rights.append(-1); leaf_values.append(0.0)
            features[leaf_id] = feature
            thresholds[leaf_id] = split
            lefts[leaf_id] = left_id
            rights[leaf_id] = right_id
            leaf_indices[leaf_id] = None
            leaf_best[leaf_id] = None
            leaf_indices.extend([left_idx, right_idx])
            leaf_best.extend([
                self._best_split(binned, residuals, left_idx),
                self._best_split(binned, residuals, right_idx),
            ])
            n_nodes += 1
        size = len(leaf_indices)
        while len(features) < size:
            features.append(-1); thresholds.append(-1); lefts.append(-1); rights.append(-1); leaf_values.append(0.0)
        for leaf_id, indices in enumerate(leaf_indices):
            if indices is None:
                continue
            leaf_values[leaf_id] = float(residuals[indices].sum() / (len(indices) + self.l2_regularization)) if len(indices) else 0.0
        return {
            "feature": np.array(features, dtype=int), "threshold": np.array(thresholds, dtype=int),
            "left": np.array(lefts, dtype=int), "right": np.array(rights, dtype=int),
            "value": np.array(leaf_values, dtype=float),
        }

    def _tree_predict_binned(self, tree: dict[str, np.ndarray], binned: np.ndarray) -> np.ndarray:
        node = np.zeros(len(binned), dtype=int)
        active = tree["feature"][node] >= 0
        while active.any():
            rows = np.flatnonzero(active)
            current = node[rows]
            goes_left = binned[rows, tree["feature"][current]] <= tree["threshold"][current]
            node[rows] = np.where(goes_left, tree["left"][current], tree["right"][current])
            active = tree["feature"][node] >= 0
        return tree["value"][node]

    def fit(self, frame: pd.DataFrame, target: pd.Series) -> "HistogramGradientBoostingRegressor":
        values = frame.to_numpy(dtype=float)
        y = target.to_numpy(dtype=float)
        self._fit_bin_thresholds(values)
        binned = self._bin(values)
        self.init_prediction = float(np.mean(y)) if len(y) else 0.0
        prediction = np.full(len(y), self.init_prediction)
        self.trees = []
        for _ in range(self.max_iter):
            residuals = y - prediction
            if len(residuals) == 0 or float(np.max(np.abs(residuals))) < 1e-9:
                break
            tree = self._grow_tree(binned, residuals)
            update = self._tree_predict_binned(tree, binned)
            if not np.any(update):
                break
            self.trees.append(tree)
            prediction = prediction + self.learning_rate * update
        return self

    def _predict_single(self, binned_row: np.ndarray) -> float:
        total = self.init_prediction
        for tree in self.trees:
            node = 0
            features = tree["feature"]
            while features[node] >= 0:
                feature = int(features[node])
                node = int(tree["left"][node]) if binned_row[feature] <= tree["threshold"][node] else int(tree["right"][node])
            total += self.learning_rate * float(tree["value"][node])
        return total

    def predict(self, frame: pd.DataFrame) -> np.ndarray:
        values = frame.to_numpy(dtype=float)
        binned = self._bin(values)
        if len(values) == 1:
            return np.array([self._predict_single(binned[0])])
        prediction = np.full(len(values), self.init_prediction)
        for tree in self.trees:
            prediction = prediction + self.learning_rate * self._tree_predict_binned(tree, binned)
        return prediction


@dataclass
class TrainedDemandModel:
    model: HistogramGradientBoostingRegressor
    decode: dict[int, str]
    history: pd.DataFrame
    metrics: dict[str, float | None]


def train_demand_model(observations: list[dict[str, Any]]) -> TrainedDemandModel | None:
    frame, decode = build_hourly_features(observations)
    if frame.empty:
        return None
    eligible_ids = []
    for outlet_id, group in frame.groupby("outlet_id"):
        distinct_days = int(group["timestamp"].dt.date.nunique())
        if len(group) >= MIN_ROWS_PER_OUTLET and distinct_days >= MIN_DAYS:
            eligible_ids.append(outlet_id)
    frame = frame[frame["outlet_id"].isin(eligible_ids)].dropna(subset=FEATURES + ["orders"]).copy()
    if len(frame) < 168 or not eligible_ids:
        return None
    frame = frame.sort_values("timestamp")
    split = max(1, int(len(frame) * 0.8))
    train, test = frame.iloc[:split], frame.iloc[split:]
    if test.empty:
        return None
    model = HistogramGradientBoostingRegressor(max_iter=160, learning_rate=0.06, max_leaf_nodes=23, l2_regularization=0.15, random_state=42)
    model.fit(train[FEATURES], train["orders"])
    predicted = np.maximum(0.0, model.predict(test[FEATURES]))
    actual = test["orders"].to_numpy()
    nonzero = actual != 0
    mape = float(np.mean(np.abs((actual[nonzero] - predicted[nonzero]) / actual[nonzero])) * 100) if nonzero.any() else None
    errors = actual - predicted
    metrics = {"mae": float(np.mean(np.abs(errors))), "rmse": float(sqrt(np.mean(errors ** 2))), "mape": mape}
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
