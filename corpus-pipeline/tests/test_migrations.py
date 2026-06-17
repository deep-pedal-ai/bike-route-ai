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
    records the schema migrations."""
    applied = migrations.run_migrations(clean_db)
    clean_db.commit()

    assert applied == ["001_init.sql", "002_embeddings.sql", "003_pois.sql"]
    assert _table_exists(clean_db, "routes")
    assert _table_exists(clean_db, "facility_segments")
    assert _table_exists(clean_db, "ingest_log")

    with clean_db.cursor() as cur:
        cur.execute("SELECT filename FROM schema_migrations ORDER BY filename")
        assert [r[0] for r in cur.fetchall()] == [
            "001_init.sql",
            "002_embeddings.sql",
            "003_pois.sql",
        ]


def test_run_migrations_is_idempotent(clean_db):
    """A second run applies nothing (already-recorded migration skipped)."""
    first = migrations.run_migrations(clean_db)
    clean_db.commit()
    second = migrations.run_migrations(clean_db)
    clean_db.commit()

    assert first == ["001_init.sql", "002_embeddings.sql", "003_pois.sql"]
    assert second == []  # no pending migrations

    with clean_db.cursor() as cur:
        cur.execute("SELECT count(*) FROM schema_migrations")
        assert cur.fetchone()[0] == 3  # not duplicated


def test_migration_003_creates_poi_tables_and_constraints(clean_db):
    """S1: 003 applies — both POI tables exist with the idempotency UNIQUE key."""
    migrations.run_migrations(clean_db)
    clean_db.commit()

    assert _table_exists(clean_db, "pois")
    assert _table_exists(clean_db, "route_pois")

    # UNIQUE(osm_type, osm_id) is what makes p6 upserts idempotent.
    with clean_db.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM pg_constraint "
            "WHERE conname = 'pois_osm_key' AND contype = 'u'"
        )
        assert cur.fetchone() is not None


def test_route_pois_row_round_trips_with_fk(clean_db):
    """S1: a route_pois row round-trips, keyed to a real routes + pois FK."""
    migrations.run_migrations(clean_db)
    clean_db.commit()

    with clean_db.cursor() as cur:
        cur.execute(
            """
            INSERT INTO routes (source, source_id, geom)
            VALUES ('test', 'rp-1',
                    ST_GeomFromText('LINESTRING(-73.97 40.78, -73.96 40.79)', 4326))
            RETURNING id
            """
        )
        route_id = cur.fetchone()[0]
        cur.execute(
            """
            INSERT INTO pois (osm_type, osm_id, name, category_bucket, geom)
            VALUES ('node', 42, 'Test Cafe', 'coffee_food',
                    ST_SetSRID(ST_MakePoint(-73.965, 40.785), 4326))
            RETURNING id
            """
        )
        poi_id = cur.fetchone()[0]
        cur.execute(
            """
            INSERT INTO route_pois
                (route_id, poi_id, distance_m, matched_bucket, position_fraction)
            VALUES (%s, %s, 42.5, 'coffee_food', 0.5)
            """,
            (route_id, poi_id),
        )
        clean_db.commit()

        cur.execute(
            "SELECT distance_m, matched_bucket, position_fraction "
            "FROM route_pois WHERE route_id = %s AND poi_id = %s",
            (route_id, poi_id),
        )
        assert cur.fetchone() == (42.5, "coffee_food", 0.5)
