"""Shared geometry helpers for the corpus pipeline (WP1; reused by WP2/3/4).

All metric thresholds are measured in **projected EPSG:32618 metres** (ADR-0002);
stored geometry stays in EPSG:4326. Inputs and outputs are shapely geometries in
``(lon, lat)`` order (GeoJSON / shapely convention) unless noted.

Public API
----------
- :func:`assemble_relation` — order/reverse OSM member ways into one continuous
  ``LineString``; on a gap > 50 m keep the longest projected component and
  surface the dropped remainder.
- :func:`project_to_utm` / :func:`project_to_wgs84` — forward/inverse transforms
  between EPSG:4326 (lon/lat) and EPSG:32618 (metres).
- :func:`resample_line` — densify a line to ~one point per N metres (WP2 feeds
  this to Valhalla map-matching).
- :func:`line_length_km` — length of a line in km, projected to EPSG:32618.
- :func:`is_loop` — True when a line's endpoints are < 200 m apart (projected).
- :func:`routes_overlap` — pure, DB-free dedup overlap predicate.
- :data:`MIN_ROUTE_LENGTH_KM`, :data:`GAP_THRESHOLD_M`, :data:`LOOP_THRESHOLD_M`,
  :data:`DEDUP_BUFFER_M`, :data:`DEDUP_OVERLAP_FRACTION`,
  :data:`DEDUP_SIMPLIFY_M` — the tunable thresholds, exported so callers and
  tests reference one source of truth.

Limitation (v1, documented for downstream WPs — WP2/3/4 inherit this):
:func:`assemble_relation` keeps the **single longest connected component** that
``shapely.ops.linemerge`` produces and DROPS the rest (the caller logs them). It
does **NOT** bridge sub-threshold gaps. This is the locked v1 decision
("we accept that lossiness for v1", DECISIONS.md minor flags). In practice most
dropped pieces are degree-≥3 spurs/connectors that ``linemerge`` correctly
refuses to fold into one line (a ``LineString`` cannot branch) and which MUST be
dropped; a minority are genuine sub-50 m endpoint gaps whose continuation is
lost. :data:`GAP_THRESHOLD_M` is a **log classifier only** (it labels a dropped
piece "small" vs "large" gap for the audit trail) — it does not gate assembly.
Native sources therefore always yield a single ``LineString``, never a
``MultiLineString`` (the ``routes.geom`` column is ``LineString``).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache

from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString, Point
from shapely.geometry.base import BaseGeometry
from shapely.ops import linemerge, transform

# --- Thresholds (projected metres / km) ------------------------------------
STORAGE_SRID = 4326
PROJECTED_CRS = "EPSG:32618"  # UTM 18N, metres (ADR-0002)

MIN_ROUTE_LENGTH_KM = 3.0  # assembled routes shorter than this are rejected
# Log classifier ONLY: a dropped component whose nearest endpoint is within this
# distance of the kept line is labelled a "small" gap, otherwise "large", in the
# audit trail. It does NOT gate assembly — assembly always keeps the single
# longest connected component (see the module docstring / DECISIONS.md v1).
GAP_THRESHOLD_M = 50.0
LOOP_THRESHOLD_M = 200.0  # endpoints closer than this => the route is a loop

# Phase-3 facility proximity (WP3): a route point within this distance of a
# facility segment (projected ST_Buffer) counts as covered by that facility.
FACILITY_PROXIMITY_M = 15.0

# Dedup overlap predicate (pure, DB-free).
DEDUP_BUFFER_M = 25.0  # buffer radius around route A
DEDUP_OVERLAP_FRACTION = 0.80  # > 80% of the shorter route inside the buffer
DEDUP_SIMPLIFY_M = 5.0  # simplify tolerance before the overlap math (projected m)
# Length-ratio guard (WP5 remediation), applied by the dedup APPLICATION
# (phases.p4_canon_and_generation.apply_dedup_pass), NOT by routes_overlap:
# two routes merge only if min(len_a,len_b)/max(len_a,len_b) >= this AND they
# overlap. Stops a SHORT ride inside a LONG corridor (overlaps > 80% of its OWN
# length, ratio << 1) being treated as a duplicate of the longer, more complete
# ride. Calibrated to 0.95 (NOT the brief's hedged 0.8 default): empirically, the
# live corpus's distinct same-corridor out-and-back rides cluster at length ratio
# <=0.92 while genuine coincident duplicates measure >=0.997 — see
# settings.dedup_length_ratio_min (the authoritative configurable value the dedup
# reads) + the WP5-remediation BUILD-LOG for the per-pair evidence. ADR-0003.
DEDUP_LENGTH_RATIO_MIN = 0.95


@lru_cache(maxsize=1)
def _to_utm() -> Transformer:
    """Cached EPSG:4326 -> EPSG:32618 transformer (always_xy: lon/lat order)."""
    return Transformer.from_crs("EPSG:4326", PROJECTED_CRS, always_xy=True)


@lru_cache(maxsize=1)
def _from_utm() -> Transformer:
    """Cached EPSG:32618 -> EPSG:4326 transformer (always_xy: lon/lat order)."""
    return Transformer.from_crs(PROJECTED_CRS, "EPSG:4326", always_xy=True)


def project_to_utm(geom: BaseGeometry) -> BaseGeometry:
    """Project a lon/lat (EPSG:4326) geometry to EPSG:32618 metres."""
    return transform(_to_utm().transform, geom)


def project_to_wgs84(geom: BaseGeometry) -> BaseGeometry:
    """Inverse of :func:`project_to_utm`: EPSG:32618 metres -> lon/lat (EPSG:4326)."""
    return transform(_from_utm().transform, geom)


def resample_line(line: LineString, spacing_m: float = 50.0) -> LineString:
    """Resample a lon/lat ``LineString`` to a point roughly every ``spacing_m``.

    Used by Phase 2 (WP2) to densify a raw GPX/NYSDOT polyline before sending it
    to Valhalla ``trace_attributes`` (map-matching wants regularly spaced shape
    points, ~1 per 50 m). The resampling is done in **projected EPSG:32618
    metres** (ADR-0002) so the spacing is a true metric distance regardless of
    latitude, then the densified points are inverse-projected back to lon/lat.

    The original **start and end vertices are preserved**; interior points are
    placed at exact ``spacing_m`` intervals along the projected length, so every
    interior segment is ``spacing_m`` long and only the final remainder segment
    is shorter. A degenerate (zero-length) line is returned unchanged.
    """
    projected = project_to_utm(line)
    total = projected.length
    if total == 0:
        return line

    n_intervals = max(1, int(total // spacing_m))
    distances = [i * spacing_m for i in range(n_intervals + 1)]
    if distances[-1] < total:
        distances.append(total)  # preserve the exact end vertex

    points = [projected.interpolate(d) for d in distances]
    densified = LineString([(p.x, p.y) for p in points])
    wgs = list(project_to_wgs84(densified).coords)
    # Pin the exact original endpoints — the inverse projection round-trips with
    # sub-mm float drift, but downstream map-matching should see the true raw
    # start/end vertices, not their re-projected approximations.
    orig = list(line.coords)
    wgs[0] = orig[0]
    wgs[-1] = orig[-1]
    return LineString(wgs)


@dataclass
class AssemblyResult:
    """Outcome of assembling a relation's member ways.

    - ``line``: the longest continuous component as a ``LineString`` in EPSG:4326
      (lon/lat), or ``None`` if no usable line could be built.
    - ``length_km``: projected length of ``line`` in km (0.0 if ``line`` is None).
    - ``dropped``: components dropped because the relation split at a gap > 50 m,
      as ``LineString`` geometries (lon/lat) — the caller logs these.
    """

    line: LineString | None
    length_km: float = 0.0
    dropped: list[LineString] = field(default_factory=list)


def assemble_relation(ways: list[LineString]) -> AssemblyResult:
    """Assemble OSM member ways into one continuous ``LineString``.

    ``shapely.ops.linemerge`` reorders and reverses exactly-touching segments
    (OSM member ways share exact node coordinates), so ordered / reversed /
    unordered inputs all merge here. If the merge yields a ``MultiLineString``
    (the relation did not reduce to one line), keep the **longest projected
    component** and return the rest in ``dropped`` for the caller to log.

    No gap bridging (v1, locked — DECISIONS.md). The dropped pieces are a mix of
    spurs/connectors that genuinely cannot belong to a single LineString and a
    minority of true sub-:data:`GAP_THRESHOLD_M` endpoint gaps whose continuation
    is lost; the caller logs the count + measured gap distances for audit.
    """
    if not ways:
        return AssemblyResult(line=None)

    merged = linemerge(ways)

    if merged.is_empty:
        return AssemblyResult(line=None)

    if isinstance(merged, LineString):
        return AssemblyResult(line=merged, length_km=line_length_km(merged))

    if isinstance(merged, MultiLineString):
        # Pick the longest component by projected metres; drop the rest.
        components = sorted(
            merged.geoms, key=lambda g: project_to_utm(g).length, reverse=True
        )
        longest = components[0]
        dropped = list(components[1:])
        return AssemblyResult(
            line=longest,
            length_km=line_length_km(longest),
            dropped=dropped,
        )

    return AssemblyResult(line=None)


def line_length_km(line: LineString) -> float:
    """Length of a lon/lat ``LineString`` in km, projected to EPSG:32618."""
    return project_to_utm(line).length / 1000.0


def length_ratio(a: LineString, b: LineString) -> float:
    """Projected length ratio ``min(len_a, len_b) / max(len_a, len_b)`` in [0, 1].

    Both lines are projected to EPSG:32618 (so the ratio is a true metric ratio,
    not a degrees-distorted one). 1.0 means equal length; near 0 means one is far
    shorter than the other. The dedup application (``apply_dedup_pass``) uses this
    as a guard: a pair is a duplicate candidate only when this ratio is high (the
    two rides are similar length) AND they overlap. A zero-length (degenerate)
    line yields 0.0 (it can never be a similar-length duplicate of a real line).
    """
    la = project_to_utm(a).length
    lb = project_to_utm(b).length
    longer = max(la, lb)
    if longer == 0:
        return 0.0
    return min(la, lb) / longer


def endpoint_gap_m(component: LineString, kept: LineString) -> float:
    """Nearest distance (projected metres) from an endpoint of ``component`` to
    an endpoint of ``kept``.

    Used to classify a dropped assembly component in the audit log: a small value
    (< :data:`GAP_THRESHOLD_M`) is a genuine continuation gap, a large value is a
    disconnected piece, and a value of 0 with a degree-≥3 junction is a spur that
    ``linemerge`` correctly could not fold into a single line.
    """
    cp = project_to_utm(component)
    kp = project_to_utm(kept)
    c_ends = [Point(cp.coords[0]), Point(cp.coords[-1])]
    k_ends = [Point(kp.coords[0]), Point(kp.coords[-1])]
    return min(c.distance(k) for c in c_ends for k in k_ends)


def is_loop(line: LineString) -> bool:
    """True when the line's start and end endpoints are < 200 m apart (projected).

    Distance is measured in EPSG:32618 metres (ADR-0002), so the threshold is a
    true 200 m regardless of latitude.
    """
    projected = project_to_utm(line)
    coords = list(projected.coords)
    start, end = Point(coords[0]), Point(coords[-1])
    return start.distance(end) < LOOP_THRESHOLD_M


def routes_overlap(a: LineString, b: LineString) -> bool:
    """Pure, DB-free dedup overlap predicate (WP1; used by Phase 4 / final dedup).

    Project both lines to EPSG:32618, ``simplify`` them (tolerance
    :data:`DEDUP_SIMPLIFY_M`), buffer ``a`` by :data:`DEDUP_BUFFER_M` metres, and
    report whether the part of ``b`` inside that buffer exceeds
    :data:`DEDUP_OVERLAP_FRACTION` of the **shorter** route's length::

        intersection(buffer(a, 25 m), b).length > 0.80 * min(len(a), len(b))

    The predicate is **not symmetric** in ``a`` / ``b`` (only ``a`` is buffered),
    though using the shorter route's length as the denominator makes it close to
    symmetric for typical pairs. Callers that need a definitive answer should
    pass the longer route as ``a`` or test both orders.
    """
    pa = project_to_utm(a).simplify(DEDUP_SIMPLIFY_M)
    pb = project_to_utm(b).simplify(DEDUP_SIMPLIFY_M)

    shorter_len = min(pa.length, pb.length)
    if shorter_len == 0:
        return False

    overlap_len = pa.buffer(DEDUP_BUFFER_M).intersection(pb).length
    return overlap_len > DEDUP_OVERLAP_FRACTION * shorter_len
