"""Metro boundary loader + the metro-bounds safety guard.

The boundary polygon (``config/metro_boundary.geojson``) is stored in GeoJSON
``[lon, lat]`` order per RFC 7946 — the OPPOSITE of ``canon.yaml``'s human
``[lat, lon]`` order. Coordinate-order bugs are the highest-risk class in this
pipeline, so every coordinate that flows through here is checked against the
metro bounds (lat 40-42, lon -75..-73): a transposition lands outside the box
and fails LOUDLY rather than silently querying / routing the wrong region.

NOTE FOR LATER PHASES: a self-hosted ORS / Valhalla graph extract must cover the
bbox of ALL stored route geometry (canon rides, generated loops, map-matched
NYSDOT segments can extend beyond this hand-drawn polygon) — NOT merely this
boundary. This polygon is the *query/clip* boundary, not the routing extent.
"""

from __future__ import annotations

import json
from pathlib import Path

from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry

_BOUNDARY_PATH = Path(__file__).parent / "config" / "metro_boundary.geojson"

# Metro-bounds guard (PLAN Q5 / §WP0). Generous box around the coverage area.
LAT_MIN, LAT_MAX = 40.0, 42.0
LON_MIN, LON_MAX = -75.0, -73.0


class MetroBoundsError(ValueError):
    """Raised when a coordinate falls outside the metro bounds (likely a
    transposed [lat, lon] / [lon, lat] swap)."""


def assert_in_metro_bounds(lon: float, lat: float) -> None:
    """Assert a ``(lon, lat)`` point lies within the metro bounds.

    Coordinates are in code order: longitude first, latitude second.
    """
    if not (LON_MIN <= lon <= LON_MAX and LAT_MIN <= lat <= LAT_MAX):
        raise MetroBoundsError(
            f"Coordinate (lon={lon}, lat={lat}) is outside the metro bounds "
            f"(lat {LAT_MIN}..{LAT_MAX}, lon {LON_MIN}..{LON_MAX}). This usually "
            f"means a transposed [lat, lon] / [lon, lat] swap — check coordinate order."
        )


def load_metro_boundary() -> BaseGeometry:
    """Load the metro boundary polygon (GeoJSON [lon, lat]) as a shapely shape.

    Validates that the polygon is geometrically valid and that every vertex
    lands within the metro bounds, so a malformed or transposed boundary fails
    at load time rather than silently mis-clipping every source.
    """
    data = json.loads(_BOUNDARY_PATH.read_text())
    geom = shape(data["geometry"])

    if not geom.is_valid:
        raise ValueError(
            f"metro_boundary.geojson is not a valid polygon: "
            f"{geom.is_valid_reason if hasattr(geom, 'is_valid_reason') else 'invalid'}"
        )

    # Every boundary vertex must be in-bounds (catches a transposed file).
    for lon, lat in geom.exterior.coords:
        assert_in_metro_bounds(lon, lat)

    return geom
