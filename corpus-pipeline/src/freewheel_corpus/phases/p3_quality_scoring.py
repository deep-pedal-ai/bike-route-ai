"""Phase 3 — quality scoring (WP3). Pure scoring layer + DB-aware ``run``.

The scoring math is **pure shapely, DB-free** (mirrors
:func:`freewheel_corpus.geometry.routes_overlap`): every function here takes
shapely geometries and returns a number, so behaviors 3/4/5 unit-test with
synthetic hand-computed fixtures and TEST_DATABASE_URL unset. The DB-aware
:func:`run` loads each route's geometry and the facility/coverage geometry from
PostGIS into shapely, computes the scores here, and UPDATEs the score columns in
place — the same pure/DB split as ``matching.py`` (pure) vs ``p2_loose_gpx.py``
(DB).

All projected math is **EPSG:32618 metres** (ADR-0002).

Score definitions (v1 tunable heuristic; weights/priors from ``settings``):

- ``facility_coverage_fraction`` — fraction of the route inside the facility-data
  coverage area (the NYC 5-borough polygon, ``config/nyc_coverage.geojson``).
- ``protected_lane_fraction`` — fraction of the **in-coverage** route length
  within :data:`~freewheel_corpus.geometry.FACILITY_PROXIMITY_M` (15 m) of a
  ``protected`` OR ``greenway`` facility. Normalizing by the in-coverage length
  (not the full route) is the whole point of the mandated coverage test: the
  Rockland half of a Nyack ride, where we have no facility data, must not dilute
  the Manhattan half's protection. A route fully OUT of coverage scores 0.0.
- ``greenway_fraction`` — same, greenway only.
- ``quality_score`` = ``0.4*protected + 0.2*greenway + 0.2*surface_quality +
  0.2*source_prior``. ``source_prior``: canon/osm_relation 1.0, nysdot/usbrs 0.9,
  generated 0.5. ``surface_quality`` derived from ``surface_breakdown``; a NULL
  breakdown (native osm_relation rows) uses a documented neutral default (0.5).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import psycopg
from shapely import wkb
from shapely.geometry import LineString, MultiLineString, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from freewheel_corpus import geometry
from freewheel_corpus.config.settings import Settings

PHASE = "phase3"

# The NYC DOT facility-data coverage polygon (5 boroughs, water-included), unioned
# + saved as a config artifact (see BUILD-LOG; source = NYC Open Data wh2p-dxnf).
_COVERAGE_PATH = (
    Path(__file__).resolve().parents[1] / "config" / "nyc_coverage.geojson"
)

# Surface-quality scores per Valhalla/OSM surface value (v1 tunable heuristic).
# A route's surface_quality is the breakdown-weighted average of these. Smooth
# paved surfaces score high; loose/unpaved surfaces score low. Unlisted values
# fall back to the neutral default (settings.surface_quality_default).
_SURFACE_SCORES = {
    "paved": 1.0,
    "asphalt": 1.0,
    "concrete": 0.95,
    "paved_smooth": 1.0,
    "compacted": 0.6,
    "gravel": 0.4,
    "fine_gravel": 0.5,
    "dirt": 0.3,
    "ground": 0.3,
    "unpaved": 0.3,
    "grass": 0.2,
    "sand": 0.1,
    "cobblestone": 0.4,
    "path": 0.6,
    "unknown": 0.5,
}

# Facility classes whose union counts as "protected" for protected_lane_fraction.
PROTECTED_CLASSES = ("protected", "greenway")
GREENWAY_CLASSES = ("greenway",)


# --- Pure facility-proximity fractions --------------------------------------

def facility_fraction(route: LineString, facility: BaseGeometry | None) -> float:
    """Fraction of ``route`` length within 15 m of ``facility`` (projected).

    Both geometries are projected to EPSG:32618; the facility is buffered by
    :data:`~freewheel_corpus.geometry.FACILITY_PROXIMITY_M` metres and intersected
    with the route. Returns ``length(route ∩ buffer) / length(route)`` in [0, 1].
    A ``None`` / empty facility (no segments of that class) yields 0.0.
    """
    if facility is None or facility.is_empty:
        return 0.0
    proute = geometry.project_to_utm(route)
    total = proute.length
    if total == 0:
        return 0.0
    pfac = geometry.project_to_utm(facility)
    covered = pfac.buffer(geometry.FACILITY_PROXIMITY_M).intersection(proute).length
    return min(covered / total, 1.0)


def _union_of_classes(
    by_class: dict[str, BaseGeometry], classes: tuple[str, ...]
) -> BaseGeometry | None:
    """Union the facility geometries for the given classes (None if none present)."""
    parts = [by_class[c] for c in classes if by_class.get(c) is not None and not by_class[c].is_empty]
    if not parts:
        return None
    merged: BaseGeometry = parts[0]
    for p in parts[1:]:
        merged = merged.union(p)
    return merged


def protected_lane_fraction(
    route: LineString, by_class: dict[str, BaseGeometry]
) -> float:
    """Fraction of ``route`` within 15 m of a ``protected`` OR ``greenway`` segment.

    ``by_class`` maps a normalized facility class to a (Multi)LineString of all
    that class's segments near the route. Greenways count here (and again in
    :func:`greenway_fraction`) — intended per the weighted formula.
    """
    return facility_fraction(route, _union_of_classes(by_class, PROTECTED_CLASSES))


def greenway_fraction(route: LineString, by_class: dict[str, BaseGeometry]) -> float:
    """Fraction of ``route`` within 15 m of a ``greenway`` segment (greenway only)."""
    return facility_fraction(route, _union_of_classes(by_class, GREENWAY_CLASSES))


# --- Coverage-area normalization --------------------------------------------

def _in_coverage(route: LineString, coverage: BaseGeometry) -> BaseGeometry:
    """The part of ``route`` inside ``coverage`` (projected), possibly multi/empty."""
    proute = geometry.project_to_utm(route)
    pcov = geometry.project_to_utm(coverage)
    return proute.intersection(pcov)


def facility_coverage_fraction(route: LineString, coverage: BaseGeometry) -> float:
    """Fraction of ``route`` length that lies inside the facility-data ``coverage``.

    ``coverage`` is the NYC 5-borough polygon (``config/nyc_coverage.geojson``).
    A route fully inside → 1.0; fully outside → 0.0; straddling → the in-coverage
    fraction. This is the denominator used to normalize the facility fractions,
    so out-of-coverage portions (no NYC DOT data) don't dilute the score.
    """
    proute = geometry.project_to_utm(route)
    total = proute.length
    if total == 0:
        return 0.0
    inside = _in_coverage(route, coverage)
    return min(inside.length / total, 1.0)


def _fraction_in_coverage(
    route: LineString, facility: BaseGeometry | None, coverage: BaseGeometry
) -> float:
    """Facility fraction normalized over the IN-COVERAGE portion of the route.

    ``length((route ∩ coverage) within 15 m of facility) / length(route ∩ coverage)``.
    When the route is fully out of coverage the denominator is 0 → returns 0.0
    (the documented 0/0 → 0 convention).
    """
    inside = _in_coverage(route, coverage)
    denom = inside.length
    if denom == 0:
        return 0.0
    if facility is None or facility.is_empty:
        return 0.0
    pfac = geometry.project_to_utm(facility)
    covered = pfac.buffer(geometry.FACILITY_PROXIMITY_M).intersection(inside).length
    return min(covered / denom, 1.0)


def protected_lane_fraction_in_coverage(
    route: LineString, by_class: dict[str, BaseGeometry], coverage: BaseGeometry
) -> float:
    """``protected_lane_fraction`` normalized over the in-coverage route portion."""
    return _fraction_in_coverage(
        route, _union_of_classes(by_class, PROTECTED_CLASSES), coverage
    )


def greenway_fraction_in_coverage(
    route: LineString, by_class: dict[str, BaseGeometry], coverage: BaseGeometry
) -> float:
    """``greenway_fraction`` normalized over the in-coverage route portion."""
    return _fraction_in_coverage(
        route, _union_of_classes(by_class, GREENWAY_CLASSES), coverage
    )


# --- Source prior, surface quality, composite -------------------------------

def source_prior(source: str, settings: Settings | None = None) -> float:
    """Trust prior for a route's source (v1 heuristic; values from settings).

    canon / osm_relation → 1.0; nysdot / usbrs → 0.9; generated → 0.5; any
    unrecognized source → the configured default (0.5).
    """
    s = _pure_default_settings(settings)
    return {
        "canon": s.source_prior_canon,
        "osm_relation": s.source_prior_osm_relation,
        "nysdot": s.source_prior_nysdot,
        "usbrs": s.source_prior_usbrs,
        "generated": s.source_prior_generated,
    }.get(source, s.source_prior_default)


def surface_quality(
    surface_breakdown: dict[str, float] | None, settings: Settings | None = None
) -> float:
    """Derive a [0, 1] surface-quality score from a ``surface_breakdown``.

    ``surface_breakdown`` is ``{surface_value -> fraction}`` (Phase-2/Phase-4
    rows). The score is the fraction-weighted average of :data:`_SURFACE_SCORES`
    (unlisted values use the neutral default). A NULL/empty breakdown — native
    ``osm_relation`` rows never carry one — uses the documented neutral default
    (``settings.surface_quality_default``, 0.5). v1 tunable heuristic.
    """
    s = _pure_default_settings(settings)
    default = s.surface_quality_default
    if not surface_breakdown:
        return default
    total = sum(surface_breakdown.values())
    if total <= 0:
        return default
    score = 0.0
    for value, fraction in surface_breakdown.items():
        score += _SURFACE_SCORES.get(value, default) * fraction
    return score / total


def quality_score(
    *,
    protected_lane_fraction: float,
    greenway_fraction: float,
    surface_quality: float,
    source: str,
    settings: Settings | None = None,
) -> float:
    """Composite ``quality_score`` (v1 tunable heuristic; weights from settings).

    ``0.4*protected + 0.2*greenway + 0.2*surface_quality + 0.2*source_prior``.
    """
    s = _pure_default_settings(settings)
    return (
        s.weight_protected * protected_lane_fraction
        + s.weight_greenway * greenway_fraction
        + s.weight_surface * surface_quality
        + s.weight_source_prior * source_prior(source, s)
    )


def _pure_default_settings(settings: Settings | None) -> Settings:
    """Return settings for pure scoring helpers without requiring environment."""
    return settings or Settings(
        database_url="postgresql://unused",
        ors_api_key="unused",
        _env_file=None,
    )


# --- Coverage loader --------------------------------------------------------

def load_coverage(coverage_geojson: dict[str, Any] | None = None) -> BaseGeometry:
    """Load the NYC 5-borough coverage polygon (EPSG:4326 lon/lat) as a shape.

    Defaults to the committed ``config/nyc_coverage.geojson`` (water-included
    union of the 5 boroughs). A caller may inject a raw GeoJSON geometry/Feature
    dict (the tests pass a small synthetic box). Accepts a Feature, a
    FeatureCollection, or a bare geometry.
    """
    if coverage_geojson is None:
        coverage_geojson = json.loads(_COVERAGE_PATH.read_text())
    data = coverage_geojson
    if data.get("type") == "FeatureCollection":
        geoms = [shape(f["geometry"]) for f in data["features"]]
        return unary_union(geoms)
    if data.get("type") == "Feature":
        return shape(data["geometry"])
    return shape(data)


# --- DB-aware run -----------------------------------------------------------

@dataclass
class ScoringStats:
    """Counters returned by :func:`run`."""

    scored: int = 0
    in_coverage: int = 0  # routes with any in-coverage length
    ids: list[int] = field(default_factory=list)


@dataclass
class FinalPassStats:
    """Counters returned by :func:`run_final_pass` (score + dedup).

    - ``scored`` / ``in_coverage`` / ``ids`` — from the scoring sub-pass (so the
      canon rows ingested in Phase 4 with NULL ``quality_score`` are now filled).
    - ``deduped`` — rows hard-deleted by the full-table cross-source dedup pass.
    """

    scored: int = 0
    in_coverage: int = 0
    deduped: int = 0
    ids: list[int] = field(default_factory=list)


# Pull only the facility segments within the 15 m proximity of THIS route,
# grouped by class, as WKB — so a route never loads the whole 24k-segment table.
# ST_DWithin on geography is metres; equivalent to the projected 15 m buffer.
_FACILITIES_NEAR_SQL = """
SELECT facility_class, ST_AsBinary(ST_Collect(geom)) AS geom
FROM facility_segments
WHERE source = %(source)s
  AND ST_DWithin(geom::geography, %(route_geog)s::geography, %(radius_m)s)
