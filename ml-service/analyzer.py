"""Reproducible feature engineering and Isolation Forest scoring for RetailIQ.

The service receives real business events aggregated from the trusted RetailIQ server
action. It never invents production observations. Demo fixtures live separately.
"""
from __future__ import annotations

from typing import Any
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import RobustScaler

from config import CONFIG

FEATURE_COLUMNS = [
    "sales_revenue", "net_sales", "order_count", "units_sold",
    "average_order_value", "return_amount", "return_rate", "wastage_cost",
    "wastage_rate", "discount_amount", "discount_rate", "gross_profit",
    "gross_margin", "operating_cost", "net_profit", "profit_margin",
    "hour", "day_of_week", "day_of_month", "month",
    "revenue_vs_7d", "orders_vs_7d", "returns_vs_7d", "wastage_vs_7d",
    "profit_vs_7d",
]


def _frame(rows: list[dict[str, Any]], date_field: str) -> pd.DataFrame:
    frame = pd.DataFrame(rows)
    if frame.empty:
        return frame
    frame[date_field] = pd.to_datetime(frame[date_field], utc=True, errors="coerce")
    return frame.dropna(subset=[date_field])


def build_features(payload: dict[str, Any]) -> pd.DataFrame:
    outlets = pd.DataFrame(payload.get("outlets", []))
    bills = _frame(payload.get("bills", []), "timestamp")
    returns = _frame(payload.get("returns", []), "timestamp")
    wastage = _frame(payload.get("wastage", []), "timestamp")
    costs = pd.DataFrame(payload.get("costs", []))
    if outlets.empty or bills.empty:
        return pd.DataFrame()

    bills["date"] = bills["timestamp"].dt.floor("D")
    for col in ["sales_revenue", "discount_amount", "cogs", "units_sold"]:
        bills[col] = pd.to_numeric(bills.get(col, 0), errors="coerce").fillna(0)
    daily = bills.groupby(["outlet_id", "date"], as_index=False).agg(
        sales_revenue=("sales_revenue", "sum"),
        order_count=("bill_id", "nunique"),
        units_sold=("units_sold", "sum"),
        discount_amount=("discount_amount", "sum"),
        gross_cogs=("cogs", "sum"),
        hour=("timestamp", lambda s: float(s.dt.hour.mean())),
    )

    if not returns.empty:
        returns["date"] = returns["timestamp"].dt.floor("D")
        returns["return_amount"] = pd.to_numeric(returns["return_amount"], errors="coerce").fillna(0)
        returns["returned_cogs"] = pd.to_numeric(returns["returned_cogs"], errors="coerce").fillna(0)
        rd = returns.groupby(["outlet_id", "date"], as_index=False).agg(return_amount=("return_amount", "sum"), returned_cogs=("returned_cogs", "sum"))
        daily = daily.merge(rd, on=["outlet_id", "date"], how="outer")
    if not wastage.empty:
        wastage["date"] = wastage["timestamp"].dt.floor("D")
        wastage["wastage_cost"] = pd.to_numeric(wastage["wastage_cost"], errors="coerce").fillna(0)
        wd = wastage.groupby(["outlet_id", "date"], as_index=False).agg(wastage_cost=("wastage_cost", "sum"))
        daily = daily.merge(wd, on=["outlet_id", "date"], how="outer")

    min_date = daily["date"].min()
    max_date = daily["date"].max()
    complete = pd.MultiIndex.from_product(
        [outlets["id"].astype(str).tolist(), pd.date_range(min_date, max_date, freq="D", tz="UTC")],
        names=["outlet_id", "date"],
    ).to_frame(index=False)
    daily = complete.merge(daily, on=["outlet_id", "date"], how="left")
    numeric = ["sales_revenue", "order_count", "units_sold", "discount_amount", "gross_cogs", "return_amount", "returned_cogs", "wastage_cost"]
    for col in numeric:
        if col not in daily:
            daily[col] = 0.0
        daily[col] = pd.to_numeric(daily[col], errors="coerce").fillna(0.0)
    daily["hour"] = pd.to_numeric(daily.get("hour", 12), errors="coerce").fillna(12.0)

    daily["operating_cost"] = 0.0
    if not costs.empty:
        for _, row in costs.iterrows():
            month = int(row["period_month"])
            year = int(row["period_year"])
            days = pd.Period(f"{year}-{month:02d}").days_in_month
            monthly = sum(float(row.get(k, 0) or 0) for k in ["rent", "staff_cost", "utilities", "other_costs"])
            mask = (daily["outlet_id"] == row["outlet_id"]) & (daily["date"].dt.year == year) & (daily["date"].dt.month == month)
            daily.loc[mask, "operating_cost"] += monthly / days

    daily["net_sales"] = daily["sales_revenue"] - daily["return_amount"]
    daily["cogs"] = (daily["gross_cogs"] - daily["returned_cogs"]).clip(lower=0)
    daily["average_order_value"] = np.where(daily["order_count"] > 0, daily["sales_revenue"] / daily["order_count"], 0)
    daily["return_rate"] = np.where(daily["sales_revenue"] > 0, daily["return_amount"] / daily["sales_revenue"], 0)
    daily["wastage_rate"] = np.where(daily["net_sales"] > 0, daily["wastage_cost"] / daily["net_sales"], 0)
    daily["discount_rate"] = np.where(daily["sales_revenue"] > 0, daily["discount_amount"] / daily["sales_revenue"], 0)
    daily["gross_profit"] = daily["net_sales"] - daily["cogs"]
    daily["gross_margin"] = np.where(daily["net_sales"] != 0, daily["gross_profit"] / daily["net_sales"], 0)
    daily["net_profit"] = daily["gross_profit"] - daily["wastage_cost"] - daily["operating_cost"]
    daily["profit_margin"] = np.where(daily["net_sales"] != 0, daily["net_profit"] / daily["net_sales"], 0)
    daily["day_of_week"] = daily["date"].dt.dayofweek
    daily["day_of_month"] = daily["date"].dt.day
    daily["month"] = daily["date"].dt.month

    daily = daily.sort_values(["outlet_id", "date"]).reset_index(drop=True)
    roll_map = {
        "sales_revenue": "revenue", "order_count": "orders", "return_amount": "returns",
        "wastage_cost": "wastage", "net_profit": "profit",
    }
    for source, short in roll_map.items():
        baseline = daily.groupby("outlet_id")[source].transform(lambda s: s.shift(1).rolling(CONFIG.rolling_window_days, min_periods=3).mean())
        daily[f"baseline_{short}"] = baseline.fillna(daily.groupby("outlet_id")[source].transform("median"))
        denom = daily[f"baseline_{short}"].abs().clip(lower=1.0)
        daily[f"{short}_vs_7d"] = (daily[source] - daily[f"baseline_{short}"]) / denom
    return daily.replace([np.inf, -np.inf], 0).fillna(0)


