"""TDD: Phase 4 generation quality gate (WP4 behavior 6).

DB-backed (TEST_DATABASE_URL); skips cleanly when unset. A fake ORS round-trip
client serves canned loop GeoJSON (no live ORS). Verifies the generation gate:

- a loop with ``quality_score >= 0.55`` AND distance within ±20% of its target
  AND not a duplicate is KEPT (stored as ``source='generated'``).
- a loop that fails the LENGTH band is REJECTED + logged with its target/actual.
- a loop that fails the QUALITY band is REJECTED + logged WITH its score.

The inline score reuses the Phase-3 pure scorer + the facilities-near query
against ``facility_segments`` (which exist by the time phase4 runs in the
canonical order). Rejects carry their scores in ``details`` (spec, not a bug —
``source_prior_generated`` 0.5 caps the ceiling so many loops legitimately fail).
"""

from __future__ import annotations

from freewheel_corpus import migrations
from freewheel_corpus.phases import facility_ingest as fi
from freewheel_corpus.phases import p4_canon_and_generation as p4

# A ~north-south loop near a protected facility (so it can score well).
_LOOP_COORDS = [
    [-73.980, 40.750, 5.0],
    [-73.980, 40.770, 6.0],
    [-73.978, 40.770, 6.0],
    [-73.978, 40.750, 5.0],
    [-73.980, 40.750, 5.0],
]


def _loop_fc(distance_m, *, coords=None):
    """An ORS round-trip GeoJSON with a given summary distance + surface=asphalt."""
    c = coords or _LOOP_COORDS
    n = len(c)
    return {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": c},
            "properties": {
                "summary": {"distance": distance_m, "duration": distance_m / 4},
                "ascent": 10.0, "descent": 10.0,
                "extras": {
                    "surface": {"values": [[0, n - 1, 3]],  # 3 = asphalt
                                "summary": [{"value": 3, "distance": distance_m, "amount": 100.0}]},
                },
            },
        }],
    }


class FakeRoundTrip:
    """Fake ORS client whose round_trip returns a per-(seed) canned loop."""

    def __init__(self, by_key):
        # by_key: dict[(length_m, seed)] -> feature_collection
        self._by_key = by_key
        self.calls = 0

    def round_trip(self, start, *, length_m, points=5, seed=0,
                   profile="cycling-regular", no_cache=False):
        self.calls += 1
        return self._by_key[(length_m, seed)]


def _migrate(conn):
    migrations.run_migrations(conn)
    conn.commit()


def _protected_facility_fc():
    """A protected facility tracing the WHOLE loop perimeter so the loop scores
    well (protected_lane_fraction ≈ 1.0). The loop is a rectangle; the facility
    follows all four edges."""
    return {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "geometry": {"type": "MultiLineString",
                         "coordinates": [[
                             [-73.980, 40.750], [-73.980, 40.770],
                             [-73.978, 40.770], [-73.978, 40.750],
                             [-73.980, 40.750],
                         ]]},
            "properties": {"segmentid": "1", "facilitycl": "I", "status": "Current", "boro": "1"},
        }],
    }


def _generated_rows(conn):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT source_id, quality_score, distance_km FROM routes "
            "WHERE source='generated' ORDER BY source_id"
        )
        return cur.fetchall()


def _reject_logs(conn):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT source_ref, event_type, details FROM ingest_log "
            "WHERE event_type LIKE 'generation_reject%' ORDER BY source_ref"
        )
        return cur.fetchall()


def test_generation_keeps_in_band_loop_and_logs_rejects(clean_db):
    """behavior 6: with one seed in-band (good score + length) and two out of
    band (one too short, one a fine length but we make it fail length by target),
    only the in-band loop is stored; the rejects are logged with their scores."""
    _migrate(clean_db)
    fi.ingest_facilities(clean_db, _protected_facility_fc())

    # Target 5000 m. seed 0: 5000 m (in ±20%, scores well → KEEP).
    #               seed 1: 3000 m (40% short → length REJECT).
    by_key = {
        (5000, 0): _loop_fc(5000.0),
        (5000, 1): _loop_fc(3000.0),
    }
    ors = FakeRoundTrip(by_key)

    stats = p4.generate_loops(
        clean_db,
        ors_client=ors,
        seed_points=[(-73.979, 40.760)],
        target_lengths_m=[5000],
        seeds=[0, 1],
    )

    assert stats.kept == 1
    rows = _generated_rows(clean_db)
    assert len(rows) == 1
    # The kept loop scored >= 0.55 (protected coverage + asphalt surface).
    assert rows[0][1] >= 0.55

    rejects = _reject_logs(clean_db)
    # seed 1 rejected for length; its detail carries the score + lengths.
    length_rejects = [r for r in rejects if r[1] == "generation_reject_length"]
    assert len(length_rejects) == 1
    assert "quality_score" in length_rejects[0][2]
    assert length_rejects[0][2]["target_km"] == 5.0


def test_generation_rejects_low_quality_with_logged_score(clean_db):
    """A loop with a good length but a LOW quality score (no facility coverage,
    no good surface) is rejected and the reject log carries its score."""
    _migrate(clean_db)
    # NO facilities ingested → protected/greenway fractions are 0 → low score.
    # Surface: gravel (code 10) → low surface_quality too.
    n = len(_LOOP_COORDS)
    fc = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": _LOOP_COORDS},
            "properties": {
                "summary": {"distance": 5000.0, "duration": 1200.0},
                "ascent": 10.0, "descent": 10.0,
                "extras": {"surface": {"values": [[0, n - 1, 10]],  # 10 = gravel
                                       "summary": [{"value": 10, "distance": 5000.0, "amount": 100.0}]}},
            },
        }],
    }
    ors = FakeRoundTrip({(5000, 0): fc})

    stats = p4.generate_loops(
        clean_db, ors_client=ors,
        seed_points=[(-73.979, 40.760)], target_lengths_m=[5000], seeds=[0],
    )

    assert stats.kept == 0
    assert _generated_rows(clean_db) == []
    rejects = _reject_logs(clean_db)
    qual_rejects = [r for r in rejects if r[1] == "generation_reject_quality"]
    assert len(qual_rejects) == 1
    detail = qual_rejects[0][2]
    assert detail["quality_score"] < 0.55
    assert detail["threshold"] == 0.55


def test_generation_rejects_duplicate_of_existing_route(clean_db):
    """A generated loop overlapping an EXISTING route is rejected as a duplicate
    (not stored), logged under generation_reject_duplicate."""
    _migrate(clean_db)
    fi.ingest_facilities(clean_db, _protected_facility_fc())
    # Pre-existing canon route along the same west edge as the loop.
    with clean_db.cursor() as cur:
        cur.execute(
            "INSERT INTO routes (source, source_id, name, geom, distance_km, "
            "match_quality, quality_score, attribution) VALUES "
            "('canon','existing','existing', ST_GeomFromText(%s,4326), 5.0, 1.0, 0.9, 't')",
            ("LINESTRING(-73.980 40.750, -73.980 40.770, -73.978 40.770, "
             "-73.978 40.750, -73.980 40.750)",),
        )
    clean_db.commit()

    ors = FakeRoundTrip({(5000, 0): _loop_fc(5000.0)})
    stats = p4.generate_loops(
        clean_db, ors_client=ors,
        seed_points=[(-73.979, 40.760)], target_lengths_m=[5000], seeds=[0],
    )

    assert stats.kept == 0
    rejects = _reject_logs(clean_db)
    dup_rejects = [r for r in rejects if r[1] == "generation_reject_duplicate"]
    assert len(dup_rejects) == 1
