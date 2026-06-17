"""Phase 1 — OSM ``route=bicycle`` relations into ``routes`` (WP1, AC#1).

Pipeline for each relation returned by Overpass ``out geom;``:

1. :func:`parse_overpass` — JSON payload -> :class:`ParsedRelation` list. The
   SAME function backs the synthetic unit fixtures and the real cached response,
   so unit tests exercise the integration path's structure. Member ``geometry``
   is ``[{lat, lon}, ...]`` (Overpass order) -> shapely ``(lon, lat)``.
2. :func:`assemble` — member ways -> one continuous ``LineString`` via
   :mod:`freewheel_corpus.geometry` (longest component on a > 50 m gap; the
   remainder is logged). Routes < 3 km are rejected (logged, not stored).
3. :func:`extract_tags` — ``name -> ref -> "Unnamed route {id}"`` fallback plus
   ``network``, ``operator``, ``ascent``/``descent`` (free OSM tags only — Q4
   forbids API elevation backfill, not reading a tag that is already present),
   and ``osm_way_ids`` from members. The OSM ``distance`` tag is preserved in
   ``tags`` JSONB as ``osm_distance`` and never overrides the geometry-computed
   ``distance_km``.
4. upsert on ``(source, source_id)`` with ``source='osm_relation'``,
   ``source_id`` = the OSM relation id, ``match_quality=1.0``, attribution
   ``'© OpenStreetMap contributors, ODbL 1.0'``. Gaps/rejects -> ``ingest_log``.

The Overpass query uses the metro polygon as a ``poly:`` filter built by
:func:`metro_poly_filter`. Overpass ``poly:`` is space-separated
``"lat lon lat lon ..."`` — **latitude FIRST**, the opposite of the boundary
file's GeoJSON ``[lon, lat]``. The helper asserts every emitted point lands in
metro bounds so a transposition fails loudly.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import psycopg
from shapely.geometry import LineString

from freewheel_corpus import geometry
from freewheel_corpus.clients.overpass import OverpassClient
from freewheel_corpus.metro import assert_in_metro_bounds, load_metro_boundary

PHASE = "phase1"
SOURCE = "osm_relation"
ATTRIBUTION = "© OpenStreetMap contributors, ODbL 1.0"
MATCH_QUALITY = 1.0

# Slice 1 literal: every row is NY. The RegionProfile abstraction threads this
# per-region in a later slice (see docs/multi-region-seattle-plan.md §2, §8).
REGION = "ny"


# --- Parsing ---------------------------------------------------------------

@dataclass
class ParsedRelation:
    """A parsed OSM ``route=bicycle`` relation."""

    osm_id: int
    tags: dict[str, Any]
    ways: list[LineString]  # member ways as lon/lat LineStrings, in member order
    osm_way_ids: list[int]


def parse_overpass(payload: dict[str, Any]) -> list[ParsedRelation]:
    """Parse an Overpass ``out geom;`` JSON payload into relations.

    Each way member's ``geometry`` (``[{lat, lon}, ...]``) becomes a shapely
    ``LineString`` in ``(lon, lat)`` order. Way members with fewer than 2 points
    are skipped (cannot form a line).
    """
    relations: list[ParsedRelation] = []
    for el in payload.get("elements", []):
        if el.get("type") != "relation":
            continue
        ways: list[LineString] = []
        way_ids: list[int] = []
        for member in el.get("members", []):
            if member.get("type") != "way":
                continue
            geom = member.get("geometry")
            if geom and len(geom) >= 2:
                coords = [(pt["lon"], pt["lat"]) for pt in geom]
                ways.append(LineString(coords))
            if "ref" in member:
                way_ids.append(int(member["ref"]))
        relations.append(
            ParsedRelation(
                osm_id=int(el["id"]),
                tags=el.get("tags", {}) or {},
                ways=ways,
                osm_way_ids=way_ids,
            )
        )
    return relations


# --- Tag extraction --------------------------------------------------------

def _maybe_float(value: Any) -> float | None:
    """Parse a numeric OSM tag (e.g. ascent='120'); None if absent/unparseable."""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def extract_tags(rel: ParsedRelation) -> dict[str, Any]:
    """Extract route columns from a relation's tags (name fallback chain etc.).

    Returns a dict of column-ish values: ``name``, ``network``, ``operator``,
    ``ascent_m``, ``descent_m``, ``osm_way_ids``, and a ``tags`` JSONB dict that
    carries the raw OSM ``distance`` tag as ``osm_distance`` (never promoted to
    the geometry-computed ``distance_km``).
    """
    tags = rel.tags
    name = tags.get("name") or tags.get("ref") or f"Unnamed route {rel.osm_id}"

    extra_tags: dict[str, Any] = {}
    if "distance" in tags:
        # Preserve the OSM-declared distance as raw text; distance_km is computed
        # from geometry and is authoritative.
        extra_tags["osm_distance"] = tags["distance"]

    return {
        "name": name,
        "network": tags.get("network"),
        "operator": tags.get("operator"),
        "ascent_m": _maybe_float(tags.get("ascent")),
        "descent_m": _maybe_float(tags.get("descent")),
        "osm_way_ids": rel.osm_way_ids,
        "tags": extra_tags,
    }


# --- Overpass query / poly: filter -----------------------------------------

def metro_poly_filter() -> str:
    """Build the Overpass ``poly:`` string from the metro boundary polygon.

    Overpass expects ``"lat lon lat lon ..."`` — **latitude first**. The boundary
    file is GeoJSON ``[lon, lat]``, so this is the single place the order is
    flipped. Every emitted point is asserted in metro bounds (in ``(lon, lat)``
    order) so a transposition raises rather than querying the wrong region.
    """
    boundary = load_metro_boundary()
    coords = list(boundary.exterior.coords)
    # Drop the duplicated closing vertex Overpass does not need.
    if len(coords) > 1 and coords[0] == coords[-1]:
        coords = coords[:-1]

    parts: list[str] = []
    for lon, lat in coords:
        assert_in_metro_bounds(lon, lat)  # loud failure on a transposed file
        parts.append(f"{lat} {lon}")  # latitude FIRST for Overpass
    return " ".join(parts)


def build_query(poly: str | None = None) -> str:
    """Build the Overpass QL query for ``route=bicycle`` relations in the poly."""
    poly_str = poly if poly is not None else metro_poly_filter()
    return (
        "[out:json][timeout:180];\n"
        f'relation["route"="bicycle"](poly:"{poly_str}");\n'
        "out geom;"
    )


# --- Assembly --------------------------------------------------------------

def assemble(rel: ParsedRelation) -> geometry.AssemblyResult:
    """Assemble a relation's member ways into one continuous line."""
    return geometry.assemble_relation(rel.ways)


