"""Phase 6 — POI enrichment (feature: docs/poi-enrichment-feature.md §4, §6, §8).

A pure offline batch with **zero knowledge of how queries are served**: for each
route it selects nearby POIs (S3), resolves their Wikimedia images (S4), and
upserts them into ``pois`` / ``route_pois``. The category words then ride into the
embedding the next time phase p5 runs (S5/S7) — that text-in-a-column is the only
contact with the retrieval path (feature §3).

Re-runnable and idempotent (feature §8): a route whose POIs were all refreshed
within ``cfg.freshness_days`` is skipped (no Overpass call), and the
``UNIQUE(osm_type, osm_id)`` upsert means re-fetching never duplicates a place.
Every route produces exactly one ``ingest_log`` row — ``success`` / ``zero_pois``
/ ``error`` — so a run is observable via ``SELECT … WHERE phase='p6'`` (§10).
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import psycopg
from psycopg.types.json import Json
from shapely.geometry import shape

from freewheel_corpus import migrations
from freewheel_corpus.poi.images import resolve_image
from freewheel_corpus.poi.selection import SelectedPoi, select_pois
from freewheel_corpus.poi.taxonomy import DEFAULT_CONFIG, SelectionConfig

PHASE = "p6"
SOURCE = "overpass"


@dataclass
class Phase6Stats:
    """Counters returned by :func:`run_p6`."""

    migrations_applied: list[str] = field(default_factory=list)
    routes_scanned: int = 0
    routes_with_pois: int = 0
    zero_pois: int = 0
    skipped_fresh: int = 0
    errors: int = 0
    pois_upserted: int = 0


_ROUTES_SQL = """
SELECT id, ST_AsGeoJSON(geom)
FROM routes
WHERE geom IS NOT NULL
ORDER BY id
"""

_ROUTE_FRESHNESS_SQL = """
SELECT min(p.last_refreshed_at)
FROM route_pois rp
JOIN pois p ON p.id = rp.poi_id
WHERE rp.route_id = %s
"""

_UPSERT_POI_SQL = """
INSERT INTO pois (
    osm_type, osm_id, name, category_bucket, geom, raw_osm_tags,
    wikidata_id, image_url, image_license, image_attribution, last_refreshed_at
)
VALUES (
    %(osm_type)s, %(osm_id)s, %(name)s, %(bucket)s,
    ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326),
    %(raw_osm_tags)s, %(wikidata_id)s,
    %(image_url)s, %(image_license)s, %(image_attribution)s, %(now)s
)
ON CONFLICT (osm_type, osm_id) DO UPDATE SET
    name = EXCLUDED.name,
    category_bucket = EXCLUDED.category_bucket,
    geom = EXCLUDED.geom,
    raw_osm_tags = EXCLUDED.raw_osm_tags,
    wikidata_id = EXCLUDED.wikidata_id,
    image_url = EXCLUDED.image_url,
    image_license = EXCLUDED.image_license,
    image_attribution = EXCLUDED.image_attribution,
    last_refreshed_at = EXCLUDED.last_refreshed_at
RETURNING id
"""

_UPSERT_ROUTE_POI_SQL = """
INSERT INTO route_pois (route_id, poi_id, distance_m, matched_bucket, position_fraction)
VALUES (%(route_id)s, %(poi_id)s, %(distance_m)s, %(matched_bucket)s, %(position_fraction)s)
ON CONFLICT (route_id, poi_id) DO UPDATE SET
    distance_m = EXCLUDED.distance_m,
    matched_bucket = EXCLUDED.matched_bucket,
    position_fraction = EXCLUDED.position_fraction
