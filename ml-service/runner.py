"""CLI adapter used by the managed artifact's privileged server action."""
import json
import sys
from analyzer import analyze


def main() -> None:
    payload = json.load(sys.stdin)
    json.dump(analyze(payload), sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
