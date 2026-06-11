"""TDD: ORS client (WP4 behaviors 5 + client plumbing).

Mirrors the Overpass/Valhalla client pattern: an injectable ``transport``
(``(endpoint, body) -> json``) so tests never hit the network, an injectable
monotonic clock + sleep so the **40 req/min** throttle is exercised without real
delay, and a :class:`DiskCache` keyed on (endpoint, body) so a re-run replays for
free and the daily quota is protected.

WP4-specific:
- **Per-endpoint daily request counters, PERSISTED to disk** (Q4) so they survive
  a process restart. The counter increments ONLY on a real network fetch, never
  on a cache hit (otherwise re-runs would burn phantom quota).
- **Quota exhaustion** → the client raises :class:`OrsQuotaExceeded` (the phase
  catches it and the CLI maps it to a graceful exit 0 + "resume tomorrow"),
  resumable because every prior response is cached.
"""

from __future__ import annotations

import pytest

from freewheel_corpus.cache import DiskCache
from freewheel_corpus.clients.ors import (
    DIRECTIONS_ENDPOINT,
    OrsClient,
    OrsQuotaExceeded,
)


class FakeClock:
    """A controllable monotonic clock + sleep that advances virtual time."""

    def __init__(self) -> None:
        self.t = 0.0
        self.slept: list[float] = []

    def now(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.t += seconds


def _feature_collection(distance_m: float = 4000.0):
    """A minimal ORS directions GeoJSON FeatureCollection."""
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[-73.98, 40.75, 10.0], [-73.95, 40.75, 12.0]],
                },
                "properties": {
                    "summary": {"distance": distance_m, "duration": 900.0},
                    "ascent": 5.0,
                    "descent": 5.0,
                    "extras": {},
                },
            }
        ],
    }


def _client(tmp_path, transport, *, counter_path=None, daily_limit=2000, clock=None):
    clock = clock or FakeClock()
    return OrsClient(
        cache=DiskCache(base_dir=tmp_path),
        api_key="test-key",
        transport=transport,
        now=clock.now,
        sleep=clock.sleep,
        counter_path=counter_path or (tmp_path / "ors_counters.json"),
        daily_limit=daily_limit,
    ), clock


def test_directions_caches_and_replays(tmp_path):
    """A directions request is fetched once, cached, replayed for the same call."""
    calls = {"n": 0}

    def transport(endpoint, body):
        calls["n"] += 1
        return _feature_collection()

    client, _ = _client(tmp_path, transport)
    coords = [(-73.98, 40.75), (-73.95, 40.75)]

    first = client.directions(coords)
    second = client.directions(coords)

    assert first == second  # replayed from disk
    assert calls["n"] == 1  # network hit exactly once


def test_directions_sends_extras_elevation_and_profile(tmp_path):
    """The request body carries elevation=true, the three extra_info types, and
    the coordinates; the endpoint embeds the per-profile path."""
    captured = {}

    def transport(endpoint, body):
        captured["endpoint"] = endpoint
        captured["body"] = body
        return _feature_collection()

    client, _ = _client(tmp_path, transport)
    coords = [(-73.98, 40.75), (-73.95, 40.75)]
    client.directions(coords, profile="cycling-regular", no_cache=True)

    assert "cycling-regular" in captured["endpoint"]
    assert captured["body"]["elevation"] is True
    assert set(captured["body"]["extra_info"]) == {"surface", "waytype", "steepness"}
    # coords are sent as [lon, lat] lists.
    assert captured["body"]["coordinates"] == [[-73.98, 40.75], [-73.95, 40.75]]


def test_round_trip_directions_sends_options(tmp_path):
    """A round-trip request sends options.round_trip{length,points,seed} with a
    single start coordinate."""
    captured = {}

    def transport(endpoint, body):
        captured["body"] = body
        return _feature_collection()

    client, _ = _client(tmp_path, transport)
    client.round_trip((-73.98, 40.75), length_m=15000, points=5, seed=3, no_cache=True)

    rt = captured["body"]["options"]["round_trip"]
    assert rt == {"length": 15000, "points": 5, "seed": 3}
    assert captured["body"]["coordinates"] == [[-73.98, 40.75]]


