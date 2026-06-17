"""Phase 2 — loose GPX / polyline sources, map-matched via Valhalla (WP2).

Two ingest paths, both writing ``routes`` via the SAME map-match + upsert seam:

1. :func:`ingest_nysdot` — NYSDOT State Bike Routes pulled through
   :mod:`freewheel_corpus.clients.arcgis` (paginated GeoJSON), clipped to the
   metro polygon (``source='nysdot'``, ``source_id`` = OBJECTID).
2. :func:`ingest_gpx_dir` — every ``*.gpx`` in a directory parsed with ``gpxpy``
   (``source`` supplied by the caller: ``'usbrs'`` or ``'open_gpx'``,
   ``source_id`` = filename stem, ``:N`` suffix when a file has multiple tracks).

Each raw line is map-matched by :func:`freewheel_corpus.matching.match_route`
(DB-free), then this module applies the geom / geom_original rule and the
``ingest_log`` audit:

- ``status='matched'`` → ``geom`` = snapped, ``geom_original`` = raw, breakdowns
  stored, ``match_quality`` >= 0.85.
- ``status='failed_match'`` → ``geom`` = ``geom_original`` = raw; a
  ``failed_match`` row is logged.
- ``status='oversize'`` → the 200 km guard fired (no Valhalla call); ``geom`` =
  ``geom_original`` = raw; an ``oversize_input`` row is logged.

For every Phase-2 row ``geom_original`` is non-NULL (all sources are
map-matched). Upsert is idempotent on ``(source, source_id)``. An empty or
missing GPX directory is tolerated (PLAN §11 — an empty ``usbrs/`` is expected).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import gpxpy
import psycopg
from shapely.geometry import LineString

from freewheel_corpus import matching
from freewheel_corpus.clients.arcgis import ArcGISClient, clip_feature_to_metro
from freewheel_corpus.clients.valhalla import ValhallaClient
from freewheel_corpus.matching import TraceClient
from freewheel_corpus.metro import load_metro_boundary
from freewheel_corpus.region_profile import NY, RegionProfile

PHASE = "phase2"

NYSDOT_SOURCE = "nysdot"
USBRS_SOURCE = "usbrs"
OPEN_GPX_SOURCE = "open_gpx"

ATTRIBUTION_NYSDOT = "NYSDOT State Bike Routes; map-matched via Valhalla (OpenStreetMap, ODbL)"
ATTRIBUTION_WSDOT = "WSDOT Approved US Bike Routes; map-matched via Valhalla (OpenStreetMap, ODbL)"
ATTRIBUTION_GPX = "Manual GPX; map-matched via Valhalla (© OpenStreetMap contributors, ODbL)"

# Per-region designated-route attribution (Phase-2 ArcGIS source). NY stays the
# exact former string; Seattle gets WSDOT. Falls back to NY for any other region.
_DESIGNATED_ATTRIBUTION = {
    "ny": ATTRIBUTION_NYSDOT,
    "seattle": ATTRIBUTION_WSDOT,
}


# --- DB SQL (Phase 2 needs geom_original + breakdown columns p1 omitted) -----

_UPSERT_SQL = """
INSERT INTO routes (
    region, source, source_id, name,
    geom, geom_original, start_point, is_loop, distance_km, match_quality,
    surface_breakdown, waytype_breakdown, tags, attribution
) VALUES (
    %(region)s, %(source)s, %(source_id)s, %(name)s,
    ST_GeomFromText(%(geom_wkt)s, 4326),
    ST_GeomFromText(%(geom_original_wkt)s, 4326),
    ST_GeomFromText(%(start_wkt)s, 4326),
    %(is_loop)s, %(distance_km)s, %(match_quality)s,
    %(surface_breakdown)s::jsonb, %(waytype_breakdown)s::jsonb,
    %(tags)s::jsonb, %(attribution)s
)
ON CONFLICT (region, source, source_id) DO UPDATE SET
    name              = EXCLUDED.name,
    geom              = EXCLUDED.geom,
    geom_original     = EXCLUDED.geom_original,
    start_point       = EXCLUDED.start_point,
    is_loop           = EXCLUDED.is_loop,
    distance_km       = EXCLUDED.distance_km,
    match_quality     = EXCLUDED.match_quality,
    surface_breakdown = EXCLUDED.surface_breakdown,
    waytype_breakdown = EXCLUDED.waytype_breakdown,
    tags              = EXCLUDED.tags,
    attribution       = EXCLUDED.attribution,
    updated_at        = now()
