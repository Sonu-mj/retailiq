"""Development-only scenario test. No rows are written to the application database."""
from datetime import datetime, timedelta, timezone
from analyzer import analyze


def fixture() -> dict:
    start = datetime(2026, 7, 1, tzinfo=timezone.utc)
    bills = []
    returns = []
    wastage = []
    for day in range(45):
        stamp = start + timedelta(days=day)
        revenue = 80000 + ((day % 7) - 3) * 900
        orders = 220 + (day % 5)
        return_amount = revenue * 0.027
        waste_cost = 3400 / 30
        if day == 44:
            revenue = 52000
            orders = 132
            return_amount = revenue * 0.05
            waste_cost = 6000
        bills.append({"bill_id": f"B{day}", "outlet_id": "OUT003", "timestamp": stamp.isoformat(), "sales_revenue": revenue, "discount_amount": 900, "cogs": revenue * 0.52, "units_sold": orders * 2})
        returns.append({"outlet_id": "OUT003", "timestamp": stamp.isoformat(), "return_amount": return_amount, "returned_cogs": return_amount * 0.52})
        wastage.append({"outlet_id": "OUT003", "timestamp": stamp.isoformat(), "wastage_cost": waste_cost})
    return {"outlets": [{"id": "OUT003"}], "bills": bills, "returns": returns, "wastage": wastage, "costs": [{"outlet_id": "OUT003", "period_month": 7, "period_year": 2026, "rent": 80000, "staff_cost": 120000, "utilities": 15000, "other_costs": 10000}]}


def test_outlet_3_unusual_period_is_model_detected() -> None:
    result = analyze(fixture())
    assert result["status"] == "completed"
    detected = [row for row in result["anomalies"] if row["outlet_id"] == "OUT003" and row["event_timestamp"].startswith("2026-08-14")]
    assert detected, result
    assert detected[0]["anomaly_type"] in {"multi_factor_anomaly", "high_wastage", "revenue_drop", "profitability_anomaly"}


if __name__ == "__main__":
    test_outlet_3_unusual_period_is_model_detected()
    print("PASS: Outlet 3 unusual period was identified by trained Isolation Forest")