# --- DB ingest -------------------------------------------------------------

_UPSERT_SQL = """
INSERT INTO routes (
    region, source, source_id, name,
    geom, start_point, is_loop, distance_km, match_quality,
    osm_way_ids, network, operator, ascent_m, descent_m,
    tags, attribution
) VALUES (
    %(region)s, %(source)s, %(source_id)s, %(name)s,
    ST_GeomFromText(%(geom_wkt)s, 4326),
    ST_GeomFromText(%(start_wkt)s, 4326),
    %(is_loop)s, %(distance_km)s, %(match_quality)s,
    %(osm_way_ids)s, %(network)s, %(operator)s, %(ascent_m)s, %(descent_m)s,
    %(tags)s::jsonb, %(attribution)s
)
ON CONFLICT (region, source, source_id) DO UPDATE SET
    name          = EXCLUDED.name,
    geom          = EXCLUDED.geom,
    start_point   = EXCLUDED.start_point,
    is_loop       = EXCLUDED.is_loop,
    distance_km   = EXCLUDED.distance_km,
    match_quality = EXCLUDED.match_quality,
    osm_way_ids   = EXCLUDED.osm_way_ids,
    network       = EXCLUDED.network,
    operator      = EXCLUDED.operator,
    ascent_m      = EXCLUDED.ascent_m,
    descent_m     = EXCLUDED.descent_m,
    tags          = EXCLUDED.tags,
    attribution   = EXCLUDED.attribution,
    updated_at    = now()
RETURNING id
"""

_LOG_SQL = """
INSERT INTO ingest_log (phase, source, event_type, source_ref, details, message)
VALUES (%(phase)s, %(source)s, %(event_type)s, %(source_ref)s, %(details)s::jsonb, %(message)s)
"""


@dataclass
class IngestStats:
    """Counters returned by :func:`ingest_relations`."""

    stored: int = 0
    rejected_short: int = 0
    gaps_dropped: int = 0
    empty: int = 0
    ids: list[int] = field(default_factory=list)


def _log(cur: psycopg.Cursor, *, event_type: str, source_ref: str,
         details: dict[str, Any], message: str) -> None:
    cur.execute(
        _LOG_SQL,
        {
            "phase": PHASE,
            "source": SOURCE,
            "event_type": event_type,
            "source_ref": source_ref,
            "details": json.dumps(details),
            "message": message,
        },
    )


