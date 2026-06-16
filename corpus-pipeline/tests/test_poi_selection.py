"""S3 (TDD): Overpass fetch + selection policy.

Network-free: the Overpass response is a pre-recorded fixture passed in as raw
OSM ``elements`` (the HTTP fetch is mocked away — ``select_pois`` accepts either
a list of elements or an :class:`OverpassClient`). The behaviors below are the
density-fix contract from feature §6: hard caps, category radii, spread along the
route, and within-bucket ranking that prefers notable (``wikidata``/``name``)
POIs.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from shapely.geometry import LineString

from freewheel_corpus.poi.selection import select_pois
from freewheel_corpus.poi.taxonomy import Bucket

_FIXTURES = Path(__file__).parent / "fixtures"

# The route the dense/sparse fixtures were geometrically built around.
_ROUTE = LineString([(-73.9700, 40.7800), (-73.9500, 40.7800)])


def _elements(name: str) -> list[dict]:
    return json.loads((_FIXTURES / name).read_text())["elements"]


def _dense() -> list:
    return select_pois(_ROUTE, elements_or_client=_elements("overpass_pois_dense.json"))


def test_caps_total_and_per_bucket():
    selected = _dense()

    assert len(selected) <= 15
    per_bucket = Counter(p.bucket for p in selected)
    for bucket, count in per_bucket.items():
        assert count <= 4, f"{bucket} exceeded the per-bucket cap: {count}"


def test_radius_is_category_dependent():
    """A café at ~300 m is dropped (150 m stop radius); a viewpoint at ~300 m is
    kept (400 m scenic radius). Anchored on the computed distance so a miscomputed
    fixture fails loudly rather than passing for the wrong reason."""
    selected = _dense()

    coffee = [p for p in selected if p.bucket == Bucket.COFFEE_FOOD]
    scenic = [p for p in selected if p.bucket == Bucket.SCENIC]

    # No café beyond the 150 m stop radius survived.
    assert coffee, "expected some cafés within radius"
    assert all(p.distance_m <= 150.0 for p in coffee)
    assert not any(p.name == "Far Cafe" for p in coffee)

    # The viewpoint built at ~300 m IS kept, and its distance proves the radius
    # wiring (between the 150 m stop radius and the 400 m scenic radius).
    overlook = next((p for p in scenic if p.name == "Overlook North"), None)
    assert overlook is not None
    assert 250.0 < overlook.distance_m < 350.0


def test_results_are_spread_along_the_route_not_clustered():
    """Selected POIs span the route by position_fraction (the §6 spread fix), not
    all clustered at one end."""
    selected = _dense()
    fractions = [p.position_fraction for p in selected]

    assert min(fractions) < 0.35
    assert max(fractions) > 0.65
    # And the output is ordered by position for pin display.
    assert fractions == sorted(fractions)


def test_within_bucket_notable_pois_rank_above_bare_ones():
    """Within a bucket, a POI with wikidata/name ranks above an unnamed one when
    the cap forces a choice."""
    selected = _dense()
    coffee = [p for p in selected if p.bucket == Bucket.COFFEE_FOOD]

    # The fixture has 6 in-radius cafés but the cap keeps 4: the two unnamed,
    # wikidata-less cafés should be the ones dropped in favor of notable ones.
    assert len(coffee) == 4
    kept_named = [p for p in coffee if p.name or p.wikidata_id]
    # All four kept cafés are notable (named / wikidata), none are the bare ones.
    assert len(kept_named) == 4


def test_sparse_rural_route_keeps_its_small_set():
    """The rural case (1 café, 1 viewpoint, 7 historic): everything in-radius is
    kept under the caps — caps only bite on dense urban routes."""
    selected = select_pois(
        _ROUTE, elements_or_client=_elements("overpass_pois_sparse.json")
    )
    per_bucket = Counter(p.bucket for p in selected)

    assert per_bucket[Bucket.COFFEE_FOOD] == 1
    assert per_bucket[Bucket.SCENIC] == 1
    # 7 historic exist but the per-bucket cap (4) still applies.
    assert per_bucket[Bucket.LANDMARK] == 4


def test_accepts_an_overpass_client_and_mocks_the_fetch():
    """The fetch is decoupled: passing a client (not a list) builds QL and calls
    .query(); HTTP is mocked via the client's injected transport."""

    class FakeClient:
        def __init__(self, elements: list[dict]) -> None:
            self._elements = elements
            self.queries: list[str] = []

        def query(self, ql: str):
            self.queries.append(ql)
            return {"elements": self._elements}

    client = FakeClient(_elements("overpass_pois_sparse.json"))
    selected = select_pois(_ROUTE, elements_or_client=client)

    assert client.queries  # a QL string was built and "fetched"
    assert "out center" in client.queries[0]  # ways/relations get their center
    assert any(p.bucket == Bucket.LANDMARK for p in selected)
