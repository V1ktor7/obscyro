"""Run somebody's Python without handing them the platform.

The lab lets a user write real code against their own data. That is the whole
point of it, and it is also the single most dangerous thing in this service —
so the execution path is deliberately unpleasant to get wrong.

What the danger actually is, concretely: this process holds ``DATABASE_URL``.
A bare ``exec()`` in the request handler would let a code cell open the
database, read every table, and post it anywhere. On a platform meant to hold a
health network's operating picture, that is not a theoretical finding; it is the
finding.

So the code never runs in this process. It runs in a child with:

* **A scrubbed environment.** Not a filtered one — an empty one, rebuilt from
  three variables that are needed to start Python at all. ``DATABASE_URL``,
  API keys, and cloud metadata tokens simply are not present to be read.
* **A private working directory**, deleted afterwards, and made the process's
  cwd so a relative path cannot reach the app.
* **A wall-clock timeout**, enforced by the parent, so an infinite loop costs
  one request rather than the service.
* **An address-space limit** on platforms that have ``resource``, so a runaway
  allocation is killed by the kernel instead of by the OOM reaper taking the
  whole container with it.

**There is no import filter, and that is deliberate.** An earlier version had
one. It was theatre: importing pandas alone already loads ``subprocess``,
``ctypes``, ``shutil`` and ``urllib`` into ``sys.modules``, and sklearn adds
``socket``, ``ssl`` and ``multiprocessing``. A filter that lets the lab work at
all therefore cannot stop a cell reaching any of them — it would only refuse a
naive ``import socket`` while ``sys.modules["socket"]`` sat one line away. A
guard that can be stepped over in a line, while reading as protection, is worse
than no guard: it moves the reader's belief without moving the risk.

So the boundary is stated exactly:

* **Credentials are gone.** This is the part that matters and it holds. The
  child cannot read ``DATABASE_URL``, so it cannot open the database, whatever
  else it can import.
* **The network namespace is shared.** A cell can open a socket. Internal
  services remain protected by their own authentication, which the cell has no
  secret for — but this is not isolation.
* **The filesystem is shared.** A cell can read ``/app``. That is the operator's
  own source, so the exposure is theirs, not a third party's.

Full containment means a separate service with no secrets in its environment and
an egress policy — a deployment decision, not a code one. Until then, treat the
lab as trusted-operator territory: anybody who can run a cell can see anything
that process could see, minus the credentials.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from typing import Any

# Long enough for a fit on a few hundred thousand rows, short enough that a
# stuck cell is a nuisance rather than an outage.
DEFAULT_TIMEOUT_S = 30
MAX_TIMEOUT_S = 120
# Address space, not resident size: numpy reserves generously and would be
# killed far too early on an RSS limit.
DEFAULT_MEMORY_MB = 1024

def _package_paths() -> list[str]:
    """Every directory this interpreter imports third-party packages from."""
    import site

    paths: list[str] = []
    try:
        paths.extend(site.getsitepackages())
    except AttributeError:  # pragma: no cover - virtualenvs without it
        pass
    try:
        user = site.getusersitepackages()
        if isinstance(user, str):
            paths.append(user)
    except Exception:  # pragma: no cover
        pass
    # Anything already on the parent's path that looks like a package root —
    # covers virtualenv layouts the two calls above miss.
    paths.extend(p for p in sys.path if p.endswith("site-packages"))
    seen: set[str] = set()
    return [p for p in paths if p and not (p in seen or seen.add(p))]


@dataclass
class SandboxResult:
    ok: bool
    stdout: str
    stderr: str
    #: Whatever the cell assigned to ``result``, if it is JSON-serialisable.
    result: Any
    duration_ms: int
    timed_out: bool


_PRELUDE = '''
import sys, json, builtins, io, os

# Where the parent's packages live, handed over explicitly.
#
# They cannot be found any other way: the child's environment is rebuilt from
# nothing, and on Windows the user site directory is located through APPDATA —
# which is exactly the kind of variable that must not be inherited. Passing the
# paths in argv keeps the environment scrubbed and makes the child work the
# same on a laptop and in the container, where packages sit system-wide.
sys.path[:0] = json.loads(sys.argv[3])

# The one door out is a file the parent reads. Anything else the cell writes
# lands in a directory that is deleted a moment later.
_OUT = sys.argv[2]

import pandas as pd

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    _payload = json.load(fh)

df = pd.DataFrame(_payload["rows"])
result = None

_user_code = _payload["code"]
_scope = {"df": df, "pd": pd, "result": None, "__name__": "__lab__"}
exec(compile(_user_code, "<cellule>", "exec"), _scope)

_res = _scope.get("result")
try:
    if isinstance(_res, pd.DataFrame):
        _res = {"columns": list(_res.columns), "rows": _res.head(500).to_dict("records")}
    elif isinstance(_res, pd.Series):
        _res = {"values": _res.head(500).tolist()}
    # Strict, with no `default`: the point is to find out whether the value is
    # really JSON, not to let a fallback turn a function into its own repr and
    # call that a result.
    json.dumps(_res)
except (TypeError, ValueError):
    _res = {"note": "result was not serialisable", "repr": repr(_res)[:2000]}

with open(_OUT, "w", encoding="utf-8") as fh:
    json.dump(_res, fh, default=str)
'''


def run_cell(
    code: str,
    rows: list[dict[str, Any]],
    timeout_s: int = DEFAULT_TIMEOUT_S,
    memory_mb: int = DEFAULT_MEMORY_MB,
) -> SandboxResult:
    """Execute ``code`` with ``df`` bound to ``rows``, and return what it set."""
    import time

    timeout_s = max(1, min(int(timeout_s), MAX_TIMEOUT_S))
    workdir = tempfile.mkdtemp(prefix="obscyro-lab-")
    started = time.monotonic()

    try:
        prelude = os.path.join(workdir, "_run.py")
        payload = os.path.join(workdir, "_in.json")
        out = os.path.join(workdir, "_out.json")

        with open(prelude, "w", encoding="utf-8") as fh:
            fh.write(_PRELUDE)
        with open(payload, "w", encoding="utf-8") as fh:
            json.dump({"code": code, "rows": rows}, fh, default=str)

        # Rebuilt from nothing. A filtered copy of os.environ is how secrets
        # leak: somebody adds a variable later and nobody revisits the filter.
        env = {
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "HOME": workdir,
            "PYTHONDONTWRITEBYTECODE": "1",
            "MPLBACKEND": "Agg",
            "OPENBLAS_NUM_THREADS": "1",
            "OMP_NUM_THREADS": "1",
        }
        if os.name == "nt":
            # Winsock refuses to initialise without these and asyncio — which
            # joblib imports, which sklearn imports — dies with WinError 10106.
            # They are OS paths, not secrets, so adding them costs nothing that
            # matters: the credentials stay absent.
            for key in ("SYSTEMROOT", "WINDIR", "TEMP", "TMP"):
                val = os.environ.get(key)
                if val:
                    env[key] = val

        def _limits() -> None:  # pragma: no cover - POSIX only
            try:
                import resource

                cap = memory_mb * 1024 * 1024
                resource.setrlimit(resource.RLIMIT_AS, (cap, cap))
                resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
                resource.setrlimit(resource.RLIMIT_FSIZE, (64 * 1024 * 1024,) * 2)
            except Exception:
                # Windows has no `resource`. The timeout still applies, and the
                # developer machine is not the threat model.
                pass

        proc = subprocess.run(
            [
                sys.executable,
                # -E ignores every PYTHON* variable. Not -I: isolated mode also
                # drops the user site directory, which is where the packages
                # live on a developer machine, so the whole lab would work in
                # the container and fail on the laptop that has to test it.
                # The environment is rebuilt from nothing anyway, so there is
                # no PYTHON* left to ignore — this is belt and braces.
                "-E",
                prelude,
                payload,
                out,
                json.dumps(_package_paths()),
            ],
            cwd=workdir,
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            preexec_fn=_limits if os.name == "posix" else None,
        )

        value: Any = None
        if os.path.exists(out):
            try:
                with open(out, "r", encoding="utf-8") as fh:
                    value = json.load(fh)
            except Exception:
                value = None

        return SandboxResult(
            ok=proc.returncode == 0,
            stdout=proc.stdout[-20000:],
            stderr=proc.stderr[-20000:],
            result=value,
            duration_ms=int((time.monotonic() - started) * 1000),
            timed_out=False,
        )

    except subprocess.TimeoutExpired:
        return SandboxResult(
            ok=False,
            stdout="",
            stderr=f"The cell ran longer than {timeout_s}s and was stopped.",
            result=None,
            duration_ms=int((time.monotonic() - started) * 1000),
            timed_out=True,
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