def ingest_relations(
    conn: psycopg.Connection, relations: list[ParsedRelation]
) -> IngestStats:
    """Assemble, validate, and upsert relations; log gaps/rejects to ingest_log.

    Idempotent: upsert on ``(source, source_id)`` so a second run updates the
    existing row rather than inserting a duplicate. Returns counters.
    """
    stats = IngestStats()
    with conn.cursor() as cur:
        for rel in relations:
            source_ref = str(rel.osm_id)
            result = assemble(rel)

            if result.line is None:
                stats.empty += 1
                _log(
                    cur,
                    event_type="rejected_empty",
                    source_ref=source_ref,
                    details={"osm_id": rel.osm_id},
                    message="No assembleable geometry for relation",
                )
                continue

            if result.dropped:
                stats.gaps_dropped += 1
                dropped_km = sum(
                    geometry.line_length_km(d) for d in result.dropped
                )
                # Measure each dropped piece's nearest endpoint gap to the kept
                # line so the audit trail reflects the TRUTH: assembly keeps the
                # single longest component and drops the rest (spurs + any
                # sub-threshold continuation gaps), it does not gate on > 50 m.
                gaps = sorted(
                    geometry.endpoint_gap_m(d, result.line) for d in result.dropped
                )
                small = sum(1 for g in gaps if g < geometry.GAP_THRESHOLD_M)
                _log(
                    cur,
                    event_type="gap_dropped",
                    source_ref=source_ref,
                    details={
                        "osm_id": rel.osm_id,
                        "dropped_components": len(result.dropped),
                        "dropped_km": round(dropped_km, 4),
                        "kept_km": round(result.length_km, 4),
                        "min_endpoint_gap_m": round(gaps[0], 1),
                        "max_endpoint_gap_m": round(gaps[-1], 1),
                        # Count of dropped pieces within GAP_THRESHOLD_M (small
                        # gaps / spurs) vs larger disconnected pieces.
                        "small_gap_components": small,
                    },
                    message=(
                        f"Assembly produced {len(result.dropped) + 1} components; "
                        f"kept the longest, dropped {len(result.dropped)} "
                        f"({small} within {geometry.GAP_THRESHOLD_M} m, "
                        f"not bridged in v1)"
                    ),
                )

            if result.length_km < geometry.MIN_ROUTE_LENGTH_KM:
                stats.rejected_short += 1
                _log(
                    cur,
                    event_type="rejected_short",
                    source_ref=source_ref,
                    details={
                        "osm_id": rel.osm_id,
                        "length_km": round(result.length_km, 4),
                        "min_km": geometry.MIN_ROUTE_LENGTH_KM,
                    },
                    message=(
                        f"Assembled length {result.length_km:.3f} km "
                        f"< {geometry.MIN_ROUTE_LENGTH_KM} km; skipped"
                    ),
                )
                continue

            tag_cols = extract_tags(rel)
            line = result.line
            start = line.coords[0]
            params = {
                "region": REGION,
                "source": SOURCE,
                "source_id": source_ref,
                "name": tag_cols["name"],
                "geom_wkt": line.wkt,
                "start_wkt": f"POINT({start[0]} {start[1]})",
                "is_loop": geometry.is_loop(line),
                "distance_km": result.length_km,
                "match_quality": MATCH_QUALITY,
                "osm_way_ids": tag_cols["osm_way_ids"] or None,
                "network": tag_cols["network"],
                "operator": tag_cols["operator"],
                "ascent_m": tag_cols["ascent_m"],
                "descent_m": tag_cols["descent_m"],
                "tags": json.dumps(tag_cols["tags"]),
                "attribution": ATTRIBUTION,
            }
            cur.execute(_UPSERT_SQL, params)
            row = cur.fetchone()
            stats.stored += 1
            stats.ids.append(row[0])

    conn.commit()
    return stats


def run(
    conn: psycopg.Connection,
    *,
    client: OverpassClient | None = None,
    poly: str | None = None,
    no_cache: bool = False,
) -> IngestStats:
    """Run Phase 1 end-to-end: query Overpass (cached) -> parse -> ingest.

    ``client`` and ``poly`` are injectable so the integration test can drive the
    cached fixture through the SAME ingest path the live CLI run uses.
    """
    overpass = client if client is not None else OverpassClient()
    query = build_query(poly)
    payload = overpass.query(query, no_cache=no_cache)
    relations = parse_overpass(payload)
    return ingest_relations(conn, relations)
