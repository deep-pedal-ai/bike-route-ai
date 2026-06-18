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

from freewheel_corpus import region_profile
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


_CAFE_WITH_WIKIDATA = {
    "type": "node",
    "id": 222,
    "lat": 40.7805,
    "lon": -73.965,
    "tags": {"amenity": "cafe", "name": "Wiki Café", "wikidata": "Q123"},
}


class FailingOverpass:
    def query(self, _ql: str, **_kw) -> dict:
        raise RuntimeError("overpass timeout")


def _failing_image_transport(_url: str) -> dict:
    raise RuntimeError("wikimedia unreachable")


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


def test_p6_survives_wikimedia_failure_storing_icon_only_poi(clean_db):
    """A Wikimedia outage during image resolution must NOT abort the route — the
    POI is still stored (icon-only, image_url NULL), not lost or logged as error."""
    _migrate(clean_db)
    _seed_route(clean_db)

    stats = p6.run_p6(
        clean_db,
        overpass_client=FakeOverpass([_CAFE_WITH_WIKIDATA]),
        image_transport=_failing_image_transport,
        now=lambda: _FIXED_NOW,
    )

    assert stats.routes_with_pois == 1
    assert stats.errors == 0
    with clean_db.cursor() as cur:
        cur.execute("SELECT name, image_url FROM pois WHERE wikidata_id = 'Q123'")
        row = cur.fetchone()
    assert row == ("Wiki Café", None)  # image hop failed -> icon-only, route kept


def test_p6_progress_callback_fires_once_per_route(clean_db):
    """The optional progress hook is called once per route with the outcome —
    the basis for live console logging and the ingest_log frontend."""
    _migrate(clean_db)
    _seed_route(clean_db)

    events: list[dict] = []
    p6.run_p6(
        clean_db,
        overpass_client=FakeOverpass([_CAFE_ELEMENT]),
        now=lambda: _FIXED_NOW,
        progress=events.append,
    )

    assert len(events) == 1  # one seeded route
    e = events[0]
    assert e["event"] == "success"
    assert e["i"] == 1 and e["total"] == 1
    assert e["selected"] == 1


# A Seattle route + a café ~140 m off it. At Seattle's UTM 10N the café is inside
# the 150 m stop radius; under NY's default UTM 18N the same distance reads ~161 m
# and would be dropped. So a green result proves run_p6 threads the region's CRS.
_SEATTLE_ROUTE_WKT = "LINESTRING(-122.305 47.670, -122.295 47.670)"
_SEATTLE_CAFE = {
    "type": "node",
    "id": 9001,
    "lat": 47.670 + 140 / 111_320,
    "lon": -122.300,
    "tags": {"amenity": "cafe", "name": "Ballard Coffee"},
}


def _seed_seattle_route(conn) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO routes (region, source, source_id, geom) "
            "VALUES ('seattle', 'test', 'sea-1', ST_GeomFromText(%s, 4326)) RETURNING id",
            (_SEATTLE_ROUTE_WKT,),
        )
        route_id = cur.fetchone()[0]
    conn.commit()
    return route_id


def test_p6_seattle_route_enriched_with_seattle_crs(clean_db):
    """End-to-end region wiring: a Seattle run scopes to region='seattle' AND uses
    UTM 10N, so a café 140 m off the line is kept (it would be dropped under the
    NY-default zone)."""
    _migrate(clean_db)
    route_id = _seed_seattle_route(clean_db)

    stats = p6.run_p6(
        clean_db,
        overpass_client=FakeOverpass([_SEATTLE_CAFE]),
        now=lambda: _FIXED_NOW,
        profile=region_profile.SEATTLE,
    )

    assert stats.routes_scanned == 1
    assert stats.routes_with_pois == 1
    with clean_db.cursor() as cur:
        cur.execute(
            "SELECT p.name FROM route_pois rp JOIN pois p ON p.id = rp.poi_id "
            "WHERE rp.route_id = %s",
            (route_id,),
        )
        assert cur.fetchone() == ("Ballard Coffee",)


def test_p6_default_ny_run_skips_a_seattle_route(clean_db):
    """The region filter: a default (NY) run does not touch a region='seattle' row."""
    _migrate(clean_db)
    _seed_seattle_route(clean_db)

    stats = p6.run_p6(
        clean_db,
        overpass_client=FakeOverpass([_SEATTLE_CAFE]),
        now=lambda: _FIXED_NOW,
    )

    assert stats.routes_scanned == 0
    assert stats.routes_with_pois == 0


def test_freshness_window_uses_config_days():
    """Sanity: the config the CLI passes carries a positive freshness window."""
    assert DEFAULT_CONFIG.freshness_days > 0
