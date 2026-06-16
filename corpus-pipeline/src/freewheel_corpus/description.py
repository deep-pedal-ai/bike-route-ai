"""Deterministic route descriptions for Phase 5 embeddings.

The description intentionally excludes exact distances, exact elevation,
coordinates, route names, and loop/out-and-back wording. Those are either hard
SQL filters or proper-name search concerns, not semantic riding-experience text.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from freewheel_corpus.poi.taxonomy import Bucket

PAVED_SURFACES = {
    "paved",
    "asphalt",
    "concrete",
    "paved_smooth",
    "paving_stones",
}
GRAVEL_SURFACES = {
    "gravel",
    "fine_gravel",
    "compacted",
}
ROUGH_SURFACES = {
    "dirt",
    "ground",
    "unpaved",
    "grass",
    "sand",
    "woodchips",
    "cobblestone",
}


def build_route_description(
    *,
    distance_km: float | None,
    ascent_m: float | None,
    surface_breakdown: dict[str, float] | None,
    protected_lane_fraction: float | None,
    greenway_fraction: float | None,
    poi_summary: Mapping[Bucket, int] | None = None,
) -> str:
    """Build the stored text that Phase 5 embeds for one route.

    ``poi_summary`` is a category-level count of the SELECTED/capped POIs near
    the route (``{Bucket: count}``) — never raw names/coords/images, which stay
    in the ``pois`` table for display only (feature §7). When present and
    non-empty it appends ONE bounded, experiential category clause in the
    corpus's existing register (e.g. "…with several coffee stops, a scenic
    overlook, and a historic landmark along the way."). When unset/``None``/
    empty the output is **byte-identical** to the pre-POI behaviour, so the
    idempotent p5 re-embed does not spuriously re-embed unchanged rows.
    """
    clauses: list[str] = []

    terrain = _terrain_phrase(distance_km=distance_km, ascent_m=ascent_m)
    if terrain:
        clauses.append(terrain)

    clauses.append(_surface_phrase(surface_breakdown))
    clauses.append(_protection_phrase(protected_lane_fraction, greenway_fraction))

    base = "A " + ", ".join(clauses) + "."

    poi_clause = _poi_phrase(poi_summary)
    if poi_clause:
        return base[:-1] + ", " + poi_clause + "."
    return base


# Experiential category words per bucket: (singular noun phrase, plural noun).
# These are riding-experience words riders actually query ("coffee", "scenic",
# "historic") — never proper nouns. Order of this mapping is the deterministic
# clause order (iterated by Bucket enum order below).
_BUCKET_WORDS: dict[Bucket, tuple[str, str]] = {
    Bucket.COFFEE_FOOD: ("a coffee stop", "coffee stops"),
    Bucket.WATER_REST: ("a rest stop", "rest stops"),
    Bucket.SCENIC: ("a scenic overlook", "scenic overlooks"),
    Bucket.LANDMARK: ("a historic landmark", "historic landmarks"),
    Bucket.BIKE_SERVICES: ("a bike-service stop", "bike-service stops"),
}


def _poi_phrase(poi_summary: Mapping[Bucket, int] | None) -> str | None:
    """One bounded experiential clause from a bucket->count summary, or None.

    Deterministic: iterates the fixed ``Bucket`` enum order (not dict order) and
    pluralizes by count ("a coffee stop" vs "several coffee stops"). Buckets with
    a non-positive / missing count are omitted. Only category words appear — no
    names, no coordinates, no counts as digits.
    """
    if not poi_summary:
        return None

    parts: list[str] = []
    for bucket in Bucket:  # fixed enum order => deterministic output
        count = poi_summary.get(bucket, 0)
        if count <= 0:
            continue
        singular, plural = _BUCKET_WORDS[bucket]
        parts.append("several " + plural if count > 1 else singular)

    if not parts:
        return None

    return "with " + _join_clause(parts) + " along the way"


def _join_clause(parts: list[str]) -> str:
    """Join phrases as an English list: "a", "a and b", "a, b, and c"."""
    if len(parts) == 1:
        return parts[0]
    if len(parts) == 2:
        return parts[0] + " and " + parts[1]
    return ", ".join(parts[:-1]) + ", and " + parts[-1]


def _terrain_phrase(*, distance_km: float | None, ascent_m: float | None) -> str | None:
    if distance_km is None or distance_km <= 0 or ascent_m is None:
        return None

    ascent_per_km = ascent_m / distance_km
    if ascent_per_km < 5:
        return "mostly flat ride"
    if ascent_per_km < 12:
        return "gently rolling ride"
    if ascent_per_km < 22:
        return "hilly ride with steady climbing"
    return "very hilly ride with sustained climbing"


def _surface_phrase(surface_breakdown: dict[str, float] | None) -> str:
    if not surface_breakdown:
        return "surface mix is not specified"

    paved = _sum_matching(surface_breakdown, PAVED_SURFACES)
    gravel = _sum_matching(surface_breakdown, GRAVEL_SURFACES)
    rough = _sum_matching(surface_breakdown, ROUGH_SURFACES)

    if paved >= 0.85:
        return "fully or almost fully paved"
    if paved >= 0.60 and gravel + rough < 0.30:
        return "mostly paved with short unpaved segments"
    if gravel >= 0.55:
        return "mostly gravel or crushed-stone riding"
    if gravel + rough >= 0.45:
        return "mixed-surface riding with meaningful unpaved sections"
    if rough >= 0.30:
        return "rougher unpaved riding in places"
    return "mixed paved and path surfaces"


def _protection_phrase(
    protected_lane_fraction: float | None,
    greenway_fraction: float | None,
) -> str:
    protected = _normalized_fraction(protected_lane_fraction)
    greenway = _normalized_fraction(greenway_fraction)

    if greenway >= 0.75:
        return "mostly on greenway away from traffic"
    if protected >= 0.75:
        return "mostly on protected bikeway away from traffic"
    if protected >= 0.45 or greenway >= 0.45:
        return "partly protected from traffic"
    if protected >= 0.20 or greenway >= 0.20:
        return "some protected or greenway segments with mixed traffic"
    return "mostly mixed-traffic riding"


def _sum_matching(surface_breakdown: dict[str, float], keys: set[str]) -> float:
    total = _surface_total(surface_breakdown)
    if total <= 0:
        return 0.0

    matching = 0.0
    for raw_key, raw_fraction in surface_breakdown.items():
        key = str(raw_key).lower()
        fraction = _coerce_fraction(raw_fraction)
        if key in keys:
            matching += fraction
    return matching / total


def _surface_total(surface_breakdown: dict[str, float]) -> float:
    total = sum(_coerce_fraction(value) for value in surface_breakdown.values())
    if total > 1.01:
        return total
    return 1.0


def _coerce_fraction(value: Any) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return 0.0
    if numeric <= 0:
        return 0.0
    if numeric > 1.01:
        return numeric / 100.0
    return numeric


def _normalized_fraction(value: float | None) -> float:
    if value is None:
        return 0.0
    if value <= 0:
        return 0.0
    if value > 1.01:
        return value / 100.0
    return value
