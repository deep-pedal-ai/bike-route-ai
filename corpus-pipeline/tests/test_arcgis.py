"""TDD (rebuilt WP2): ArcGIS client pagination + clip-to-metro.

Pure / network-free: an injected fake transport returns two pages with
``exceededTransferLimit`` semantics so the pagination walk is exercised without
HTTP; the clip is tested against a synthetic feature crossing the metro boundary.
"""

from __future__ import annotations

from shapely.geometry import LineString, MultiLineString, Polygon, mapping

from freewheel_corpus.clients.arcgis import (
    ArcGISClient,
    clip_feature_to_metro,
)
from freewheel_corpus.cache import DiskCache


def _feature(oid, coords):
    return {
        "type": "Feature",
        "properties": {"OBJECTID": oid},
        "geometry": mapping(LineString(coords)),
    }


def test_pagination_assembles_all_pages(tmp_path):
    """fetch_all_features walks resultOffset until exceededTransferLimit clears."""
    pages = {
        0: {
            "type": "FeatureCollection",
            "features": [_feature(1, [(-73.9, 40.7), (-73.8, 40.7)])],
            "exceededTransferLimit": True,
        },
        1: {
            "type": "FeatureCollection",
            "features": [_feature(2, [(-73.7, 40.7), (-73.6, 40.7)])],
            "exceededTransferLimit": False,
        },
    }

    calls = []

    def fake_transport(url, params):
        calls.append(params["resultOffset"])
        return pages[params["resultOffset"]]

    client = ArcGISClient(
        cache=DiskCache(tmp_path / "cache"),
        transport=fake_transport,
        page_size=1,
    )
    feats = client.fetch_all_features()

    assert [f["properties"]["OBJECTID"] for f in feats] == [1, 2]
    assert calls == [0, 1]  # walked both offsets


def test_clip_keeps_in_metro_portion_as_single_linestring():
    """A feature crossing the metro boundary is clipped to its in-metro part and
    returned as a single LineString (the p2 contract)."""
    # A small square boundary around a point in NYC.
    boundary = Polygon(
        [(-74.0, 40.7), (-73.9, 40.7), (-73.9, 40.8), (-74.0, 40.8), (-74.0, 40.7)]
    )
    # Line runs from inside the box out to the west (outside).
    feat = _feature(99, [(-73.95, 40.75), (-73.92, 40.75), (-74.20, 40.75)])

    clipped = clip_feature_to_metro(feat, boundary)
    assert clipped is not None
    assert isinstance(clipped.geom, LineString)
    assert clipped.properties["OBJECTID"] == 99
    # The kept portion lies within the box.
    for lon, _ in clipped.geom.coords:
        assert -74.0 <= lon <= -73.9


def test_clip_returns_none_when_outside_metro():
    """A feature entirely outside metro yields None (skipped silently by p2)."""
    boundary = Polygon(
        [(-74.0, 40.7), (-73.9, 40.7), (-73.9, 40.8), (-74.0, 40.8), (-74.0, 40.7)]
    )
    feat = _feature(7, [(-72.0, 41.5), (-71.9, 41.5)])  # way east, outside
    assert clip_feature_to_metro(feat, boundary) is None


def test_clip_multilinestring_intersection_reduced_to_longest_linestring():
    """A polygon intersection that yields a MultiLineString is reduced to the
    single longest LineString (p2 cannot consume a Multi)."""
    boundary = Polygon(
        [(-74.0, 40.7), (-73.5, 40.7), (-73.5, 40.8), (-74.0, 40.8), (-74.0, 40.7)]
    )
    # Two disjoint in-box segments via one MultiLineString feature; longest wins.
    multi = MultiLineString(
        [
            [(-73.95, 40.75), (-73.94, 40.75)],  # short
            [(-73.80, 40.75), (-73.60, 40.75)],  # long
        ]
    )
    feat = {"type": "Feature", "properties": {"OBJECTID": 5}, "geometry": mapping(multi)}
    clipped = clip_feature_to_metro(feat, boundary)
    assert clipped is not None
    assert isinstance(clipped.geom, LineString)
    # The longer segment (~0.20 deg) was kept over the shorter (~0.01 deg).
    xs = [c[0] for c in clipped.geom.coords]
    assert min(xs) <= -73.79 and max(xs) >= -73.61
