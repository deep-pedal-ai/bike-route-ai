"""TDD (WP5 behavior 1): the orchestrated final Phase-3 pass — score THEN dedup.

The run order is ``migrate → phase1 → phase2 → phase3 → phase4 → phase3``; the
FINAL ``phase3`` both (a) scores the canon/generated rows that were ingested in
Phase 4 (they arrive with NULL ``quality_score``) AND (b) runs the **full-table
cross-source dedup pass** (ADR-0003), which hard-deletes the lower-precedence
twin of each overlapping pair and logs ``skipped_duplicate``.

The pure dedup application (:func:`p4.apply_dedup_pass`) and the precedence
ladder are already tested in ``test_p4_dedup_db.py``. Here we test the WP5
WIRING: :func:`p3.run_final_pass` is the single callable the CLI ``phase3``
invokes, and it must leave every survivor scored, remove the loser, and be safe
to re-run (idempotent — the documented sequence re-runs ``phase3``).

DB-backed (TEST_DATABASE_URL via ``clean_db``); skips cleanly when unset.
"""

from __future__ import annotations

from freewheel_corpus import migrations
from freewheel_corpus.phases import p3_quality_scoring as p3

# A canon route and an overlapping osm_relation twin (tiny lat offset → > 80%
# overlap). Both ≥ a few km, inside metro bounds. The canon row is inserted
# UNSCORED (quality_score NULL) — exactly the live WP5 starting state.
_CANON_LINE = "LINESTRING(-73.980 40.770, -73.960 40.770, -73.940 40.770)"
_OSM_LINE = "LINESTRING(-73.980 40.7701, -73.960 40.7701, -73.940 40.7701)"
# A disjoint osm route far away — must survive and be scored, never deduped.
_FAR_LINE = "LINESTRING(-73.900 40.700, -73.880 40.700, -73.860 40.700)"

# A tiny synthetic coverage box NOT covering these lines, so scoring runs without
# any facility_segments present (the scorer must still produce a non-null score
# from source_prior + the neutral surface default).
_COVERAGE = {
    "type": "Polygon",
    "coordinates": [[[-74.05, 40.60], [-73.70, 40.60], [-73.70, 40.95],
                     [-74.05, 40.95], [-74.05, 40.60]]],
}


def _migrate(conn):
    migrations.run_migrations(conn)
    conn.commit()


def _insert(conn, *, source, source_id, wkt, scored):
    """Insert a route. ``scored=False`` leaves quality_score NULL (canon's state)."""
    quality = 0.5 if scored else None
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO routes (source, source_id, name, geom, distance_km,
                                match_quality, quality_score, attribution)
            VALUES (%s, %s, %s, ST_GeomFromText(%s, 4326), 5.0, 1.0, %s, 'test')
            RETURNING id
            """,
            (source, source_id, f"{source}:{source_id}", wkt, quality),
        )
        rid = cur.fetchone()[0]
    conn.commit()
    return rid


def _rows(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT id, source, quality_score FROM routes ORDER BY id")
        return cur.fetchall()


def _dup_logs(conn):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT details FROM ingest_log WHERE event_type='skipped_duplicate'"
        )
        return [r[0] for r in cur.fetchall()]


def test_final_pass_scores_then_dedups(clean_db):
    """behavior 1: the final phase3 SCORES the unscored canon row AND hard-deletes
    the overlapping osm_relation twin (canon wins the ladder), logging both IDs.

    Survivors are all scored; the loser is gone."""
    _migrate(clean_db)
    canon_id = _insert(clean_db, source="canon", source_id="cp",
                       wkt=_CANON_LINE, scored=False)  # UNSCORED, like live WP5
    osm_id = _insert(clean_db, source="osm_relation", source_id="99",
                     wkt=_OSM_LINE, scored=True)
    far_id = _insert(clean_db, source="osm_relation", source_id="far",
                     wkt=_FAR_LINE, scored=True)

    stats = p3.run_final_pass(clean_db, coverage_geojson=_COVERAGE)

    rows = _rows(clean_db)
    surviving_ids = {r[0] for r in rows}
    # osm twin hard-deleted; canon + far survive.
    assert surviving_ids == {canon_id, far_id}
    # EVERY survivor is scored (the canon NULL is now filled).
    assert all(r[2] is not None for r in rows), rows

    logs = _dup_logs(clean_db)
    assert len(logs) == 1
    assert logs[0]["kept_id"] == canon_id
    assert logs[0]["deleted_id"] == osm_id
    assert logs[0]["kept_source"] == "canon"
    assert logs[0]["deleted_source"] == "osm_relation"

    # The stats struct reports what happened.
    assert stats.scored >= 2  # canon + far (osm deleted before/after scoring)
    assert stats.deduped == 1


def test_final_pass_is_idempotent(clean_db):
    """The documented run order re-runs phase3; a second final pass must remove 0
    more rows and leave scores stable (safe to re-run)."""
    _migrate(clean_db)
    _insert(clean_db, source="canon", source_id="cp", wkt=_CANON_LINE, scored=False)
    _insert(clean_db, source="osm_relation", source_id="99", wkt=_OSM_LINE, scored=True)

    first = p3.run_final_pass(clean_db, coverage_geojson=_COVERAGE)
    rows_after_first = _rows(clean_db)

    second = p3.run_final_pass(clean_db, coverage_geojson=_COVERAGE)
    rows_after_second = _rows(clean_db)

    assert first.deduped == 1
    assert second.deduped == 0  # nothing left to remove
    # Same surviving rows + same scores after the re-run.
    assert rows_after_first == rows_after_second
