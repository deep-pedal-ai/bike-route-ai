"""TDD: Phase 4 coordinate helper (WP4 behavior 2).

``canon.yaml`` stores human ``[lat, lon]``; code/ORS/shapely want ``[lon, lat]``
(Q5). The swap happens in exactly ONE place, with the metro-bounds guard so a
transposed coordinate (which would route into the ocean) fails LOUDLY instead of
silently. The guard reuses :func:`freewheel_corpus.metro.assert_in_metro_bounds`.
"""

from __future__ import annotations

import pytest

from freewheel_corpus.metro import MetroBoundsError
from freewheel_corpus.phases import p4_canon_and_generation as p4


def test_latlon_to_lonlat_swaps_order():
    """A human [lat, lon] becomes code [lon, lat]."""
    # Central Park-ish: lat 40.78, lon -73.97.
    assert p4.latlon_to_lonlat([40.78, -73.97]) == (-73.97, 40.78)


def test_latlon_to_lonlat_rejects_out_of_metro():
    """A coordinate outside the metro bounds raises (likely a transposition)."""
    # If someone wrote [lon, lat] by mistake: [-73.97, 40.78] read as [lat, lon]
    # → lat=-73.97 is wildly out of bounds.
    with pytest.raises(MetroBoundsError):
        p4.latlon_to_lonlat([-73.97, 40.78])


def test_latlon_list_to_lonlat_converts_a_waypoint_list():
    """A list of [lat, lon] waypoints converts to a [lon, lat] coordinate list."""
    waypoints = [[40.78, -73.97], [40.80, -73.95]]
    out = p4.latlon_list_to_lonlat(waypoints)
    assert out == [(-73.97, 40.78), (-73.95, 40.80)]


def test_latlon_list_rejects_a_single_bad_waypoint():
    """One out-of-bounds waypoint in the list fails the whole conversion loudly."""
    waypoints = [[40.78, -73.97], [99.0, -73.95]]  # lat 99 is impossible
    with pytest.raises(MetroBoundsError):
        p4.latlon_list_to_lonlat(waypoints)
