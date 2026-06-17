"""TDD (rebuilt WP0): migration runner — apply + idempotency.

DB-backed (TEST_DATABASE_URL); skips cleanly when unset via the clean_db fixture.
Verifies the two WP0 behaviors the runner owns: a fresh DB gets 001 applied and
recorded in schema_migrations; a second run is a no-op (returns []).
"""

from __future__ import annotations

import psycopg

from freewheel_corpus import migrations


def _table_exists(conn, name: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass(%s)", (name,))
        return cur.fetchone()[0] is not None


def test_run_migrations_applies_001_and_records_it(clean_db):
    """A fresh DB: 001 is applied, the three tables exist, and schema_migrations
    records the schema migrations."""
    applied = migrations.run_migrations(clean_db)
    clean_db.commit()

    assert applied == [
        "001_init.sql",
        "002_embeddings.sql",
        "003_pois.sql",
        "004_region.sql",
    ]
    assert _table_exists(clean_db, "routes")
    assert _table_exists(clean_db, "facility_segments")
    assert _table_exists(clean_db, "ingest_log")

    with clean_db.cursor() as cur:
        cur.execute("SELECT filename FROM schema_migrations ORDER BY filename")
        assert [r[0] for r in cur.fetchall()] == [
            "001_init.sql",
            "002_embeddings.sql",
            "003_pois.sql",
            "004_region.sql",
        ]


def test_run_migrations_is_idempotent(clean_db):
    """A second run applies nothing (already-recorded migration skipped)."""
    first = migrations.run_migrations(clean_db)
    clean_db.commit()
    second = migrations.run_migrations(clean_db)
    clean_db.commit()

    assert first == [
        "001_init.sql",
        "002_embeddings.sql",
        "003_pois.sql",
        "004_region.sql",
    ]
    assert second == []  # no pending migrations

    with clean_db.cursor() as cur:
        cur.execute("SELECT count(*) FROM schema_migrations")
        assert cur.fetchone()[0] == 4  # not duplicated


def _columns(conn, table: str) -> dict[str, str]:
    """Map of column_name -> column_default for ``table``."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT column_name, column_default "
            "FROM information_schema.columns WHERE table_name = %s",
            (table,),
        )
        return {row[0]: row[1] for row in cur.fetchall()}


def test_region_column_added_with_ny_default(clean_db):
    """004_region adds a NOT NULL region column defaulting to 'ny' on both tables,
    and an existing pre-region row backfills to 'ny' via the DEFAULT."""
    # Apply all migrations; 004_region adds the region column (003_pois is the POI
    # feature's migration and does not touch routes' region partitioning).
    migrations.run_migrations(
        clean_db, migrations_dir=migrations._MIGRATIONS_DIR
    )
    clean_db.commit()

    routes_cols = _columns(clean_db, "routes")
    facility_cols = _columns(clean_db, "facility_segments")
    assert "region" in routes_cols
    assert "region" in facility_cols
    # NOT NULL DEFAULT 'ny' — the default literal shows in information_schema.
    assert routes_cols["region"] is not None and "ny" in routes_cols["region"]
    assert facility_cols["region"] is not None and "ny" in facility_cols["region"]

    # A row inserted WITHOUT specifying region lands as 'ny' (the backfill rule).
    with clean_db.cursor() as cur:
        cur.execute(
            "INSERT INTO routes (source, source_id) VALUES (%s, %s) RETURNING region",
            ("osm_relation", "backfill-1"),
        )
        assert cur.fetchone()[0] == "ny"


def test_unique_key_is_region_source_source_id(clean_db):
    """The unique key is (region, source, source_id): the SAME (source, source_id)
    is allowed in two different regions, and a duplicate within one region is
    rejected."""
    migrations.run_migrations(clean_db)
    clean_db.commit()

    with clean_db.cursor() as cur:
        # Same (source, source_id) in two regions: allowed under the new key.
        cur.execute(
            "INSERT INTO routes (region, source, source_id) VALUES "
            "('ny', 'canon', 'central-park'), ('seattle', 'canon', 'central-park')"
        )
        clean_db.commit()

        # A duplicate within the SAME region violates the unique constraint.
        with clean_db.cursor() as dup_cur:
            try:
                dup_cur.execute(
                    "INSERT INTO routes (region, source, source_id) "
                    "VALUES ('ny', 'canon', 'central-park')"
                )
            except psycopg.errors.UniqueViolation:
                pass
            else:  # pragma: no cover - guards the assertion intent
                raise AssertionError("expected a unique-violation on the in-region dup")
        clean_db.rollback()
