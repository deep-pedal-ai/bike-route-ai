"""TDD (WP5 behavior 2): ``stats`` reports counts-by-source, score distribution,
and rejected/unmatched counts.

The CLI ``stats`` command echoes a human report; the testable surface is the pure
:func:`stats.gather_stats` struct it formats. We assert the struct contains:

- ``by_source`` — route counts per source.
- ``score_buckets`` — a quality_score histogram (rounded to 1 decimal), the
  "score distribution" the spec asks for (a min/avg/max summary is not a
  distribution).
- ``rejected`` / ``unmatched`` — counts pulled from ``ingest_log`` event types
  (the reject/skip/failed-match audit trail).

DB-backed (TEST_DATABASE_URL via ``clean_db``); skips cleanly when unset.
"""

from __future__ import annotations

from freewheel_corpus import migrations, stats

_LINE = "LINESTRING(-73.980 40.750, -73.960 40.750, -73.940 40.750)"


def _migrate(conn):
    migrations.run_migrations(conn)
    conn.commit()


def _insert(conn, *, source, source_id, quality):
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO routes (source, source_id, name, geom, distance_km,
                                match_quality, quality_score, attribution)
            VALUES (%s, %s, %s, ST_GeomFromText(%s, 4326), 5.0, 1.0, %s, 'test')
            """,
            (source, source_id, f"{source}:{source_id}", _LINE, quality),
        )
    conn.commit()


def _log_event(conn, *, source, event_type):
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ingest_log (phase, source, event_type, message)
            VALUES ('phaseX', %s, %s, 'test event')
            """,
            (source, event_type),
        )
    conn.commit()


def test_gather_stats_reports_source_score_and_rejects(clean_db):
    """behavior 2: gather_stats returns counts-by-source, a score-distribution
    histogram, and rejected/unmatched counts from ingest_log."""
    _migrate(clean_db)
    # Three sources, scores landing in distinct 0.1 buckets.
    _insert(clean_db, source="osm_relation", source_id="1", quality=0.30)
    _insert(clean_db, source="osm_relation", source_id="2", quality=0.32)  # same bucket 0.3
    _insert(clean_db, source="canon", source_id="cp", quality=0.90)
    _insert(clean_db, source="generated", source_id="g", quality=0.55)
    # ingest_log: a rejected (short) route, a skipped duplicate, a failed match.
    _log_event(clean_db, source="osm_relation", event_type="rejected_short")
    _log_event(clean_db, source="canon", event_type="skipped_duplicate")
    _log_event(clean_db, source="nysdot", event_type="failed_match")

    result = stats.gather_stats(clean_db)

    assert result.total == 4
    assert dict(result.by_source) == {
        "canon": 1,
        "generated": 1,
        "osm_relation": 2,
    }
    # Score distribution histogram (rounded to 1 decimal): two in 0.3, one each.
    buckets = dict(result.score_buckets)
    assert buckets[0.3] == 2
    assert buckets[0.9] == 1
    assert buckets[0.6] == 1  # 0.55 rounds to 0.6 (banker's-safe: round(0.55,1))

    # Rejected / unmatched counts from the audit log.
    assert result.rejected >= 1  # rejected_short + skipped_duplicate
    assert result.unmatched >= 1  # failed_match
    # Every survivor scored: scored == total here.
    assert result.scored == 4
