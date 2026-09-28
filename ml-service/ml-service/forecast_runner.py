#!/usr/bin/env python3
"""stdin/stdout adapter for the privileged TypeScript forecast contract."""
import json
import sys

from forecast_model import run_demand_forecast


def main() -> None:
    payload = json.load(sys.stdin)
    json.dump(run_demand_forecast(payload), sys.stdout, separators=(",", ":"), allow_nan=False)


if __name__ == "__main__":
    main()
