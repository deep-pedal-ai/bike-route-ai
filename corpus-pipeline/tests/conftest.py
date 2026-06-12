"""Shared pytest fixtures for the corpus-pipeline test suite.

DB-backed tests run against TEST_DATABASE_URL (the isolated Neon `test` branch),
never DATABASE_URL (the real corpus). They are self-cleaning: the fixture drops
every object the migration creates before yielding, so the tests are repeatable.
PostGIS itself is left intact (it pre-exists on the Neon branch).
"""

from __future__ import annotations

import os
from pathlib import Path

import psycopg
import pytest
from dotenv import load_dotenv

# Self-load corpus-pipeline/.env so DB-backed tests run regardless of how pytest
# is invoked (bare `uv run pytest` does NOT auto-load .env). override=False means
# an already-exported var still wins, so this is safe both ways. No test connects
# to DATABASE_URL (the real corpus) — only TEST_DATABASE_URL via the clean_db
# fixture — so loading it into the env here is harmless.
load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)

# Objects created by migration 001 (+ the runner's bookkeeping table). Dropped
# before each DB-backed test so runs are repeatable. Order: tables first, then
# the migrations ledger. CASCADE handles indexes/constraints.
_MIGRATION_OBJECTS = (
    "DROP TABLE IF EXISTS facility_segments CASCADE",
    "DROP TABLE IF EXISTS ingest_log CASCADE",
    "DROP TABLE IF EXISTS routes CASCADE",
    "DROP TABLE IF EXISTS schema_migrations CASCADE",
)


def _test_database_url() -> str | None:
    return os.environ.get("TEST_DATABASE_URL")


@pytest.fixture()
def test_db_url() -> str:
    """The isolated test-branch URL, or skip cleanly if it is unset."""
    url = _test_database_url()
    if not url:
        pytest.skip(
            "TEST_DATABASE_URL is unset; skipping DB-backed test "
            "(set it to the isolated Neon `test` branch to run this)."
        )
    return url


@pytest.fixture()
def clean_db(test_db_url: str):
    """Yield a fresh-state connection: drop migration objects before and after.

    Leaves the postgis extension alone.
    """
    def _reset() -> None:
        with psycopg.connect(test_db_url, autocommit=True) as conn:
            with conn.cursor() as cur:
                for stmt in _MIGRATION_OBJECTS:
                    cur.execute(stmt)

    _reset()
    try:
        with psycopg.connect(test_db_url) as conn:
            yield conn
    finally:
        _reset()
