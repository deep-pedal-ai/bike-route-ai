"""TDD: Phase 4 canon ingest against the DB (WP4 behavior 3 + canon store).

DB-backed (TEST_DATABASE_URL); skips cleanly when unset. Drives the canon ingest
path with a FAKE ORS client serving captured/synthetic GeoJSON, so no live ORS
call happens. Verifies:

- behavior 3: a routed distance > ±25% of ``expected_km`` → the entry is SKIPPED
  (not stored) and a ``canon_skip_distance`` row is logged. This is EXPECTED for
  DRAFT coords (PLAN §11), not an error.
- the happy path: an in-tolerance route is stored with ``source='canon'``,
  ``source_id=slug(:variant)``, ``match_quality=1.0``, the three RLE breakdowns,
  ascent/descent from the ORS output (Q4), the verbatim attribution, and the
  ``out_and_back`` flag persisted into ``tags`` (Q6b).
"""

from __future__ import annotations

import json
from pathlib import Path

from freewheel_corpus import migrations
from freewheel_corpus.phases import p4_canon_and_generation as p4

_FIXTURES = Path(__file__).resolve().parent / "fixtures"


class FakeOrs:
    """A fake ORS client returning a canned GeoJSON for any directions call."""

    def __init__(self, feature_collection):
        self._fc = feature_collection
        self.calls = 0

    def directions(self, coords, *, profile="cycling-regular", no_cache=False):
        self.calls += 1
        return self._fc


def _real_fc():
    """The real captured Central Park directions response (~4.64 km)."""
    return json.loads((_FIXTURES / "ors_directions_central_park.json").read_text())


def _migrate(conn):
    migrations.run_migrations(conn)
    conn.commit()


def _canon_entry(expected_km, *, out_and_back=False, variant_km=None):
    """A single canon entry dict (human [lat, lon]) with one variant."""
    return {
        "slug": "central-park-loop",
        "name": "Central Park Loop",
        "start": [40.76799, -73.97597],
        "waypoints": [[40.79600, -73.95800]],
        "expected_km": expected_km,
        "out_and_back": out_and_back,
        "variants": [
            {"name": "default", "expected_km": variant_km or expected_km},
        ],
    }


def _rows(conn):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT source, source_id, match_quality, ascent_m, descent_m, "
            "surface_breakdown, waytype_breakdown, steepness_breakdown, tags, "
            "attribution, distance_km FROM routes WHERE source='canon' ORDER BY source_id"
        )
        return cur.fetchall()


def _log_events(conn, event_type):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT source_ref, details FROM ingest_log WHERE event_type=%s",
            (event_type,),
        )
        return cur.fetchall()


def test_canon_distance_within_tolerance_is_stored(clean_db):
    """An entry whose expected_km matches the routed ~4.64 km is stored with all
    the canon columns populated (behavior 3 happy path)."""
    _migrate(clean_db)
    ors = FakeOrs(_real_fc())
    entry = _canon_entry(expected_km=4.6, out_and_back=False)

    stats = p4.ingest_canon(clean_db, [entry], ors_client=ors)

    assert stats.stored == 1
    rows = _rows(clean_db)
    assert len(rows) == 1
    (source, source_id, mq, ascent, descent, surf, way, steep, tags, attr, dist) = rows[0]
    assert source == "canon"
    assert source_id == "central-park-loop:default"
    assert mq == 1.0
    # Q4: ascent/descent come from the ORS output (81.7 / 70.9 in the capture).
    assert abs(ascent - 81.7) < 0.1 and abs(descent - 70.9) < 0.1
    # All three RLE breakdowns are populated and use STRING keys.
    assert surf and all(isinstance(k, str) for k in surf)
    assert way and steep
    # Q6b: out_and_back persisted into tags.
    assert tags.get("out_and_back") is False
    assert attr == p4.CANON_ATTRIBUTION
    assert abs(dist - 4.64) < 0.1


def test_canon_distance_out_of_tolerance_is_skipped_and_logged(clean_db):
    """behavior 3: the routed distance (~4.64 km) is > ±25% from a wildly-off
    expected_km (e.g. 20 km) → the entry is skipped (NOT stored) and a
    canon_skip_distance event is logged with both distances."""
    _migrate(clean_db)
    ors = FakeOrs(_real_fc())
    entry = _canon_entry(expected_km=20.0)  # 4.64 km is far outside ±25% of 20

    stats = p4.ingest_canon(clean_db, [entry], ors_client=ors)

    assert stats.stored == 0
    assert stats.skipped_distance == 1
    assert _rows(clean_db) == []  # nothing stored
    events = _log_events(clean_db, "canon_skip_distance")
    assert len(events) == 1
    source_ref, details = events[0]
    assert source_ref == "central-park-loop:default"
    assert abs(details["expected_km"] - 20.0) < 1e-6
    assert abs(details["routed_km"] - 4.64) < 0.1


def test_canon_out_and_back_persisted_true(clean_db):
    """Q6b: an out_and_back entry stores out_and_back=true in tags."""
    _migrate(clean_db)
    ors = FakeOrs(_real_fc())
    # expected_km generous enough to pass the gate for the ~4.64 km route.
    entry = _canon_entry(expected_km=4.6, out_and_back=True)

    p4.ingest_canon(clean_db, [entry], ors_client=ors)
    rows = _rows(clean_db)
    assert rows[0][8].get("out_and_back") is True  # tags column


def test_canon_upsert_is_idempotent(clean_db):
    """Re-running canon ingest upserts on (source, source_id) — no duplicate rows."""
    _migrate(clean_db)
    ors = FakeOrs(_real_fc())
    entry = _canon_entry(expected_km=4.6)

    p4.ingest_canon(clean_db, [entry], ors_client=ors)
    p4.ingest_canon(clean_db, [entry], ors_client=ors)

    with clean_db.cursor() as cur:
        cur.execute("SELECT count(*) FROM routes WHERE source='canon'")
        assert cur.fetchone()[0] == 1