def test_throttle_40_per_minute(tmp_path):
    """Consecutive *network* fetches are throttled to >= 1.5 s apart (40/min)."""
    def transport(endpoint, body):
        return _feature_collection()

    client, clock = _client(tmp_path, transport)
    client.directions([(-73.98, 40.75), (-73.95, 40.75)], no_cache=True)
    client.directions([(-73.97, 40.75), (-73.94, 40.75)], no_cache=True)

    assert clock.slept, "second fetch should have been throttled"
    assert clock.slept[0] >= 60.0 / 40  # 40 requests / minute


def test_cache_hit_incurs_no_throttle(tmp_path):
    """Replaying a cached directions call does NOT trigger the throttle."""
    def transport(endpoint, body):
        return _feature_collection()

    client, clock = _client(tmp_path, transport)
    coords = [(-73.98, 40.75), (-73.95, 40.75)]
    client.directions(coords)
    waits_after_first = len(clock.slept)
    client.directions(coords)  # cache hit
    client.directions(coords)  # cache hit

    assert len(clock.slept) == waits_after_first  # no additional waits


def test_per_endpoint_counter_increments_on_network_only(tmp_path):
    """The daily counter increments on a real fetch, NOT on a cache hit (Q4)."""
    def transport(endpoint, body):
        return _feature_collection()

    counter_path = tmp_path / "counters.json"
    client, _ = _client(tmp_path, transport, counter_path=counter_path)
    coords = [(-73.98, 40.75), (-73.95, 40.75)]

    client.directions(coords)  # network → count 1
    client.directions(coords)  # cache hit → no increment

    assert client.count_today(DIRECTIONS_ENDPOINT) == 1


def test_counter_persists_across_process_restart(tmp_path):
    """A NEW client instance reading the same counter file sees prior counts
    (counters survive a process restart — the resumability guarantee)."""
    def transport(endpoint, body):
        return _feature_collection()

    counter_path = tmp_path / "counters.json"
    client1, _ = _client(tmp_path, transport, counter_path=counter_path)
    client1.directions([(-73.98, 40.75), (-73.95, 40.75)], no_cache=True)
    client1.directions([(-73.97, 40.75), (-73.94, 40.75)], no_cache=True)
    assert client1.count_today(DIRECTIONS_ENDPOINT) == 2

    # Brand-new client (simulates a fresh process) reading the same file.
    client2, _ = _client(tmp_path, transport, counter_path=counter_path)
    assert client2.count_today(DIRECTIONS_ENDPOINT) == 2


def test_near_quota_raises_before_fetching(tmp_path):
    """When the day's count has reached the daily limit, the next network fetch
    raises OrsQuotaExceeded BEFORE calling the transport (no wasted call)."""
    calls = {"n": 0}

    def transport(endpoint, body):
        calls["n"] += 1
        return _feature_collection()

    counter_path = tmp_path / "counters.json"
    client, _ = _client(tmp_path, transport, counter_path=counter_path, daily_limit=2)

    client.directions([(-73.98, 40.75), (-73.95, 40.75)], no_cache=True)  # 1
    client.directions([(-73.97, 40.75), (-73.94, 40.75)], no_cache=True)  # 2 (at limit)
    with pytest.raises(OrsQuotaExceeded):
        client.directions([(-73.96, 40.75), (-73.93, 40.75)], no_cache=True)  # blocked

    assert calls["n"] == 2  # the blocked call never reached the transport


def test_cache_hit_works_even_at_quota(tmp_path):
    """A cached response replays even when the quota is exhausted — this is what
    makes a resumed run cheap (it serves everything already fetched)."""
    def transport(endpoint, body):
        return _feature_collection()

    counter_path = tmp_path / "counters.json"
    client, _ = _client(tmp_path, transport, counter_path=counter_path, daily_limit=1)
    coords = [(-73.98, 40.75), (-73.95, 40.75)]
    client.directions(coords, no_cache=True)  # caches it, count → 1 (at limit)

    # Quota is now exhausted, but the cached coords still replay without raising.
    again = client.directions(coords)
    assert again["features"][0]["properties"]["summary"]["distance"] == 4000.0