"""

_LOG_SQL = """
INSERT INTO ingest_log (phase, source, event_type, route_id, details, message)
VALUES (%s, %s, %s, %s, %s, %s)
"""


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def run_p6(
    conn: psycopg.Connection,
    *,
    overpass_client: Any,
    image_transport: Callable[[str], dict] | None = None,
    cfg: SelectionConfig = DEFAULT_CONFIG,
    now: Callable[[], datetime] = _utcnow,
) -> Phase6Stats:
    """Fetch + cache POIs for every route, idempotently.

    ``overpass_client`` is an :class:`OverpassClient`-like object passed straight
    to :func:`select_pois` (tests pass a fake that replays recorded fixtures).
    ``image_transport`` is the injectable Wikimedia HTTP hop for
    :func:`resolve_image` (``None`` uses the real ``httpx`` default).
    """
    migrations_applied = migrations.run_migrations(conn)
    conn.commit()  # persist DDL before the loop so a per-route rollback can't undo it
    stats = Phase6Stats(migrations_applied=migrations_applied)
    current_time = now()

    with conn.cursor() as cur:
        cur.execute(_ROUTES_SQL)
        routes = cur.fetchall()

    for route_id, geom_geojson in routes:
        stats.routes_scanned += 1

        if _route_is_fresh(conn, route_id, cfg, current_time):
            stats.skipped_fresh += 1
            continue

        try:
            route_geom = shape(json.loads(geom_geojson))
            selected = select_pois(
                route_geom, elements_or_client=overpass_client, cfg=cfg
            )
        except Exception as exc:  # noqa: BLE001 — one bad route must not abort the run
            conn.rollback()
            _log(
                conn,
                "error",
                route_id,
                {"error": type(exc).__name__},
                str(exc),
            )
            conn.commit()
            stats.errors += 1
            continue

        if not selected:
            _log(conn, "zero_pois", route_id, {"selected": 0}, None)
            conn.commit()
            stats.zero_pois += 1
            continue

        for poi in selected:
            _upsert_poi_and_link(conn, route_id, poi, image_transport, current_time)
            stats.pois_upserted += 1

        _log(conn, "success", route_id, {"selected": len(selected)}, None)
        conn.commit()
        stats.routes_with_pois += 1

    return stats


def _route_is_fresh(
    conn: psycopg.Connection,
    route_id: int,
    cfg: SelectionConfig,
    current_time: datetime,
) -> bool:
    """True if the route already has POIs all refreshed within the freshness window.

    A route with no ``route_pois`` is never fresh (it gets processed). This is the
    §8 re-runnable-batch skip: a re-run within the window does no Overpass work.
    """
    with conn.cursor() as cur:
        cur.execute(_ROUTE_FRESHNESS_SQL, (route_id,))
        row = cur.fetchone()
    oldest = row[0] if row else None
    if oldest is None:
        return False
    return oldest >= current_time - timedelta(days=cfg.freshness_days)


def _upsert_poi_and_link(
    conn: psycopg.Connection,
    route_id: int,
    poi: SelectedPoi,
    image_transport: Callable[[str], dict] | None,
    current_time: datetime,
) -> None:
    image = resolve_image(poi.wikidata_id, transport=image_transport)
    # Wikimedia requires attribution display (feature §5): only persist an image
    # when we have an attribution string for it; otherwise the POI is icon-only.
    if image is not None and image.attribution:
        image_url = image.image_url
        image_license = image.license
        image_attribution = image.attribution
    else:
        image_url = image_license = image_attribution = None

    with conn.cursor() as cur:
        cur.execute(
            _UPSERT_POI_SQL,
            {
                "osm_type": poi.osm_type,
                "osm_id": poi.osm_id,
                "name": poi.name,
                "bucket": str(poi.bucket),
                "lng": poi.lng,
                "lat": poi.lat,
                "raw_osm_tags": Json(poi.raw_osm_tags),
                "wikidata_id": poi.wikidata_id,
                "image_url": image_url,
                "image_license": image_license,
                "image_attribution": image_attribution,
                "now": current_time,
            },
        )
        poi_id = cur.fetchone()[0]
        cur.execute(
            _UPSERT_ROUTE_POI_SQL,
            {
                "route_id": route_id,
                "poi_id": poi_id,
                "distance_m": poi.distance_m,
                "matched_bucket": str(poi.bucket),
                "position_fraction": poi.position_fraction,
            },
        )


def _log(
    conn: psycopg.Connection,
    event_type: str,
    route_id: int,
    details: dict[str, Any],
    message: str | None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(_LOG_SQL, (PHASE, SOURCE, event_type, route_id, Json(details), message))
