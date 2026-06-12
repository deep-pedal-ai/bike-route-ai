"""TDD (rebuilt WP0): migration runner — apply + idempotency.

DB-backed (TEST_DATABASE_URL); skips cleanly when unset via the clean_db fixture.
Verifies the two WP0 behaviors the runner owns: a fresh DB gets 001 applied and
recorded in schema_migrations; a second run is a no-op (returns []).
"""

from __future__ import annotations

from freewheel_corpus import migrations


def _table_exists(conn, name: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass(%s)", (name,))
        return cur.fetchone()[0] is not None


def test_run_migrations_applies_001_and_records_it(clean_db):
    """A fresh DB: 001 is applied, the three tables exist, and schema_migrations
    records 001_init.sql."""
    applied = migrations.run_migrations(clean_db)
    clean_db.commit()

    assert applied == ["001_init.sql"]
    assert _table_exists(clean_db, "routes")
    assert _table_exists(clean_db, "facility_segments")
    assert _table_exists(clean_db, "ingest_log")

    with clean_db.cursor() as cur:
        cur.execute("SELECT filename FROM schema_migrations ORDER BY filename")
        assert [r[0] for r in cur.fetchall()] == ["001_init.sql"]


def test_run_migrations_is_idempotent(clean_db):
    """A second run applies nothing (already-recorded migration skipped)."""
    first = migrations.run_migrations(clean_db)
    clean_db.commit()
    second = migrations.run_migrations(clean_db)
    clean_db.commit()

    assert first == ["001_init.sql"]
    assert second == []  # no pending migrations

    with clean_db.cursor() as cur:
        cur.execute("SELECT count(*) FROM schema_migrations")
        assert cur.fetchone()[0] == 1  # not duplicated