RETURNING id
"""

_LOG_SQL = """
INSERT INTO ingest_log (phase, source, event_type, route_id, source_ref, details, message)
VALUES (%(phase)s, %(source)s, %(event_type)s, %(route_id)s, %(source_ref)s,
        %(details)s::jsonb, %(message)s)
"""


@dataclass
class IngestStats:
    """Counters returned by the Phase-2 ingest entry points."""

    stored: int = 0
    failed_match: int = 0
    oversize: int = 0
    match_error: int = 0
    skipped_no_geom: int = 0
    ids: list[int] = field(default_factory=list)


def _log(cur: psycopg.Cursor, *, source: str, event_type: str, source_ref: str,
         details: dict[str, Any], message: str, route_id: int | None = None) -> None:
    cur.execute(
        _LOG_SQL,
        {
            "phase": PHASE,
            "source": source,
            "event_type": event_type,
            "route_id": route_id,
            "source_ref": source_ref,
            "details": json.dumps(details),
            "message": message,
        },
    )


def _store_match(
    cur: psycopg.Cursor,
    *,
    source: str,
    source_id: str,
    name: str | None,
    raw: LineString,
    attribution: str,
    client: TraceClient,
    extra_tags: dict[str, Any] | None,
    stats: IngestStats,
    profile: RegionProfile = NY,
) -> None:
    """Map-match one raw line and upsert it; log failed_match / oversize.

    This is the single seam every Phase-2 source flows through, so the
    geom / geom_original rule and the audit trail are applied in exactly one
    place. The geometry-computed ``distance_km`` always reflects the stored
    ``geom`` (snapped on success, raw on failure/oversize). ``profile`` supplies
    the ``region`` value and the projected CRS for the match/length math.
    """
    from freewheel_corpus import geometry

    crs = profile.projected_crs
    result = matching.match_route(raw, client, crs=crs)

    geom = result.geom
    geom_original = result.geom_original
    start = geom.coords[0]
    tags = dict(extra_tags or {})

    params = {
        "region": profile.key,
        "source": source,
        "source_id": source_id,
        "name": name,
        "geom_wkt": geom.wkt,
        "geom_original_wkt": geom_original.wkt,
        "start_wkt": f"POINT({start[0]} {start[1]})",
        "is_loop": geometry.is_loop(geom, crs),
        "distance_km": geometry.line_length_km(geom, crs),
        "match_quality": result.match_quality,
        "surface_breakdown": json.dumps(result.surface_breakdown) if result.surface_breakdown else None,
        "waytype_breakdown": json.dumps(result.waytype_breakdown) if result.waytype_breakdown else None,
        "tags": json.dumps(tags),
        "attribution": attribution,
    }
    cur.execute(_UPSERT_SQL, params)
    route_id = cur.fetchone()[0]
    stats.stored += 1
    stats.ids.append(route_id)

    if result.status == "failed_match":
        stats.failed_match += 1
        _log(
            cur,
            source=source,
            event_type="failed_match",
            route_id=route_id,
            source_ref=source_id,
            details={
                "match_quality": round(result.match_quality, 4),
                "threshold": matching.MATCH_QUALITY_THRESHOLD,
                "input_km": round(result.input_km, 4),
                "matched_km": round(result.matched_km, 4),
            },
            message=(
                f"match_quality {result.match_quality:.3f} "
                f"< {matching.MATCH_QUALITY_THRESHOLD}; kept raw geometry"
            ),
        )
    elif result.status == "oversize":
        stats.oversize += 1
        _log(
            cur,
            source=source,
            event_type="oversize_input",
            route_id=route_id,
            source_ref=source_id,
            details={
                "input_km": round(result.input_km, 4),
                "cap_km": matching.MAX_INPUT_KM,
            },
            message=(
                f"resampled input {result.input_km:.1f} km > "
                f"{matching.MAX_INPUT_KM} km cap; skipped map-match, kept raw "
                f"(no chunk-and-stitch)"
            ),
        )
    elif result.status == "match_error":
        stats.match_error += 1
        _log(
            cur,
            source=source,
            event_type="match_error",
            route_id=route_id,
            source_ref=source_id,
            details={"error": result.error, "input_km": round(result.input_km, 4)},
            message=(
                f"Valhalla call failed ({result.error}); stored route with raw "
                f"geometry (report it and continue)"
            ),
        )


# --- NYSDOT (ArcGIS) ---------------------------------------------------------

def _designated_name(props: dict[str, Any], oid: str, key: str) -> str:
    """Name for a designated-route feature across regions (NYSDOT / WSDOT fields).

    NY's NYSDOT layer uses ``Rte_Name``/``STR_1``; WSDOT's Approved US Bike Routes
    layer (8) uses ``BikeRouteName``/``RoadName``. Falls back to a region-labelled
    ``"{label} route {oid}"``.
    """
    # NY must stay byte-identical: only NYSDOT's own fields + the NYSDOT fallback.
    if key != "seattle":
        return props.get("Rte_Name") or props.get("STR_1") or f"NYSDOT route {oid}"
    # Seattle / WSDOT Approved US Bike Routes (layer 8) fields.
    return (
        props.get("BikeRouteName")
        or props.get("RoadName")
        or props.get("Rte_Name")
        or props.get("STR_1")
        or f"WSDOT route {oid}"
    )


def ingest_nysdot(
    conn: psycopg.Connection,
    *,
    client: ArcGISClient | None = None,
    trace_client: TraceClient | None = None,
    no_cache: bool = False,
    profile: RegionProfile = NY,
) -> IngestStats:
    """Ingest designated-route ArcGIS features: paginate, clip, map-match, upsert.

    Features that do not intersect the region's clip polygon are skipped silently
    (they are not in scope). The ``Status`` field is preserved in ``tags`` for
    audit. ``profile`` supplies the region, clip boundary, projected CRS, and the
    ArcGIS layer path for the default client (NYSDOT for NY, WSDOT for Seattle).
    """
    arcgis = (
        client
        if client is not None
        else ArcGISClient(layer_path=profile.arcgis_layer_path)
    )
    valhalla = trace_client if trace_client is not None else ValhallaClient()
    boundary = load_metro_boundary(profile)

    stats = IngestStats()
    features = arcgis.fetch_all_features(no_cache=no_cache)
    with conn.cursor() as cur:
        for feature in features:
            clipped = clip_feature_to_metro(feature, boundary)
            if clipped is None:
                continue  # outside the region — skip
            props = clipped.properties
            oid = str(props.get("OBJECTID", ""))
            extra_tags = {
                # NYSDOT fields + WSDOT (layer 8) fields; absent keys are dropped.
                k: props[k]
                for k in (
                    "Status", "Rte_Type", "Surf_Type", "COUNTY", "REGION",
                    "BikeRouteName", "BikeRouteNumber", "BikeRouteType", "RoadName",
                )
                if props.get(k) is not None
            }
            _store_match(
                cur,
                source=NYSDOT_SOURCE,
                source_id=oid,
                name=_designated_name(props, oid, profile.key),
                raw=clipped.geom,
                attribution=_DESIGNATED_ATTRIBUTION.get(profile.key, ATTRIBUTION_NYSDOT),
                client=valhalla,
                extra_tags=extra_tags,
                stats=stats,
                profile=profile,
            )
    conn.commit()
    return stats


# --- GPX directory -----------------------------------------------------------

def _gpx_tracks(path: Path) -> list[tuple[str, LineString]]:
    """Parse a GPX file into ``(name, LineString)`` tracks (lon/lat order).

    Multiple tracks in one file each become a separate line; tracks with fewer
    than 2 points are skipped. The line is built from all trackpoints across the
    track's segments (lon, lat — z is dropped; elevation is a Q4 concern, NULL).
    """
    with path.open() as fh:
        gpx = gpxpy.parse(fh)

    tracks: list[tuple[str, LineString]] = []
    for track in gpx.tracks:
        coords: list[tuple[float, float]] = []
        for segment in track.segments:
            for pt in segment.points:
                coords.append((pt.longitude, pt.latitude))
        if len(coords) >= 2:
            tracks.append((track.name or path.stem, LineString(coords)))
    return tracks


def ingest_gpx_dir(
    conn: psycopg.Connection,
    directory: Path | str,
    *,
    source: str,
    client: TraceClient | None = None,
    profile: RegionProfile = NY,
) -> IngestStats:
    """Ingest every ``*.gpx`` in ``directory`` (map-matched, upserted).

    ``source_id`` is the filename stem (with ``:N`` for the Nth track when a file
    has more than one). A missing or empty directory yields zero rows and does
    NOT error (PLAN §11 — an empty ``usbrs/`` is expected in an unattended build).
    """
    valhalla = client if client is not None else ValhallaClient()
    directory = Path(directory)

    stats = IngestStats()
    if not directory.is_dir():
        conn.commit()
        return stats

    gpx_files = sorted(directory.glob("*.gpx"))
    with conn.cursor() as cur:
        for gpx_path in gpx_files:
            tracks = _gpx_tracks(gpx_path)
            if not tracks:
                stats.skipped_no_geom += 1
                _log(
                    cur,
                    source=source,
                    event_type="skipped_no_geom",
                    source_ref=gpx_path.stem,
                    details={"file": gpx_path.name},
                    message="GPX file has no track with >= 2 points; skipped",
                )
                continue
            multi = len(tracks) > 1
            for idx, (name, raw) in enumerate(tracks):
                source_id = f"{gpx_path.stem}:{idx}" if multi else gpx_path.stem
                _store_match(
                    cur,
                    source=source,
                    source_id=source_id,
                    name=name,
                    raw=raw,
                    attribution=ATTRIBUTION_GPX,
                    client=valhalla,
                    extra_tags=None,
                    stats=stats,
                    profile=profile,
                )
    conn.commit()
    return stats


# --- Phase entry point (live CLI run) ----------------------------------------

# Default GPX drop directories (relative to corpus-pipeline/ cwd).
USBRS_DIR = Path("data") / "manual" / "usbrs"
OPEN_GPX_DIR = Path("data") / "manual" / "open_gpx"


def run(
    conn: psycopg.Connection,
    *,
    arcgis_client: ArcGISClient | None = None,
    trace_client: TraceClient | None = None,
    usbrs_dir: Path | str = USBRS_DIR,
    open_gpx_dir: Path | str = OPEN_GPX_DIR,
    no_cache: bool = False,
    profile: RegionProfile = NY,
) -> dict[str, IngestStats]:
    """Run Phase 2 end-to-end: designated routes (ArcGIS) + USBRS + open GPX → ``routes``.

    Returns per-source stats. Sources are injectable so the CLI passes
    settings-configured clients and the tests pass fakes. An empty/missing GPX
    directory is tolerated (no error). ``profile`` scopes the region (default NY).
    """
    nysdot = ingest_nysdot(
        conn,
        client=arcgis_client,
        trace_client=trace_client,
        no_cache=no_cache,
        profile=profile,
    )
    usbrs = ingest_gpx_dir(
        conn, usbrs_dir, source=USBRS_SOURCE, client=trace_client, profile=profile
    )
    open_gpx = ingest_gpx_dir(
        conn, open_gpx_dir, source=OPEN_GPX_SOURCE, client=trace_client, profile=profile
    )
    return {"nysdot": nysdot, "usbrs": usbrs, "open_gpx": open_gpx}
