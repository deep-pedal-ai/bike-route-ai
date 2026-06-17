"""POI taxonomy — the curated OSM-tag -> display-bucket whitelist (feature §6).

Pure and dependency-free: this is the contract the selection (S3), description
fold (S5), and p6 wiring (S6) all build against. Everything that is "policy"
(which tags count, how far we reach for each bucket, how many we keep) lives here
so it can be re-tuned without touching the phases — the feature's tunability
guarantee (§3).

The five bucket slugs are shared verbatim with the TypeScript contract in
``packages/shared/src/corpus.ts`` (``PoiBucket``); keep them in sync.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum


class Bucket(StrEnum):
    """The five display buckets. ``.value`` is the cross-language slug."""

    COFFEE_FOOD = "coffee_food"
    WATER_REST = "water_rest"
    SCENIC = "scenic"
    LANDMARK = "landmark"
    BIKE_SERVICES = "bike_services"


# Sentinel meaning "any value for this key matches" (e.g. historic=*).
_ANY = None

# Ordered (key, value) rules. First match wins, so more specific / rarer buckets
# precede the broad ones — a viewpoint that also carries a historic tag is
# scenic, not landmark. value=_ANY is a wildcard on the key.
_RULES: tuple[tuple[str, str | None, Bucket], ...] = (
    # bike services — rare and unambiguous, check first
    ("amenity", "bicycle_repair_station", Bucket.BIKE_SERVICES),
    ("shop", "bicycle", Bucket.BIKE_SERVICES),
    # scenic — natural features + viewpoints
    ("tourism", "viewpoint", Bucket.SCENIC),
    ("natural", "peak", Bucket.SCENIC),
    ("natural", "waterfall", Bucket.SCENIC),
    ("natural", "beach", Bucket.SCENIC),
    # landmark / culture
    ("historic", _ANY, Bucket.LANDMARK),
    ("tourism", "attraction", Bucket.LANDMARK),
    ("amenity", "place_of_worship", Bucket.LANDMARK),
    # coffee & food
    ("amenity", "cafe", Bucket.COFFEE_FOOD),
    ("shop", "bakery", Bucket.COFFEE_FOOD),
    ("amenity", "restaurant", Bucket.COFFEE_FOOD),
    ("amenity", "pub", Bucket.COFFEE_FOOD),
    # water & rest
    ("amenity", "drinking_water", Bucket.WATER_REST),
    ("amenity", "toilets", Bucket.WATER_REST),
    ("leisure", "park", Bucket.WATER_REST),
    ("tourism", "picnic_site", Bucket.WATER_REST),
)


def bucket_for_tags(tags: Mapping[str, object]) -> Bucket | None:
    """Map a POI's raw OSM tags to one display bucket, or ``None`` if unwhitelisted.

    Everything not on the curated whitelist is dropped (returns ``None``) — we
    fetch a small, rideable set, not "all of OSM".
    """
    for key, value, bucket in _RULES:
        if key not in tags:
            continue
        if value is _ANY or str(tags[key]) == value:
            return bucket
    return None


@dataclass(frozen=True)
class SelectionConfig:
    """Tunable POI selection policy (feature §6, §8). Re-tune without code change.

    Attributes
    ----------
    radius_m:
        Per-bucket detour radius (metres) for ``ST_DWithin``. Stop-types use a
        tight radius (you'd only detour a little); scenic/landmark reach farther.
    max_per_route:
        Hard cap on total POIs kept per route (the urban density fix).
    max_per_bucket:
        Hard cap per bucket so one dense category can't crowd out the rest.
    freshness_days:
        p6 skips POIs refreshed within this window (§8 re-runnable batch).
    """

    radius_m: Mapping[Bucket, float]
    max_per_route: int = 15
    max_per_bucket: int = 4
    freshness_days: int = 90


# Stop-types ~150 m (café, water, rest, bike repair — a short detour); scenic and
# landmark ~400 m (a viewpoint or peak is worth seeing from farther).
_STOP_RADIUS_M = 150.0
_SCENIC_RADIUS_M = 400.0

DEFAULT_CONFIG = SelectionConfig(
    radius_m={
        Bucket.COFFEE_FOOD: _STOP_RADIUS_M,
        Bucket.WATER_REST: _STOP_RADIUS_M,
        Bucket.BIKE_SERVICES: _STOP_RADIUS_M,
        Bucket.SCENIC: _SCENIC_RADIUS_M,
        Bucket.LANDMARK: _SCENIC_RADIUS_M,
    },
)
