"""Development-only controlled fixture; never writes production rows."""
from datetime import datetime, timedelta, timezone
from forecast_model import build_hourly_features, train_demand_model, generate_forecast


def fixture():
    start=datetime(2026,7,1,tzinfo=timezone.utc)
    rows=[]
    for outlet_index,outlet in enumerate(["TEST_OUT_A","TEST_OUT_B"]):
        for hour in range(24*35):
            stamp=start+timedelta(hours=hour)
            open_hour=8<=stamp.hour<=22
            evening=10 if 18<=stamp.hour<=21 else 0
            weekend=7 if stamp.weekday()>=5 else 0
            base=(4+outlet_index*2+evening+weekend) if open_hour else 0
            orders=max(0,base+((hour*7+outlet_index*3)%5)-2)
            rows.append({"outlet_id":outlet,"timestamp":stamp.isoformat(),"orders":orders,"units_sold":orders*2,"revenue":orders*130,"average_order_value":130 if orders else 0})
    return rows


def test_pipeline():
    rows=fixture(); features,_=build_hourly_features(rows)
    assert not features.empty and "orders_previous_week" in features
    trained=train_demand_model(rows); assert trained is not None
    assert trained.metrics["mae"]>=0 and trained.metrics["rmse"]>=0
    forecast=generate_forecast(trained,168); assert len(forecast)==336
    assert all(row["predicted_orders"]>=0 for row in forecast)


if __name__=="__main__":
    test_pipeline(); print("forecast fixture pipeline: ok")
