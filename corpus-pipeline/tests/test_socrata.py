"""TDD (rebuilt WP3): Socrata client paging + $where pass-through.

Network-free: an injected fake transport returns two pages (full page then a
short page) so the $offset walk terminates correctly, and asserts the server-side
$where filter is forwarded.
"""

from __future__ import annotations

from freewheel_corpus.cache import DiskCache
from freewheel_corpus.clients.socrata import SocrataClient


def _feat(i):
    return {"type": "Feature", "properties": {"segmentid": i}, "geometry": None}


def test_paging_walks_offset_until_short_page(tmp_path):
    """fetch_geojson concatenates pages until a page is shorter than page_size."""
    seen = []

    def fake_transport(url, params):
        seen.append((params["$offset"], params.get("$where")))
        off = params["$offset"]
        if off == 0:
            return {"type": "FeatureCollection", "features": [_feat(0), _feat(1)]}
        return {"type": "FeatureCollection", "features": [_feat(2)]}  # short → stop

    client = SocrataClient(
        cache=DiskCache(tmp_path / "cache"),
        transport=fake_transport,
        page_size=2,
    )
    fc = client.fetch_geojson("mzxg-pwib", where="status='Current'")

    assert fc["type"] == "FeatureCollection"
    assert [f["properties"]["segmentid"] for f in fc["features"]] == [0, 1, 2]
    # Walked offsets 0 then 2; the $where was forwarded on every page.
    assert [o for o, _ in seen] == [0, 2]
    assert all(w == "status='Current'" for _, w in seen)


def test_cache_replays_without_refetch(tmp_path):
    """A second fetch with the same args replays from disk (no transport call)."""
    calls = {"n": 0}

    def fake_transport(url, params):
        calls["n"] += 1
        return {"type": "FeatureCollection", "features": [_feat(0)]}  # single short page

    client = SocrataClient(
        cache=DiskCache(tmp_path / "cache"),
        transport=fake_transport,
        page_size=10,
    )
    client.fetch_geojson("mzxg-pwib")
    client.fetch_geojson("mzxg-pwib")
    assert calls["n"] == 1  # second call served from cache