def _severity(score: float) -> str:
    if score >= 80:
        return "high_attention"
    if score >= 60:
        return "elevated"
    return "watch"


def _anomaly_type(row: pd.Series) -> tuple[str, str, str, str]:
    candidates = {
        "high_returns": max(0.0, float(row["returns_vs_7d"])),
        "high_wastage": max(0.0, float(row["wastage_vs_7d"])),
        "revenue_drop": max(0.0, -float(row["revenue_vs_7d"])),
        "revenue_spike": max(0.0, float(row["revenue_vs_7d"])),
        "order_volume_anomaly": abs(float(row["orders_vs_7d"])),
        "profitability_anomaly": max(0.0, -float(row["profit_vs_7d"])),
        "margin_drop": max(0.0, float(row.get("baseline_profit", 0) - row["net_profit"]) / max(abs(float(row.get("baseline_profit", 0))), 1.0)),
        "discount_spike": max(0.0, float(row["discount_rate"]) - 0.05),
    }
    ordered = sorted(candidates.items(), key=lambda item: item[1], reverse=True)
    kind = "multi_factor_anomaly" if len([v for _, v in ordered if v >= 0.25]) >= 2 else ordered[0][0]
    labels = {
        "high_returns": ("Returns significantly above recent behavior", "Review recent return transactions and top returned products."),
        "high_wastage": ("Wastage cost increased sharply", "Review wastage entries, stock handling, and affected products."),
        "revenue_drop": ("Revenue fell below the recent baseline", "Review bill volume, outlet availability, and sales mix."),
        "revenue_spike": ("Revenue rose unusually above the recent baseline", "Validate high-value bills and unusual order concentration."),
        "order_volume_anomaly": ("Order volume moved outside its recent pattern", "Review bill history and operating conditions for this period."),
        "profitability_anomaly": ("Profitability deteriorated against the recent baseline", "Review margins, returns, wastage, discounts, and operating costs."),
        "margin_drop": ("Margin is below recent operating behavior", "Review product mix, historical item costs, discounts, and returns."),
        "discount_spike": ("Discounting is unusually elevated", "Review discount activity and the related bills."),
        "multi_factor_anomaly": ("Multiple operational metrics changed together", "Review returns, wastage, sales, discounts, and profitability for this period."),
    }
    summary, recommendation = labels[kind]
    related = ", ".join(k.replace("_vs_7d", "").replace("_", " ") for k, v in ordered[:2] if v > 0)
    return kind, summary, recommendation, related


