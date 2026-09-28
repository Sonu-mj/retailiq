# RetailIQ ML service

A separate Python service for daily outlet anomaly detection. `POST /ml/analyze` accepts real bill, return, wastage, and operating-cost events from the RetailIQ server action. Pandas builds one observation per outlet/day and lagged seven-day baselines; `RobustScaler` and scikit-learn `IsolationForest` score eligible observations.

## Configuration

All model settings are centralized in `config.py`:

- contamination: `0.08` (expected review queue size, not a probability)
- random_state: `42` (reproducible training)
- n_estimators: `240` (stable ranking at modest daily volume)
- minimums: 30 observations overall and 21 days for an outlet
- rolling window: 7 prior days (shifted to prevent target leakage)

The displayed anomaly score is a 0–100 min/max normalization of `-decision_function` within the completed run. It is a severity rank, not confidence or probability. Detected rows map to Watch (<60), Elevated (60–79.99), or High Attention (>=80). Raw model scores are stored unchanged.

## Run

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8091
```

Production may set `RETAILIQ_ML_SERVICE_URL` on the artifact host to call the FastAPI endpoint. The managed deployment can otherwise use the same analyzer through the privileged CLI adapter. Do not put credentials in the client.

`demo_fixture_test.py` is development-only and never writes demo observations or anomalies to production tables.
