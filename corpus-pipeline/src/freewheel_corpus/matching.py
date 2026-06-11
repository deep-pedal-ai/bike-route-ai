"""Phase 2 map-matching (WP2) — DB-free; returns a result the phase ingests.

:func:`match_route` takes a raw lon/lat ``LineString``, resamples it to ~50 m
spacing (:func:`freewheel_corpus.geometry.resample_line`), sends the densified
shape to Valhalla ``/trace_attributes``, and turns the response into a
:class:`MatchResult`. It writes NOTHING to the database — the phase
(:mod:`freewheel_corpus.phases.p2_loose_gpx`) owns the ``ingest_log`` rows and
the upsert. That split keeps this module a pure unit (behaviors 2-5 mock only
Valhalla + the clock).

The ``geom`` / ``geom_original`` rule (DECISIONS.md minor flags):

- success (``match_quality >= 0.85``) → ``geom`` = the snapped trace,
  ``geom_original`` = the raw input; ``status='matched'``.
- failure (``< 0.85``) → ``geom`` = ``geom_original`` = the raw input;
  ``status='failed_match'`` (the phase logs ``failed_match``).
- a resampled input longer than the 200 km Valhalla cap → the call is skipped
  entirely, ``geom`` = ``geom_original`` = raw input, ``status='oversize'`` (the
  phase logs the guard). No chunk-and-stitch (DECISIONS.md minor flags).

For every Phase-2 row ``geom_original`` is non-NULL (all sources are
map-matched); the native-source NULL rule is Phase 1 / canon only.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from shapely.geometry import LineString

from freewheel_corpus import geometry

# Match-quality threshold below which we keep the raw geometry (DECISIONS.md).
MATCH_QUALITY_THRESHOLD = 0.85
# Valhalla input cap (DECISIONS.md minor flags): guard + log, no chunk-and-stitch.
MAX_INPUT_KM = 200.0
# Resampling spacing fed to Valhalla map-matching.
RESAMPLE_SPACING_M = 50.0


class TraceClient(Protocol):
    """The Valhalla surface :func:`match_route` needs (lets tests inject a fake)."""

    def trace_attributes(
        self, shape: list[dict[str, float]], *, no_cache: bool = False
    ) -> Any: ...


@dataclass
class MatchResult:
    """Outcome of map-matching one route — consumed by the Phase-2 ingest.

    - ``status``: ``'matched'`` | ``'failed_match'`` | ``'oversize'`` |
      ``'match_error'`` (the Valhalla call raised — endpoint down/rate-limited).
    - ``geom``: the geometry to store in ``routes.geom`` (snapped on success,
      raw on failure/oversize).
    - ``geom_original``: the raw input line (always non-NULL for Phase 2).
    - ``match_quality``: matched_len / input_len (0.0 when the call was skipped).
    - ``surface_breakdown`` / ``waytype_breakdown``: ``{value -> fraction}`` by
      length over the matched edges (empty when not matched).
    - ``input_km`` / ``matched_km``: the lengths used for ``match_quality``.
    """

    status: str
    geom: LineString
    geom_original: LineString
    match_quality: float
    surface_breakdown: dict[str, float] = field(default_factory=dict)
    waytype_breakdown: dict[str, float] = field(default_factory=dict)
    input_km: float = 0.0
    matched_km: float = 0.0
    error: str | None = None  # the exception text when ``status='match_error'``


def _decode_polyline6(encoded: str) -> list[tuple[float, float]]:
    """Decode a Valhalla-encoded polyline (precision **6**) to ``(lon, lat)``.

    Valhalla encodes ``trace_attributes`` ``shape`` at 1e6 scale (NOT the 1e5 of
    Google's classic polyline) — decoding at the wrong precision silently yields
    coordinates off by 10x. Returns points in shapely ``(lon, lat)`` order.
    """
    coords: list[tuple[float, float]] = []
    index = lat = lon = 0
    length = len(encoded)
    while index < length:
        for _ in range(2):  # lat then lon
            shift = result = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if (result & 1) else (result >> 1)
            if _ == 0:
                lat += delta
            else:
                lon += delta
        coords.append((lon / 1e6, lat / 1e6))
    return coords


def _breakdowns(edges: list[dict[str, Any]]) -> tuple[dict[str, float], dict[str, float], float]:
    """Fractional-by-length ``surface`` / ``use``(waytype) breakdowns + total km.

    Each Valhalla edge carries a ``length`` (km) plus ``surface`` and ``use``
    string attributes. We sum length per distinct value and normalize by the
    total matched length, so each breakdown is ``{value -> fraction}`` summing to
    ~1.0. Edges missing an attribute are bucketed under ``'unknown'``.
    """
    surface_len: dict[str, float] = {}
    waytype_len: dict[str, float] = {}
    total = 0.0
    for edge in edges:
        length = float(edge.get("length", 0.0) or 0.0)
        if length <= 0:
            continue
        total += length
        surf = edge.get("surface") or "unknown"
        use = edge.get("use") or "unknown"
        surface_len[surf] = surface_len.get(surf, 0.0) + length
        waytype_len[use] = waytype_len.get(use, 0.0) + length

    if total <= 0:
        return {}, {}, 0.0
    surface_breakdown = {k: v / total for k, v in surface_len.items()}
    waytype_breakdown = {k: v / total for k, v in waytype_len.items()}
    return surface_breakdown, waytype_breakdown, total


def match_route(raw: LineString, client: TraceClient) -> MatchResult:
    """Map-match a raw lon/lat ``LineString`` via Valhalla; return a MatchResult.

    Resamples to ~50 m, guards the 200 km cap, calls ``trace_attributes``,
    decodes the snapped shape, computes ``match_quality`` = matched/input, and
    applies the geom / geom_original rule. DB-free — the phase logs + stores.
    """
    resampled = geometry.resample_line(raw, spacing_m=RESAMPLE_SPACING_M)
    input_km = geometry.line_length_km(resampled)

    # 200 km guard: skip Valhalla entirely, keep raw (DECISIONS.md — no stitch).
    if input_km > MAX_INPUT_KM:
        return MatchResult(
            status="oversize",
            geom=raw,
            geom_original=raw,
            match_quality=0.0,
            input_km=input_km,
        )

    shape = [{"lon": lon, "lat": lat} for lon, lat in resampled.coords]
    try:
        payload = client.trace_attributes(shape)
    except Exception as exc:  # endpoint down / rate-limited / 5xx / timeout
        # The brief: report it and continue — a downed Valhalla must NOT abort
        # the batch. Keep the raw geometry; the phase logs ``match_error`` so the
        # route is still stored (with raw geom) and the failure is auditable.
        return MatchResult(
            status="match_error",
            geom=raw,
            geom_original=raw,
            match_quality=0.0,
            input_km=input_km,
            error=str(exc),
        )

    edges = payload.get("edges", []) or []
    surface_breakdown, waytype_breakdown, matched_km = _breakdowns(edges)

    # Cap at 1.0: a snapped track can be marginally longer than the resampled
    # input (Valhalla follows the real road centreline), so matched/input can
    # exceed 1; clamp it so match_quality is a clean [0, 1] coverage ratio.
    match_quality = min(matched_km / input_km, 1.0) if input_km > 0 else 0.0

    if match_quality < MATCH_QUALITY_THRESHOLD:
        # Failure: keep raw for both geom and geom_original; phase logs failed_match.
        return MatchResult(
            status="failed_match",
            geom=raw,
            geom_original=raw,
            match_quality=match_quality,
            input_km=input_km,
            matched_km=matched_km,
        )

    snapped_coords = _decode_polyline6(payload.get("shape", ""))
    snapped = LineString(snapped_coords) if len(snapped_coords) >= 2 else raw
    return MatchResult(
        status="matched",
        geom=snapped,
        geom_original=raw,
        match_quality=match_quality,
        surface_breakdown=surface_breakdown,
        waytype_breakdown=waytype_breakdown,
        input_km=input_km,
        matched_km=matched_km,
    )
