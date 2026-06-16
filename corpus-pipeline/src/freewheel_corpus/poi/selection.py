"""S3: POI selection policy — turn raw Overpass elements into a rideable set.

This is the density fix (feature §6). From the raw OSM elements near a route we:

1. **bucket** each element via :func:`bucket_for_tags` (drop the un-whitelisted);
2. keep only those within the **per-bucket radius** (150 m stops / 400 m scenic),
   measured in projected EPSG:32618 metres (ADR-0002);
3. **rank within each bucket** by notability (``wikidata``/``name``) then by
   nearness to the line;
4. apply the **per-bucket cap** (``max_per_bucket``) — which is also what spreads
   POIs along the route (you cannot return 15 clustered cafés) — and the
   **per-route cap** (``max_per_route``).

Each kept POI carries ``distance_m`` (POI -> route line) and ``position_fraction``
(0..1 projection along the route), both computed on the projected geometry, for
the ``route_pois`` table and pin ordering.

HTTP is decoupled: callers pass either a list of raw OSM ``elements`` (tests use
recorded fixtures) or an :class:`OverpassClient`; the QL build + fetch is a thin
separate step so the selection logic is tested without the network.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from shapely.geometry import LineString, Point

from freewheel_corpus.geometry import project_to_utm
from freewheel_corpus.poi.taxonomy import (
    DEFAULT_CONFIG,
    Bucket,
    SelectionConfig,
    bucket_for_tags,
)


@dataclass(frozen=True)
class SelectedPoi:
    """One POI kept for a route, ready to upsert into ``pois``/``route_pois``."""

    osm_type: str
    osm_id: int
    name: str | None
    bucket: Bucket
    lat: float
    lng: float
    distance_m: float
    position_fraction: float
    raw_osm_tags: dict[str, Any] = field(default_factory=dict)
    wikidata_id: str | None = None


def _element_point(el: dict) -> tuple[float, float] | None:
    """Extract (lng, lat) for a node, or a way/relation ``center`` — else None.

    Way/relation POIs (historic landmarks — the image-rich bucket) come back from
    ``out center`` as ``el["center"]``; reading only node ``lat``/``lon`` would
    silently drop them.
    """
    lat = el.get("lat")
    lng = el.get("lon")
    if lat is None or lng is None:
        center = el.get("center") or {}
        lat = center.get("lat")
        lng = center.get("lon")
    if lat is None or lng is None:
        return None
    return float(lng), float(lat)


def select_pois(
    route_geom: LineString,
    *,
    elements_or_client: Any,
    cfg: SelectionConfig = DEFAULT_CONFIG,
) -> list[SelectedPoi]:
    """Select the rideable, capped set of POIs near ``route_geom`` (feature §6).

    ``elements_or_client`` is either a list of raw Overpass OSM ``elements``
    (recorded fixtures in tests) or an :class:`OverpassClient`; in the latter case
    the Overpass QL is built from the route bbox + whitelist and fetched. The
    return is ordered by ``position_fraction`` (start -> end) for pin display.
    """
    elements = _resolve_elements(route_geom, elements_or_client, cfg)

    projected_route = project_to_utm(route_geom)

    candidates = _candidates_within_radius(elements, projected_route, cfg)
    ranked_by_bucket = _rank_and_cap_per_bucket(candidates, cfg)
    kept = _cap_total(ranked_by_bucket, cfg)

    kept.sort(key=lambda p: p.position_fraction)
    return kept


def _resolve_elements(
    route_geom: LineString, elements_or_client: Any, cfg: SelectionConfig
) -> list[dict]:
    if isinstance(elements_or_client, list):
        return elements_or_client
    # Treat anything else as an OverpassClient-like object with .query(ql).
    ql = build_overpass_ql(route_geom, cfg)
    payload = elements_or_client.query(ql)
    return payload.get("elements", []) if isinstance(payload, dict) else []


@dataclass
class _Candidate:
    poi: SelectedPoi
    notable: bool  # has wikidata or name -> ranks above bare POIs


def _candidates_within_radius(
    elements: list[dict],
    projected_route: LineString,
    cfg: SelectionConfig,
) -> list[_Candidate]:
    candidates: list[_Candidate] = []
    for el in elements:
        tags = el.get("tags") or {}
        bucket = bucket_for_tags(tags)
        if bucket is None:
            continue

        point = _element_point(el)
        if point is None:
            continue
        lng, lat = point

        projected_point = project_to_utm(Point(lng, lat))
        distance_m = projected_route.distance(projected_point)
        if distance_m > cfg.radius_m[bucket]:
            continue

        position_fraction = projected_route.project(projected_point, normalized=True)
        name = tags.get("name")
        wikidata_id = tags.get("wikidata")
        poi = SelectedPoi(
            osm_type=str(el.get("type", "node")),
            osm_id=int(el.get("id", 0)),
            name=name,
            bucket=bucket,
            lat=lat,
            lng=lng,
            distance_m=distance_m,
            position_fraction=position_fraction,
            raw_osm_tags=dict(tags),
            wikidata_id=wikidata_id,
        )
        candidates.append(
            _Candidate(poi=poi, notable=bool(wikidata_id) or bool(name))
        )
    return candidates


def _rank_and_cap_per_bucket(
    candidates: list[_Candidate], cfg: SelectionConfig
) -> dict[Bucket, list[SelectedPoi]]:
    """Rank within each bucket (notable first, then nearest) and keep the top N.

    Returns the per-bucket ranked lists (already capped to ``max_per_bucket``) so
    the per-route trim can round-robin across buckets and preserve diversity.
    """
    by_bucket: dict[Bucket, list[_Candidate]] = {}
    for cand in candidates:
        by_bucket.setdefault(cand.poi.bucket, []).append(cand)

    ranked: dict[Bucket, list[SelectedPoi]] = {}
    for bucket in Bucket:  # fixed order => deterministic round-robin below
        bucket_candidates = by_bucket.get(bucket)
        if not bucket_candidates:
            continue
        bucket_candidates.sort(key=lambda c: (not c.notable, c.poi.distance_m))
        ranked[bucket] = [c.poi for c in bucket_candidates[: cfg.max_per_bucket]]
    return ranked


def _cap_total(
    ranked_by_bucket: dict[Bucket, list[SelectedPoi]], cfg: SelectionConfig
) -> list[SelectedPoi]:
    """Trim to the per-route cap by round-robin across buckets (preserves the
    bucket diversity + spread that scenic/landmark radii buy — a pure
    nearest-first trim would drop the intentionally-farther scenic/landmark POIs).
    """
    queues = {bucket: list(pois) for bucket, pois in ranked_by_bucket.items()}
    kept: list[SelectedPoi] = []
    while len(kept) < cfg.max_per_route and any(queues.values()):
        for bucket in Bucket:
            queue = queues.get(bucket)
            if queue:
                kept.append(queue.pop(0))
                if len(kept) >= cfg.max_per_route:
                    break
    return kept


def build_overpass_ql(route_geom: LineString, cfg: SelectionConfig) -> str:
    """Build a minimal Overpass QL query for the route's bounding box.

    Returns the whitelisted POI categories within the route bbox padded by the
    largest selection radius, with geometry/centers (``out center``). Selection
    then applies the per-bucket radius precisely; the bbox is just a coarse
    pre-filter so we fetch a small set.
    """
    minx, miny, maxx, maxy = route_geom.bounds
    pad_deg = max(cfg.radius_m.values()) / 111_000.0  # ~deg per metre, coarse
    bbox = f"{miny - pad_deg},{minx - pad_deg},{maxy + pad_deg},{maxx + pad_deg}"
    selectors = (
        '  node["amenity"~"^(cafe|restaurant|pub|drinking_water|toilets|'
        'bicycle_repair_station|place_of_worship)$"]({bbox});\n'
        '  node["shop"~"^(bakery|bicycle)$"]({bbox});\n'
        '  nwr["tourism"~"^(viewpoint|attraction|picnic_site)$"]({bbox});\n'
        '  nwr["natural"~"^(peak|waterfall|beach)$"]({bbox});\n'
        '  nwr["historic"]({bbox});\n'
        '  nwr["leisure"="park"]({bbox});\n'
    ).format(bbox=bbox)
    return f"[out:json][timeout:60];\n(\n{selectors});\nout center tags;"