GROUP BY facility_class
"""

_ROUTES_SQL = "SELECT id, source, ST_AsBinary(geom) AS geom, surface_breakdown FROM routes WHERE geom IS NOT NULL"

_UPDATE_SQL = """
UPDATE routes SET
    protected_lane_fraction    = %(protected)s,
    greenway_fraction          = %(greenway)s,
    facility_coverage_fraction = %(coverage)s,
    quality_score              = %(quality)s,
    updated_at                 = now()
WHERE id = %(id)s
"""

_LOG_SQL = """
INSERT INTO ingest_log (phase, source, event_type, route_id, source_ref, details, message)
VALUES (%(phase)s, %(source)s, %(event_type)s, %(route_id)s, %(source_ref)s,
        %(details)s::jsonb, %(message)s)
"""


def _facilities_near(
    cur: psycopg.Cursor, route_geom: LineString, *, source: str
) -> dict[str, BaseGeometry]:
    """Load the facility segments (by class) within 15 m of ``route_geom``."""
    radius = geometry.FACILITY_PROXIMITY_M
    cur.execute(
        _FACILITIES_NEAR_SQL,
        {
            "source": source,
            "route_geog": route_geom.wkb,
            "radius_m": radius,
        },
    )
    by_class: dict[str, BaseGeometry] = {}
    for facility_class, geom_wkb in cur.fetchall():
        if geom_wkb is None:
            continue
        by_class[facility_class] = wkb.loads(bytes(geom_wkb))
    return by_class


def run(
    conn: psycopg.Connection,
    *,
    coverage_geojson: dict[str, Any] | None = None,
    facility_source: str = "nyc_dot",
    settings: Settings | None = None,
) -> ScoringStats:
    """Score every route in ``routes`` in place (recompute-in-place; idempotent).

    For each route: load its geometry, find the facility segments within 15 m
    (grouped by class), load the coverage polygon, compute the coverage-normalized
    facility fractions + surface quality + the composite, and UPDATE the four
    score columns. No rows are inserted/deleted, so re-running is naturally
    idempotent and stable (behavior 6).
    """
    s = settings or Settings()
    coverage = load_coverage(coverage_geojson)
    stats = ScoringStats()

    with conn.cursor() as read_cur, conn.cursor() as work_cur:
        read_cur.execute(_ROUTES_SQL)
        for route_id, source, geom_wkb, surface_breakdown in read_cur:
            route = wkb.loads(bytes(geom_wkb))
            by_class = _facilities_near(work_cur, route, source=facility_source)

            cov = facility_coverage_fraction(route, coverage)
            prot = protected_lane_fraction_in_coverage(route, by_class, coverage)
            grn = greenway_fraction_in_coverage(route, by_class, coverage)
            surf = surface_quality(surface_breakdown, s)
            q = quality_score(
                protected_lane_fraction=prot,
                greenway_fraction=grn,
                surface_quality=surf,
                source=source,
                settings=s,
            )

            work_cur.execute(
                _UPDATE_SQL,
                {
                    "id": route_id,
                    "protected": prot,
                    "greenway": grn,
                    "coverage": cov,
                    "quality": q,
                },
            )
            stats.scored += 1
            stats.ids.append(route_id)
            if cov > 0:
                stats.in_coverage += 1

    conn.commit()
    return stats


# --- WP5: the orchestrated FINAL pass (score THEN full-table dedup) ----------

def run_final_pass(
    conn: psycopg.Connection,
    *,
    coverage_geojson: dict[str, Any] | None = None,
    facility_source: str = "nyc_dot",
    settings: Settings | None = None,
) -> FinalPassStats:
    """The orchestrated final Phase-3 pass (WP5): score every row, THEN dedup.

    The documented run order is
    ``migrate → phase1 → phase2 → phase3 → phase4 → phase3``. The FINAL
    ``phase3`` is this function. It runs in two sub-passes, in this order:

    1. **Score** — :func:`run` recomputes the four score columns for EVERY route
       in place, which fills the ``quality_score`` of the canon (and any
       generated) rows that Phase 4 ingested with NULL scores. Scoring is
       recompute-in-place, so re-running is naturally idempotent.
    2. **Cross-source dedup** — :func:`p4.apply_dedup_pass` (no ``only_sources``
       restriction, so the WHOLE table is in scope) finds overlapping pairs via
       the pure WP1 overlap predicate, applies the ADR-0003 precedence ladder
       (``canon > osm_relation > nysdot > usbrs > open_gpx > generated``),
       **hard-deletes the loser**, and logs both IDs under ``skipped_duplicate``.

    Order matters: scoring first guarantees every SURVIVING row carries a score
    (a deleted loser's score is irrelevant). Deleting an OSM twin does not change
    the surviving canon row's score (its score depends only on its own geometry +
    facilities + source prior), so no re-score after dedup is needed.

    Safe to re-run (the run order re-invokes ``phase3``): scoring is
    recompute-in-place and a second dedup pass finds no remaining duplicates, so
    it removes 0 and leaves scores stable.

    ADR refs: ADR-0003 (dedup ladder + hard-delete), ADR-0002 (EPSG:32618).
    """
    from freewheel_corpus.phases import p4_canon_and_generation as p4

    score_stats = run(
        conn,
        coverage_geojson=coverage_geojson,
        facility_source=facility_source,
        settings=settings,
    )
    # Full-table cross-source dedup: every source is a deletable candidate (no
    # only_sources restriction), so canon↔osm marquee twins are resolved here.
    deduped = p4.apply_dedup_pass(conn)

    return FinalPassStats(
        scored=score_stats.scored,
        in_coverage=score_stats.in_coverage,
        deduped=deduped,
        ids=score_stats.ids,
    )
