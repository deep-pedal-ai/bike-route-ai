"""Valhalla client — POST ``/trace_attributes`` for bicycle map-matching.

Mirrors the Overpass client pattern (PLAN §WP2): throttle **1 request / 1 s**
single-threaded, an injectable clock so the throttle is testable without real
delay, the ``X-Client-Id: freewheel-corpus`` header the public FOSSGIS endpoint
asks third-party clients to send, and a disk cache (:class:`DiskCache`) keyed on
the request body so a re-run replays for free.

The matching request uses ``costing=bicycle`` and ``shape_match=map_snap`` so
Valhalla snaps the raw shape to the OSM graph and returns per-edge attributes
(``surface``, ``use``, ``length``) that Phase 2 turns into the breakdown columns.
The base URL comes from settings (default a public FOSSGIS Valhalla); the
throttle wraps the **network fetch only** — a cache hit incurs zero wait.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

import httpx

from freewheel_corpus.cache import DiskCache

# Public-endpoint etiquette: one request per second.
MIN_REQUEST_INTERVAL_S = 1.0

# The FOSSGIS public Valhalla asks third-party clients to identify themselves.
VALHALLA_CLIENT_ID = "freewheel-corpus"
DEFAULT_USER_AGENT = "freewheel-corpus/0.1 (bike-route-ai; +https://github.com/deep-pedal-ai)"

_CACHE_CLIENT = "valhalla"

Transport = Callable[[dict[str, Any]], Any]


def _http_transport(base_url: str, timeout: float) -> Transport:
    """Build the default HTTP transport: POST the trace body to /trace_attributes."""
    url = base_url.rstrip("/") + "/trace_attributes"

    def _post(body: dict[str, Any]) -> Any:
        resp = httpx.post(
            url,
            json=body,
            headers={
                "User-Agent": DEFAULT_USER_AGENT,
                "X-Client-Id": VALHALLA_CLIENT_ID,
                "Content-Type": "application/json",
            },
            timeout=timeout,
        )
        resp.raise_for_status()
        return resp.json()

    return _post


class ValhallaClient:
    """Throttled, disk-cached Valhalla ``/trace_attributes`` client.

    Parameters mirror :class:`~freewheel_corpus.clients.overpass.OverpassClient`:
    an injectable ``transport`` (``body -> json``) for tests, an injectable
    monotonic ``now`` / ``sleep`` so the 1 req/s throttle is exercised without
    real delay, and a :class:`DiskCache` keyed on the request body.
    """

    def __init__(
        self,
        cache: DiskCache | None = None,
        *,
        base_url: str = "https://valhalla1.openstreetmap.de",
        transport: Transport | None = None,
        now: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        timeout: float = 60.0,
    ) -> None:
        self.cache = cache if cache is not None else DiskCache()
        self.base_url = base_url
        self._transport = transport or _http_transport(base_url, timeout)
        self._now = now
        self._sleep = sleep
        self._last_request_at: float | None = None

    def trace_attributes(
        self, shape: list[dict[str, float]], *, no_cache: bool = False
    ) -> Any:
        """Map-match ``shape`` (a list of ``{"lat", "lon"}`` points) and return
        the parsed ``trace_attributes`` JSON (cached + throttled).

        The body is fixed to ``costing=bicycle`` / ``shape_match=map_snap``; the
        cache key is the full body, so the same shape replays for free.
        """
        body = {
            "shape": shape,
            "costing": "bicycle",
            "shape_match": "map_snap",
        }
        request_key = {"client": _CACHE_CLIENT, "body": body}

        if not no_cache:
            cached = self.cache.get(_CACHE_CLIENT, request_key)
            if cached is not None:
                return cached

        self._throttle()
        payload = self._transport(body)
        self._last_request_at = self._now()
        self.cache.set(_CACHE_CLIENT, request_key, payload)
        return payload

    def _throttle(self) -> None:
        """Sleep just long enough to honour 1 request / 1 s between fetches."""
        if self._last_request_at is None:
            return
        elapsed = self._now() - self._last_request_at
        wait = MIN_REQUEST_INTERVAL_S - elapsed
        if wait > 0:
            self._sleep(wait)
