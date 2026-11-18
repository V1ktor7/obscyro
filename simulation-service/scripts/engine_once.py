"""One call to the event engine, without a server.

Reads `{"path": "/events/spread" | "/events/compare", "body": {...}}` on stdin
and writes the route's response on stdout, as the HTTP surface would. Used by
`backend/scripts/make-scenario-run-fixture.ts` to record what the real engine
answers, so the page's test and the server's test replay the engine rather than
somebody's idea of it.

Run from `simulation-service/`:

    python scripts/engine_once.py < request.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException  # noqa: E402

from app.events.api import CompareRequest, SpreadRequest, compare_route, spread_route  # noqa: E402

ROUTES = {
    "/events/spread": (SpreadRequest, spread_route),
    "/events/compare": (CompareRequest, compare_route),
}


def main() -> int:
    request = json.load(sys.stdin)
    model, route = ROUTES[request["path"]]
    try:
        out = route(model.model_validate(request["body"]))
    except HTTPException as exc:
        json.dump({"refused": exc.status_code, "detail": exc.detail}, sys.stdout)
        return 1
    sys.stdout.write(out.model_dump_json())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
