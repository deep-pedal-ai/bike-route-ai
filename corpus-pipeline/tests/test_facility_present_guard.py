"""TDD (WP5 remediation): the facilities-already-present guard.

The CLI ``phase3`` re-ingests the 23,807-row NYC DOT facility dataset every run.
The HTTP response is disk-cached, but the per-row INSERT of 23,807
MultiLineStrings over a remote Neon connection blocked for ~24 min on the WP5
finalize (no timeout, no fall-through) — see the WP5 BUILD-LOG entry. Scoring
only READS ``facility_segments``, so when they are already present the re-ingest
is pure wasted work. :func:`facility_ingest.has_facilities` lets the CLI skip the
re-ingest (with a clear log) and fall straight through to score-existing.

DB-backed (TEST_DATABASE_URL via ``clean_db``); skips cleanly when unset.
"""

from __future__ import annotations

from freewheel_corpus import migrations
from freewheel_corpus.phases import facility_ingest as fi


def _migrate(conn):
    migrations.run_migrations(conn)
    conn.commit()


def _one_facility_fc():
    return {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "geometry": {"type": "LineString",
                         "coordinates": [[-73.98, 40.75], [-73.96, 40.75]]},
            "properties": {"segmentid": "1", "facilitycl": "I",
                           "status": "Current", "boro": "1"},
        }],
    }


def test_has_facilities_false_on_empty_then_true_after_ingest(clean_db):
    """``has_facilities`` is False on a fresh DB and True once the NYC DOT source
    has rows — so the CLI can decide whether to skip the slow re-ingest."""
    _migrate(clean_db)
    assert fi.has_facilities(clean_db) is False

    fi.ingest_facilities(clean_db, _one_facility_fc())

    assert fi.has_facilities(clean_db) is True


def test_has_facilities_checks_the_nyc_dot_source(clean_db):
    """The guard is source-scoped: it reports presence of the ``nyc_dot`` facility
    source specifically (the source scoring reads), not just any row."""
    _migrate(clean_db)
    # A facility row from a DIFFERENT source must not satisfy the nyc_dot guard.
    with clean_db.cursor() as cur:
        cur.execute(
            "INSERT INTO facility_segments (source, facility_class, geom, attribution) "
            "VALUES ('other_src', 'lane', "
            "ST_GeomFromText('MULTILINESTRING((-73.98 40.75, -73.96 40.75))', 4326), 't')"
        )
    clean_db.commit()

    assert fi.has_facilities(clean_db) is False  # no nyc_dot rows yet

    fi.ingest_facilities(clean_db, _one_facility_fc())
    assert fi.has_facilities(clean_db) is True
