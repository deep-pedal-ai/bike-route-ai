"""S2 (TDD): POI taxonomy — pure mapping of OSM tags -> display bucket.

Fixture-free and DB-free: the whole point of this slice is a pure function the
fan-out phases (S3/S5/S6) build against. The six cases below are the behavioral
contract from the build plan; everything else (radius config, caps) is the
tunable policy those phases read.
"""

from __future__ import annotations

import pytest

from freewheel_corpus.poi.taxonomy import (
    DEFAULT_CONFIG,
    Bucket,
    bucket_for_tags,
)


@pytest.mark.parametrize(
    ("tags", "expected"),
    [
        ({"amenity": "cafe"}, Bucket.COFFEE_FOOD),
        ({"amenity": "drinking_water"}, Bucket.WATER_REST),
        ({"tourism": "viewpoint"}, Bucket.SCENIC),
        ({"historic": "castle"}, Bucket.LANDMARK),
        ({"amenity": "bicycle_repair_station"}, Bucket.BIKE_SERVICES),
        ({"shop": "supermarket"}, None),
    ],
)
def test_bucket_for_tags_maps_the_whitelist(tags, expected):
    assert bucket_for_tags(tags) == expected


def test_historic_is_a_wildcard():
    """historic=* (any value) lands in landmark — not just the enumerated ones."""
    assert bucket_for_tags({"historic": "ruins"}) == Bucket.LANDMARK
    assert bucket_for_tags({"historic": "memorial"}) == Bucket.LANDMARK


def test_empty_or_unknown_tags_return_none():
    assert bucket_for_tags({}) is None
    assert bucket_for_tags({"building": "yes"}) is None


def test_bucket_values_are_the_shared_slugs():
    """The bucket slugs are the cross-language contract with shared/corpus.ts."""
    assert {b.value for b in Bucket} == {
        "coffee_food",
        "water_rest",
        "scenic",
        "landmark",
        "bike_services",
    }


def test_default_config_radius_per_bucket():
    """Stop-types get the tighter detour radius; scenic/landmark reach farther."""
    radius = DEFAULT_CONFIG.radius_m
    # every bucket has a radius
    assert set(radius) == set(Bucket)
    # stop-types ~150 m
    assert radius[Bucket.COFFEE_FOOD] == 150.0
    assert radius[Bucket.WATER_REST] == 150.0
    assert radius[Bucket.BIKE_SERVICES] == 150.0
    # scenic / landmark ~400 m
    assert radius[Bucket.SCENIC] == 400.0
    assert radius[Bucket.LANDMARK] == 400.0


def test_default_config_caps():
    assert DEFAULT_CONFIG.max_per_route == 15
    assert DEFAULT_CONFIG.max_per_bucket == 4
