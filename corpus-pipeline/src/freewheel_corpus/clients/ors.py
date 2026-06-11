"""openrouteservice (ORS) client — ``/v2/directions``, throttled + disk-cached.

Mirrors the Overpass / Valhalla client pattern (injectable ``transport`` +
clock + :class:`DiskCache`), with the WP4-specific quota machinery ORS needs:

- **Per-profile directions** (``/v2/directions/{profile}/geojson``) requesting
  ``extra_info=[surface,waytype,steepness]`` + ``elevation=true``, plus a
  **round-trip** variant (``options.round_trip{length,points,seed}``). Per Q4 the
  ascent/descent come from this directions output — there is NO separate
  ``/elevation/line`` call (that protects the tight elevation quota).
- **Per-endpoint daily request counters, persisted to disk** (Q4): ORS enforces
  quotas per endpoint, and the counters must survive a process restart so a
  resumed run knows how much budget remains today. The counter increments ONLY on
  a real network fetch (a cache hit is free and must not burn phantom quota).
- **Throttle 40 requests / minute** (the free-tier rate limit), wrapping the
  network fetch only.
- On quota exhaustion the client raises :class:`OrsQuotaExceeded` BEFORE the
  fetch; the phase catches it and the CLI exits 0 with a "resume tomorrow"
  message. Because every prior response is cached, the resumed run replays for
  free up to the point it stopped (PLAN §10 resumability).

The ``User-Agent`` is descriptive (mirrors the other clients); the API key goes
in the ``Authorization`` header per the ORS HTTP API.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any

import httpx

from freewheel_corpus.cache import DiskCache

# Free-tier rate limit: 40 requests / minute → >= 1.5 s between network fetches.
MAX_REQUESTS_PER_MINUTE = 40
MIN_REQUEST_INTERVAL_S = 60.0 / MAX_REQUESTS_PER_MINUTE

# Free-tier directions daily quota (the default; override via settings/ctor).
DEFAULT_DAILY_LIMIT = 2000

# Logical endpoint key the per-endpoint counter is bucketed under. Both plain and
# round-trip directions hit the same ORS directions quota, so they share a key.
DIRECTIONS_ENDPOINT = "v2/directions"

DEFAULT_USER_AGENT = "freewheel-corpus/0.1 (bike-route-ai; +https://github.com/deep-pedal-ai)"

_CACHE_CLIENT = "ors"

# (endpoint, body) -> parsed json
Transport = Callable[[str, dict[str, Any]], Any]


class OrsQuotaExceeded(RuntimeError):
    """Raised when an ORS endpoint's daily request quota is exhausted.

    The phase catches this and the CLI maps it to a graceful exit 0 with a
    "resume tomorrow" message — it is an expected PAUSE, not a failure (PLAN §10).
    """

    def __init__(self, endpoint: str, count: int, limit: int) -> None:
        self.endpoint = endpoint
        self.count = count
        self.limit = limit
        super().__init__(
            f"ORS daily quota reached for endpoint '{endpoint}': {count}/{limit} "
            f"requests used today. Resume tomorrow — cached responses replay for "
            f"free, so the run picks up where it stopped."
        )


def _http_transport(base_url: str, api_key: str, timeout: float) -> Transport:
    """Build the default HTTP transport: POST the body to the directions endpoint."""

    def _post(endpoint_path: str, body: dict[str, Any]) -> Any:
        url = base_url.rstrip("/") + "/" + endpoint_path.lstrip("/")
        resp = httpx.post(
            url,
            json=body,
            headers={
                "Authorization": api_key,
                "Content-Type": "application/json; charset=utf-8",
                "Accept": "application/geo+json",
                "User-Agent": DEFAULT_USER_AGENT,
            },
            timeout=timeout,
        )
        resp.raise_for_status()
        return resp.json()

    return _post


class _DailyCounters:
    """Per-endpoint daily request counters, persisted to a JSON file.

    Stored as ``{"date": "YYYY-MM-DD", "counts": {endpoint: n}}``. A read on a new
    day returns 0 for every endpoint (the file's date no longer matches today),
    so counters reset at midnight without any cron. Persisted so a fresh process
    sees prior counts — the resumability guarantee.
    """

    def __init__(self, path: Path, today: Callable[[], str]) -> None:
        self._path = path
        self._today = today

    def _load(self) -> dict[str, Any]:
        if not self._path.exists():
            return {"date": self._today(), "counts": {}}
        data = json.loads(self._path.read_text())
        if data.get("date") != self._today():
            return {"date": self._today(), "counts": {}}
        return data

    def get(self, endpoint: str) -> int:
        return int(self._load()["counts"].get(endpoint, 0))

    def increment(self, endpoint: str) -> int:
        data = self._load()
        counts = data["counts"]
        counts[endpoint] = int(counts.get(endpoint, 0)) + 1
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps(data))
        return counts[endpoint]


class OrsClient:
    """Throttled, disk-cached, quota-aware ORS ``/v2/directions`` client."""

    def __init__(
        self,
        cache: DiskCache | None = None,
        *,
        api_key: str,
        base_url: str = "https://api.openrouteservice.org",
        transport: Transport | None = None,
        now: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        timeout: float = 60.0,
        counter_path: Path | str | None = None,
        daily_limit: int = DEFAULT_DAILY_LIMIT,
        today: Callable[[], str] | None = None,
    ) -> None:
        self.cache = cache if cache is not None else DiskCache()
        self.base_url = base_url
        self._transport = transport or _http_transport(base_url, api_key, timeout)
        self._now = now
        self._sleep = sleep
        self._last_request_at: float | None = None
        self.daily_limit = daily_limit
        counter_path = (
            Path(counter_path)
            if counter_path is not None
            else Path("data") / "raw" / "ors_counters.json"
        )
        self._counters = _DailyCounters(
            counter_path, today or (lambda: date.today().isoformat())
        )

    # --- public quota introspection -----------------------------------------
    def count_today(self, endpoint: str = DIRECTIONS_ENDPOINT) -> int:
        """Today's request count for an endpoint (0 on a new day)."""
        return self._counters.get(endpoint)

    # --- directions ----------------------------------------------------------
    def directions(
        self,
        coords: list[tuple[float, float]],
        *,
        profile: str = "cycling-regular",
        no_cache: bool = False,
    ) -> Any:
        """Route through ``coords`` (``(lon, lat)`` tuples), returning the GeoJSON.

        Always requests ``elevation=true`` + ``extra_info`` for the three RLE
        breakdowns (Q4 — ascent/descent come from this output, no /elevation/line).
        """
        body = {
            "coordinates": [[lon, lat] for lon, lat in coords],
            "elevation": True,
            "extra_info": ["surface", "waytype", "steepness"],
        }
        endpoint_path = f"v2/directions/{profile}/geojson"
        return self._request(endpoint_path, body, no_cache=no_cache)

    def round_trip(
        self,
        start: tuple[float, float],
        *,
        length_m: int,
        points: int = 5,
        seed: int = 0,
        profile: str = "cycling-regular",
        no_cache: bool = False,
    ) -> Any:
        """Generate a round-trip loop from ``start`` (``(lon, lat)``) of ~``length_m``.

        Uses ``options.round_trip{length,points,seed}``; same extras + elevation
        as :meth:`directions`.
        """
        lon, lat = start
        body = {
            "coordinates": [[lon, lat]],
            "elevation": True,
            "extra_info": ["surface", "waytype", "steepness"],
            "options": {
                "round_trip": {"length": length_m, "points": points, "seed": seed}
            },
        }
        endpoint_path = f"v2/directions/{profile}/geojson"
        return self._request(endpoint_path, body, no_cache=no_cache)

    # --- request plumbing ----------------------------------------------------
    def _request(
        self, endpoint_path: str, body: dict[str, Any], *, no_cache: bool
    ) -> Any:
        """Cache → quota-check → throttle → fetch → count. Shared by both calls.

        A cache hit returns immediately, never touching the quota or the throttle
        (this is what makes a resumed run free). On a miss the daily counter is
        checked BEFORE the network call; if at/over the limit we raise rather than
        waste a request, and the increment happens only after a successful fetch.
        """
        request_key = {"client": _CACHE_CLIENT, "endpoint": endpoint_path, "body": body}

        if not no_cache:
            cached = self.cache.get(_CACHE_CLIENT, request_key)
            if cached is not None:
                return cached

        # Quota gate (before the fetch — never waste a call we can't afford).
        used = self._counters.get(DIRECTIONS_ENDPOINT)
        if used >= self.daily_limit:
            raise OrsQuotaExceeded(DIRECTIONS_ENDPOINT, used, self.daily_limit)

        self._throttle()
        payload = self._transport(endpoint_path, body)
        self._last_request_at = self._now()
        self._counters.increment(DIRECTIONS_ENDPOINT)  # network fetch only
        self.cache.set(_CACHE_CLIENT, request_key, payload)
        return payload

    def _throttle(self) -> None:
        """Sleep just long enough to honour 40 requests / minute between fetches."""
        if self._last_request_at is None:
            return
        elapsed = self._now() - self._last_request_at
        wait = MIN_REQUEST_INTERVAL_S - elapsed
        if wait > 0:
            self._sleep(wait)