def analyze(payload: dict[str, Any]) -> dict[str, Any]:
    features = build_features(payload)
    counts = features.groupby("outlet_id").size().to_dict() if not features.empty else {}
    eligible = [outlet_id for outlet_id, count in counts.items() if count >= CONFIG.min_observations_per_outlet]
    if features.empty or len(features) < CONFIG.min_total_observations or not eligible:
        return {
            "status": "insufficient_data", "model_version": CONFIG.model_version,
            "observation_count": int(len(features)), "eligible_outlet_count": len(eligible), "anomalies": [],
            "message": f"Not enough historical data to establish a reliable baseline. Need at least {CONFIG.min_total_observations} daily observations overall and {CONFIG.min_observations_per_outlet} per outlet.",
        }
    model_frame = features[features["outlet_id"].isin(eligible)].copy()
    matrix = RobustScaler().fit_transform(model_frame[FEATURE_COLUMNS].astype(float))
    model = IsolationForest(
        contamination=CONFIG.contamination,
        random_state=CONFIG.random_state,
        n_estimators=CONFIG.n_estimators,
        n_jobs=-1,
    )
    labels = model.fit_predict(matrix)
    raw_scores = -model.decision_function(matrix)
    lo, hi = float(raw_scores.min()), float(raw_scores.max())
    normalized = np.full_like(raw_scores, 50.0) if hi == lo else (raw_scores - lo) / (hi - lo) * 100.0
    model_frame["label"] = labels
    model_frame["raw_model_score"] = raw_scores
    model_frame["anomaly_score"] = normalized
    anomalies: list[dict[str, Any]] = []
    for _, row in model_frame[model_frame["label"] == -1].sort_values("anomaly_score", ascending=False).iterrows():
        kind, summary, recommendation, related = _anomaly_type(row)
        snapshot_keys = [
            "sales_revenue", "net_sales", "order_count", "units_sold", "average_order_value",
            "return_amount", "return_rate", "wastage_cost", "wastage_rate", "discount_amount",
            "discount_rate", "gross_profit", "gross_margin", "operating_cost", "net_profit",
            "profit_margin", "baseline_revenue", "baseline_orders", "baseline_returns",
            "baseline_wastage", "baseline_profit", "revenue_vs_7d", "orders_vs_7d",
            "returns_vs_7d", "wastage_vs_7d", "profit_vs_7d",
        ]
        snapshot = {key: round(float(row[key]), 6) for key in snapshot_keys}
        snapshot["related_signal"] = related
        anomalies.append({
            "outlet_id": str(row["outlet_id"]), "event_timestamp": row["date"].isoformat(),
            "anomaly_type": kind, "severity": _severity(float(row["anomaly_score"])),
            "anomaly_score": round(float(row["anomaly_score"]), 2),
            "raw_model_score": round(float(row["raw_model_score"]), 8),
            "feature_snapshot": snapshot, "summary": summary, "recommendation": recommendation,
        })
    return {
        "status": "completed", "model_version": CONFIG.model_version,
        "observation_count": int(len(model_frame)), "eligible_outlet_count": len(eligible),
        "anomalies": anomalies, "message": "Isolation Forest analysis completed.",
    }
