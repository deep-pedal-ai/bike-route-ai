"""TDD: Phase 4 dedup precedence + hard-delete (WP4 behavior 4).

DB-backed (TEST_DATABASE_URL); skips cleanly when unset. The pure overlap
predicate (``geometry.routes_overlap``) is already tested in WP1 — here we test
the DB-side APPLICATION: pairing overlapping routes, breaking the tie by the
ADR-0003 precedence ladder (``canon > osm_relation > nysdot > usbrs > open_gpx >
generated``), HARD-DELETING the loser, and logging both IDs under
``skipped_duplicate``.
"""

from __future__ import annotations

from freewheel_corpus import migrations
from freewheel_corpus.phases import p4_canon_and_generation as p4

# Two near-identical lines (a tiny offset) that overlap > 80% → duplicates.
_LINE_A = "LINESTRING(-73.980 40.750, -73.960 40.750, -73.940 40.750)"
_LINE_B = "LINESTRING(-73.980 40.7501, -73.960 40.7501, -73.940 40.7501)"
# A clearly disjoint line (far away) → NOT a duplicate.
_LINE_FAR = "LINESTRING(-73.900 40.700, -73.880 40.700, -73.860 40.700)"


def _migrate(conn):
    migrations.run_migrations(conn)
    conn.commit()


def _insert(conn, *, source, source_id, wkt, quality=0.5):
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO routes (source, source_id, name, geom, distance_km,
                                match_quality, quality_score, attribution)
            VALUES (%s, %s, %s, ST_GeomFromText(%s, 4326), 1.0, 1.0, %s, 'test')
            RETURNING id
            """,
            (source, source_id, f"{source}:{source_id}", wkt, quality),
        )
        rid = cur.fetchone()[0]
    conn.commit()
    return rid


def _ids(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT id, source FROM routes ORDER BY id")
        return cur.fetchall()


def _dup_logs(conn):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT details FROM ingest_log WHERE event_type='skipped_duplicate'"
        )
        return [r[0] for r in cur.fetchall()]


def test_canon_beats_osm_on_tie_loser_hard_deleted(clean_db):
    """behavior 4: a canon route and an overlapping osm_relation route → canon
    wins (higher in the ladder), the osm row is HARD-DELETED, and a
    skipped_duplicate event logs both IDs — even though osm has a HIGHER score
    (precedence is by ladder, not score; ADR-0003)."""
    _migrate(clean_db)
    canon_id = _insert(clean_db, source="canon", source_id="cp", wkt=_LINE_A,
                       quality=0.50)
    osm_id = _insert(clean_db, source="osm_relation", source_id="99", wkt=_LINE_B,
                     quality=0.90)  # deliberately higher score than canon

    removed = p4.apply_dedup_pass(clean_db)

    assert removed == 1
    surviving = _ids(clean_db)
    assert len(surviving) == 1
    assert surviving[0] == (canon_id, "canon")  # canon survived, osm deleted

    logs = _dup_logs(clean_db)
    assert len(logs) == 1
    # Both IDs recorded; the loser (osm) is the deleted one.
    assert logs[0]["kept_id"] == canon_id
    assert logs[0]["deleted_id"] == osm_id
    assert logs[0]["kept_source"] == "canon"
    assert logs[0]["deleted_source"] == "osm_relation"


def test_non_overlapping_routes_are_not_deduped(clean_db):
    """Two routes that do not overlap are both kept (no false dedup)."""
    _migrate(clean_db)
    a = _insert(clean_db, source="canon", source_id="a", wkt=_LINE_A)
    b = _insert(clean_db, source="osm_relation", source_id="b", wkt=_LINE_FAR)

    removed = p4.apply_dedup_pass(clean_db)

    assert removed == 0
    assert {r[0] for r in _ids(clean_db)} == {a, b}
    assert _dup_logs(clean_db) == []


def test_generated_loses_to_everything(clean_db):
    """A generated loop overlapping an nysdot route loses (generated is bottom of
    the ladder) and is hard-deleted."""
    _migrate(clean_db)
    nysdot_id = _insert(clean_db, source="nysdot", source_id="n", wkt=_LINE_A)
    gen_id = _insert(clean_db, source="generated", source_id="g", wkt=_LINE_B)

    removed = p4.apply_dedup_pass(clean_db)

    assert removed == 1
    surviving = _ids(clean_db)
    assert surviving == [(nysdot_id, "nysdot")]


def test_open_gpx_slots_above_generated(clean_db):
    """The ladder slots open_gpx (WP2) just above generated: an open_gpx route
    beats an overlapping generated loop."""
    _migrate(clean_db)
    gpx_id = _insert(clean_db, source="open_gpx", source_id="x", wkt=_LINE_A)
    gen_id = _insert(clean_db, source="generated", source_id="g", wkt=_LINE_B)

    removed = p4.apply_dedup_pass(clean_db)

    assert removed == 1
    assert _ids(clean_db) == [(gpx_id, "open_gpx")]
