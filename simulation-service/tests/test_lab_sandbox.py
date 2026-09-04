"""What the lab's execution boundary must hold.

These are not tests of a feature; they are tests of a promise. The lab runs code
somebody typed, in a service that holds ``DATABASE_URL``, and each case below is
a way that promise could quietly stop being true.
"""

from __future__ import annotations

import os

from app.lab.sandbox import run_cell

ROWS = [
    {"installation": "A", "capacite": 30, "occupees": 28},
    {"installation": "B", "capacite": 16, "occupees": 4},
    {"installation": "C", "capacite": 54, "occupees": 51},
]


def test_a_cell_sees_its_data_as_a_dataframe() -> None:
    out = run_cell("result = int(df['capacite'].sum())", ROWS)
    assert out.ok, out.stderr
    assert out.result == 100


def test_print_comes_back() -> None:
    # The output pane is most of what makes a cell usable.
    out = run_cell("print('lignes', len(df))", ROWS)
    assert "lignes 3" in out.stdout


def test_scikit_learn_is_importable() -> None:
    out = run_cell(
        "from sklearn.linear_model import LinearRegression\n"
        "m = LinearRegression().fit(df[['capacite']], df['occupees'])\n"
        "result = round(float(m.coef_[0]), 3)",
        ROWS,
    )
    assert out.ok, out.stderr
    assert isinstance(out.result, float)


def test_a_dataframe_result_comes_back_as_rows() -> None:
    out = run_cell("result = df[df['occupees'] > 10]", ROWS)
    assert out.ok, out.stderr
    assert out.result["columns"] == ["installation", "capacite", "occupees"]
    assert len(out.result["rows"]) == 2


# --------------------------------------------------------------------- danger


def test_the_database_url_is_not_reachable() -> None:
    """The finding this whole module exists to prevent."""
    os.environ["DATABASE_URL"] = "postgres://someone:secret@host/db"
    try:
        out = run_cell("import os\nresult = os.environ.get('DATABASE_URL')", ROWS)
        assert out.ok, out.stderr
        assert out.result is None
    finally:
        os.environ.pop("DATABASE_URL", None)


def test_no_inherited_environment_at_all() -> None:
    # A filtered copy would pass the test above and still leak the next secret
    # somebody adds. The child's environment is rebuilt, not filtered.
    os.environ["OBSCYRO_TEST_SECRET"] = "should-not-be-visible"
    try:
        out = run_cell("import os\nresult = os.environ.get('OBSCYRO_TEST_SECRET')", ROWS)
        assert out.result is None
    finally:
        os.environ.pop("OBSCYRO_TEST_SECRET", None)


def test_a_cell_can_import_anything_and_that_is_written_down() -> None:
    """The security model, asserted rather than assumed.

    An earlier version filtered imports. It could not work: importing pandas
    alone already loads ``subprocess`` and ``urllib`` into ``sys.modules``, so
    any filter permissive enough to run the lab could be stepped over in one
    line. This test exists so nobody re-adds that filter believing it contains
    something — the containment is the absent credentials, not the import list.
    """
    out = run_cell("import subprocess, socket\nresult = 'imported'", ROWS)
    assert out.ok, out.stderr
    assert out.result == "imported"


def test_the_working_directory_is_private_and_temporary() -> None:
    out = run_cell("import os\nresult = sorted(os.listdir('.'))", ROWS)
    assert out.ok, out.stderr
    # Only what the parent put there. None of the application's own files.
    assert set(out.result) <= {"_run.py", "_in.json", "_out.json"}


def test_a_runaway_loop_is_stopped() -> None:
    out = run_cell("while True:\n    pass", ROWS, timeout_s=2)
    assert out.timed_out
    assert not out.ok


def test_an_error_is_reported_rather_than_swallowed() -> None:
    out = run_cell("result = 1 / 0", ROWS)
    assert not out.ok
    assert "ZeroDivisionError" in out.stderr


def test_the_service_process_survives_a_crashing_cell() -> None:
    run_cell("raise SystemExit(3)", ROWS)
    # Reaching this line at all is the assertion: the cell exited, we did not.
    assert run_cell("result = 2 + 2", ROWS).result == 4


def test_a_result_that_cannot_be_serialised_says_so() -> None:
    out = run_cell("result = lambda x: x", ROWS)
    assert out.ok
    assert "not serialisable" in out.result["note"]
