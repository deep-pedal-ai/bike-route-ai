"""Slice 2: the per-region projected-CRS threading in ``geometry.py``.

Two things must hold:
1. **NY is byte-identical.** Omitting ``crs`` resolves to EPSG:32618, so every
   existing NY call is unchanged (behaviour-preserving by construction).
2. **CRS actually bites.** Passing the right UTM zone changes the metric result,
   so Seattle (EPSG:32610) gets true metres instead of the silently-wrong 18N
   distance the old hardcoded constant would have produced (plan §3).
"""

from __future__ import annotations

from shapely.geometry import LineString

from freewheel_corpus import geometry

# A Seattle line (~Burke-Gilman-ish), lon/lat. Six UTM zones west of NY, so 18N
# vs 10N differ a lot here — the whole point of threading the CRS.
_SEATTLE_LINE = LineString([(-122.3035, 47.6553), (-122.2900, 47.6700)])
_NY_LINE = LineString([(-73.9665, 40.7812), (-73.9600, 40.7900)])


def test_transformer_cache_is_keyed_by_crs():
    # Same crs -> same cached transformer object; different crs -> different one.
    assert geometry._to_utm("EPSG:32618") is geometry._to_utm("EPSG:32618")
    assert geometry._to_utm("EPSG:32610") is geometry._to_utm("EPSG:32610")
    assert geometry._to_utm("EPSG:32618") is not geometry._to_utm("EPSG:32610")


def test_default_crs_equals_explicit_ny_zone():
    # The default (no crs arg) must equal explicit EPSG:32618 for every helper —
    # this is the NY behaviour-preservation guarantee.
    assert geometry.line_length_km(_NY_LINE) == geometry.line_length_km(
        _NY_LINE, "EPSG:32618"
    )
    assert geometry.project_to_utm(_NY_LINE).equals(
        geometry.project_to_utm(_NY_LINE, "EPSG:32618")
    )
    assert geometry.is_loop(_NY_LINE) == geometry.is_loop(_NY_LINE, "EPSG:32618")


def test_wrong_zone_distorts_distance_correct_zone_fixes_it():
    # In Seattle, the correct zone (10N) and the NY zone (18N) give materially
    # different lengths — proving the CRS is load-bearing, not cosmetic.
    len_10n = geometry.line_length_km(_SEATTLE_LINE, "EPSG:32610")
    len_18n = geometry.line_length_km(_SEATTLE_LINE, "EPSG:32618")
    assert len_10n > 0
    # >5% divergence is a conservative floor; six zones off is far worse in reality.
    assert abs(len_10n - len_18n) / len_10n > 0.05


def test_roundtrip_projection_is_stable_per_crs():
    # project -> unproject returns (near) the original lon/lat for the matching crs.
    projected = geometry.project_to_utm(_SEATTLE_LINE, "EPSG:32610")
    back = geometry.project_to_wgs84(projected, "EPSG:32610")
    for (lon0, lat0), (lon1, lat1) in zip(_SEATTLE_LINE.coords, back.coords):
        assert abs(lon0 - lon1) < 1e-7
        assert abs(lat0 - lat1) < 1e-7
