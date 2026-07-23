from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

os.environ.setdefault("WORKCARD_ENVIRONMENT", "test")
os.environ.setdefault("WORKCARD_DATABASE_URL", "postgresql://unused:unused@localhost/unused")
os.environ.setdefault(
    "WORKCARD_SESSION_SIGNING_SECRET", "openapi-only-signing-secret-at-least-32-chars"
)
os.environ.setdefault("WORKCARD_ALLOWED_ORIGINS", '["http://testserver"]')

from workcard_api.app import app

OUTPUT = Path(__file__).resolve().parents[1] / "openapi" / "openapi.json"


def rendered_openapi() -> str:
    return json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()
    if arguments.check and arguments.output is not None:
        parser.error("--check and --output are mutually exclusive")
    generated = rendered_openapi()
    if arguments.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != generated:
            raise SystemExit("openapi/openapi.json is stale; run scripts/export_openapi.py")
        return
    target = arguments.output or OUTPUT
    target.write_text(generated, encoding="utf-8")


if __name__ == "__main__":
    main()
