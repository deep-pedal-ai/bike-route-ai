"""Metro boundary loader + the metro-bounds safety guard.

The boundary polygon is stored in GeoJSON ``[lon, lat]`` order per RFC 7946 — the
OPPOSITE of ``canon.yaml``'s human ``[lat, lon]`` order. Coordinate-order bugs are
the highest-risk class in this pipeline, so every coordinate that flows through
here is checked against the region's bounds box: a transposition lands outside the
box and fails LOUDLY rather than silently querying / routing the wrong region.

Multi-region (Slice 2): the bounds box and boundary file are no longer hardcoded
NY constants — they come from a :class:`~freewheel_corpus.region_profile.RegionProfile`
(default :data:`~freewheel_corpus.region_profile.NY`, so existing NY callers are
unchanged). This module is now a thin convenience wrapper over the profile, kept
because ``clients/arcgis.py`` and the phases import these names.

NOTE FOR LATER PHASES: a self-hosted ORS / Valhalla graph extract must cover the
bbox of ALL stored route geometry (canon rides, generated loops, map-matched
segments can extend beyond this hand-drawn polygon) — NOT merely this boundary.
This polygon is the *query/clip* boundary, not the routing extent.
"""

from __future__ import annotations

import json
from pathlib import Path

from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry

from freewheel_corpus.region_profile import NY, RegionBoundsError, RegionProfile

# Back-compat alias: callers/tests catch ``MetroBoundsError``; it is now the same
# class the region profile raises, so a profile-raised error is still caught.
MetroBoundsError = RegionBoundsError

# Back-compat constants (NY): some code/tests still reference the bare box. They
# point at the NY profile so there is a single source of truth.
LAT_MIN, LAT_MAX = NY.lat_min, NY.lat_max
LON_MIN, LON_MAX = NY.lon_min, NY.lon_max


def assert_in_metro_bounds(lon: float, lat: float, profile: RegionProfile = NY) -> None:
    """Assert a ``(lon, lat)`` point lies within ``profile``'s bounds (default NY).

    Coordinates are in code order: longitude first, latitude second.
    """
    profile.assert_in_bounds(lon, lat)


def load_metro_boundary(profile: RegionProfile = NY) -> BaseGeometry:
    """Load ``profile``'s clip polygon (GeoJSON [lon, lat]) as a shapely shape.

    Validates that the polygon is geometrically valid and that every vertex lands
    within the region bounds, so a malformed or transposed boundary fails at load
    time rather than silently mis-clipping every source.
    """
    data = json.loads(Path(profile.boundary_path).read_text())
    geom = shape(data["geometry"])

    if not geom.is_valid:
        raise ValueError(
            f"{profile.boundary_path.name} is not a valid polygon: "
            f"{geom.is_valid_reason if hasattr(geom, 'is_valid_reason') else 'invalid'}"
        )

    # Every boundary vertex must be in-bounds (catches a transposed file).
    for lon, lat in geom.exterior.coords:
        profile.assert_in_bounds(lon, lat)

    return geom
