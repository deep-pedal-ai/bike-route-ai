"""S6 (TDD): phase p6 — select -> resolve images -> upsert pois/route_pois + log.

DB-backed (TEST_DATABASE_URL); skips cleanly when unset via the clean_db fixture.
Overpass + Wikimedia HTTP are faked, so these never touch a live external API —
only the isolated test branch. Behaviors verified: a seeded route gets its POIs
upserted and linked; a re-run within the freshness window is a no-op (idempotent);
a route with no nearby POIs logs zero_pois; an Overpass failure logs an error row
and does not abort the run.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from freewheel_corpus.phases import p6_pois as p6
from freewheel_corpus.poi.taxonomy import DEFAULT_CONFIG

# A short east-west route near Central Park (lat ~40.78), and a café ~60 m off it
# (well inside the 150 m stop radius). Coords chosen so the projected distance is
# unambiguously within radius.
_ROUTE_WKT = "LINESTRING(-73.970 40.780, -73.960 40.780)"
_CAFE_ELEMENT = {
    "type": "node",
    "id": 111,
    "lat": 40.7805,
    "lon": -73.965,
    "tags": {"amenity": "cafe", "name": "Test Café"},
}
_FIXED_NOW = datetime(2026, 6, 16, tzinfo=timezone.utc)


class FakeOverpass:
    """Replays a fixed element set for any query (no network)."""

    def __init__(self, elements: list[dict]) -> None:
        self._elements = elements

    def query(self, _ql: str, **_kw) -> dict:
        return {"elements": self._elements}


class FailingOverpass:
    def query(self, _ql: str, **_kw) -> dict:
        raise RuntimeError("overpass timeout")


def _seed_route(conn) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO routes (source, source_id, geom) "
            "VALUES ('test', 'p6-1', ST_GeomFromText(%s, 4326)) RETURNING id",
            (_ROUTE_WKT,),
        )
        route_id = cur.fetchone()[0]
    conn.commit()
    return route_id


def _migrate(conn) -> None:
    from freewheel_corpus import migrations

    migrations.run_migrations(conn)
    conn.commit()


def test_p6_populates_route_pois_for_a_seeded_route(clean_db):
    _migrate(clean_db)
    route_id = _seed_route(clean_db)

    stats = p6.run_p6(
        clean_db,
        overpass_client=FakeOverpass([_CAFE_ELEMENT]),
        now=lambda: _FIXED_NOW,
    )

    assert stats.routes_with_pois == 1
    assert stats.pois_upserted == 1

    with clean_db.cursor() as cur:
        cur.execute(
            "SELECT p.name, p.category_bucket, rp.matched_bucket "
            "FROM route_pois rp JOIN pois p ON p.id = rp.poi_id "
            "WHERE rp.route_id = %s",
            (route_id,),
        )
        rows = cur.fetchall()
    assert rows == [("Test Café", "coffee_food", "coffee_food")]


def test_p6_is_idempotent_within_freshness_window(clean_db):
    _migrate(clean_db)
    _seed_route(clean_db)
    client = FakeOverpass([_CAFE_ELEMENT])

    first = p6.run_p6(clean_db, overpass_client=client, now=lambda: _FIXED_NOW)
    assert first.routes_with_pois == 1

    # Re-run at the same time: the route's POIs are fresh -> skipped, no dupes.
    second = p6.run_p6(clean_db, overpass_client=client, now=lambda: _FIXED_NOW)
    assert second.skipped_fresh == 1
    assert second.routes_with_pois == 0
    assert second.pois_upserted == 0

    with clean_db.cursor() as cur:
        cur.execute("SELECT count(*) FROM route_pois")
        assert cur.fetchone()[0] == 1  # not duplicated


def test_p6_logs_zero_pois_for_a_route_with_no_nearby_pois(clean_db):
    _migrate(clean_db)
    route_id = _seed_route(clean_db)

    stats = p6.run_p6(
        clean_db,
        overpass_client=FakeOverpass([]),  # Overpass returns nothing nearby
        now=lambda: _FIXED_NOW,
    )

    assert stats.zero_pois == 1
    assert stats.routes_with_pois == 0
    with clean_db.cursor() as cur:
        cur.execute(
            "SELECT event_type FROM ingest_log "
            "WHERE phase = 'p6' AND route_id = %s",
            (route_id,),
        )
        assert cur.fetchone()[0] == "zero_pois"


def test_p6_logs_error_on_overpass_failure_without_crashing(clean_db):
    _migrate(clean_db)
    route_id = _seed_route(clean_db)

    stats = p6.run_p6(
        clean_db,
        overpass_client=FailingOverpass(),
        now=lambda: _FIXED_NOW,
    )

    assert stats.errors == 1
    assert stats.routes_with_pois == 0
    with clean_db.cursor() as cur:
        cur.execute(
            "SELECT event_type FROM ingest_log "
            "WHERE phase = 'p6' AND route_id = %s",
            (route_id,),
        )
        assert cur.fetchone()[0] == "error"


def test_freshness_window_uses_config_days():
    """Sanity: the config the CLI passes carries a positive freshness window."""
    assert DEFAULT_CONFIG.freshness_days > 0
