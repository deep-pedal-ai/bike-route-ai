"""TDD (WP5 behavior 3 / spec test inventory): Phase-1 integration test.

Runs Phase 1 end-to-end against a **cached/synthetic Overpass fixture** into
``TEST_DATABASE_URL`` (the isolated Neon `test` branch), exercising the SAME
ingest path the live CLI uses — ``p1.run(conn, client=..., poly=...)`` →
``parse_overpass`` → ``assemble`` → ``ingest_relations`` — and asserting the row
lands with valid geometry, ``match_quality=1.0``, the ODbL attribution, and the
``osm_way_ids`` from members. This is the mandated integration test (PLAN §3);
it **skips cleanly with a clear message when TEST_DATABASE_URL is unset** (the
``clean_db`` fixture does that) and **never spins up a container**.

The Overpass network is replaced by a tiny stub transport returning the committed
fixture, so the test is offline + deterministic. The relation in the fixture is a
two-way ``route=bicycle`` relation forming one continuous ~3.4 km line inside
metro bounds (lat 40-42 / lon -75..-73), so it assembles and clears the 3 km
minimum.
"""

from __future__ import annotations

import json
from pathlib import Path

from freewheel_corpus import migrations
from freewheel_corpus.clients.overpass import OverpassClient
from freewheel_corpus.phases import p1_osm_relations as p1

_FIXTURE = Path(__file__).parent / "fixtures" / "overpass_small.json"


def _migrate(conn):
    migrations.run_migrations(conn)
    conn.commit()


def _stub_overpass(tmp_path) -> OverpassClient:
    """An OverpassClient whose transport returns the committed fixture (no network).

    A throwaway DiskCache under ``tmp_path`` keeps the test from touching the real
    ``data/raw`` cache. The injected clock/sleep are unused (cache miss → one
    transport call, no prior request to throttle against).
    """
    from freewheel_corpus.cache import DiskCache

    payload = json.loads(_FIXTURE.read_text())
    return OverpassClient(
        cache=DiskCache(base_dir=tmp_path),
        transport=lambda ql: payload,
        sleep=lambda _s: None,
    )


def test_phase1_integration_into_test_db(clean_db, tmp_path):
    """behavior 3: phase1 from the cached Overpass fixture writes a valid route row
    into TEST_DATABASE_URL via the real ingest path."""
    _migrate(clean_db)
    client = _stub_overpass(tmp_path)

    # Pass an explicit poly so the run skips metro_poly_filter (the fixture is
    # already in-bounds; the query string is irrelevant to the stub transport).
    stats = p1.run(clean_db, client=client, poly="40.7 -74.0 40.8 -74.0 40.8 -73.9")

    assert stats.stored == 1

    with clean_db.cursor() as cur:
        cur.execute(
            "SELECT source, source_id, name, match_quality, attribution, "
            "       osm_way_ids, distance_km, ST_GeometryType(geom), "
            "       ST_IsValid(geom) "
            "FROM routes"
        )
        row = cur.fetchone()

    (source, source_id, name, mq, attribution, way_ids, dist_km, gtype, valid) = row
    assert source == "osm_relation"
    assert source_id == "900001"
    assert name == "Test Greenway"
    assert mq == 1.0
    assert attribution == "© OpenStreetMap contributors, ODbL 1.0"
    assert sorted(way_ids) == [70001, 70002]
    assert dist_km >= 3.0  # cleared the 3 km minimum
    assert gtype == "ST_LineString"
    assert valid is True


def test_phase1_integration_is_idempotent(clean_db, tmp_path):
    """A second run upserts on (source, source_id) — no duplicate row."""
    _migrate(clean_db)
    client = _stub_overpass(tmp_path)
    poly = "40.7 -74.0 40.8 -74.0 40.8 -73.9"

    p1.run(clean_db, client=client, poly=poly)
    p1.run(clean_db, client=_stub_overpass(tmp_path), poly=poly)

    with clean_db.cursor() as cur:
        cur.execute("SELECT count(*) FROM routes")
        assert cur.fetchone()[0] == 1
