"""Overpass API client — POST an Overpass QL query, throttled + disk-cached.

Etiquette (PLAN §WP1): **1 request / 10 s, single-threaded**, and a descriptive
``User-Agent`` (the public endpoint returns **HTTP 406** without one). Every
response is disk-cached via :class:`~freewheel_corpus.cache.DiskCache`; a re-run
replays from cache for free.

The throttle wraps the **network fetch only** — a cache hit incurs zero wait, so
replaying the full metro corpus from cache does not sleep once per relation. The
clock (``now``) and ``sleep`` are injectable so tests drive virtual time and
never sleep in real seconds.
"""

from __future__ import annotations

import time
import urllib.parse
from collections.abc import Callable
from typing import Any

import httpx
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from freewheel_corpus.cache import DiskCache

# Public-endpoint etiquette: one request per 10 seconds.
MIN_REQUEST_INTERVAL_S = 10.0

# The public endpoint rejects requests without a descriptive User-Agent (406).
DEFAULT_USER_AGENT = "freewheel-corpus/0.1 (bike-route-ai; +https://github.com/deep-pedal-ai)"

_CACHE_CLIENT = "overpass"

# The public Overpass endpoint intermittently returns these under load — most
# commonly 504 Gateway Timeout. They're transient: a backed-off retry usually
# lands on a healthy backend. Other 4xx (e.g. 400 bad query) are NOT retried.
_TRANSIENT_STATUSES = frozenset({429, 502, 503, 504})
_RETRY_ATTEMPTS = 4

Transport = Callable[[str], Any]


def _is_transient_error(exc: BaseException) -> bool:
    """True for retryable Overpass failures: transient 5xx/429 or transport errors."""
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in _TRANSIENT_STATUSES
    return isinstance(exc, httpx.TransportError)  # timeouts, connection resets


def _http_transport(base_url: str, timeout: float) -> Transport:
    """Build the default HTTP transport: POST the query as ``data=`` form body.

    Retries transient endpoint failures (504 et al.) with exponential backoff
    (~5s, 10s, 20s over 4 attempts); after exhausting them the last error is
    re-raised so the caller (p6) logs the route and moves on.
    """

    @retry(
        retry=retry_if_exception(_is_transient_error),
        stop=stop_after_attempt(_RETRY_ATTEMPTS),
        wait=wait_exponential(multiplier=5, min=5, max=60),
        reraise=True,
    )
    def _post(query: str) -> Any:
        body = urllib.parse.urlencode({"data": query})
        resp = httpx.post(
            base_url,
            content=body,
            headers={
                "User-Agent": DEFAULT_USER_AGENT,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            timeout=timeout,
        )
        resp.raise_for_status()
        return resp.json()

    return _post


class OverpassClient:
    """Throttled, disk-cached Overpass QL client.

    Parameters
    ----------
    cache:
        The :class:`DiskCache` used to store/replay responses.
    base_url:
        Overpass interpreter endpoint (from settings; defaults to the public one).
    transport:
        Injectable ``query -> json`` callable (real HTTP by default; tests pass a
        fake to avoid the network).
    now / sleep:
        Injectable monotonic clock + sleep so the throttle is testable without
        real-time delay.
    timeout:
        Per-request HTTP timeout (seconds) for the default transport.
    """

    def __init__(
        self,
        cache: DiskCache | None = None,
        *,
        base_url: str = "https://overpass-api.de/api/interpreter",
        transport: Transport | None = None,
        now: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        timeout: float = 180.0,
    ) -> None:
        self.cache = cache if cache is not None else DiskCache()
        self.base_url = base_url
        self._transport = transport or _http_transport(base_url, timeout)
        self._now = now
        self._sleep = sleep
        self._last_request_at: float | None = None

    def query(self, ql: str, *, no_cache: bool = False) -> Any:
        """Run an Overpass QL query, returning parsed JSON (cached + throttled).

        The cache is keyed on the query string. On a cache miss the throttle is
        enforced before the network fetch; a cache hit returns immediately with
        no wait.
        """
        request_key = {"client": _CACHE_CLIENT, "query": ql}

        if not no_cache:
            cached = self.cache.get(_CACHE_CLIENT, request_key)
            if cached is not None:
                return cached

        self._throttle()
        payload = self._transport(ql)
        self._last_request_at = self._now()
        self.cache.set(_CACHE_CLIENT, request_key, payload)
        return payload

    def _throttle(self) -> None:
        """Sleep just long enough to honour 1 request / 10 s between fetches."""
        if self._last_request_at is None:
            return
        elapsed = self._now() - self._last_request_at
        wait = MIN_REQUEST_INTERVAL_S - elapsed
        if wait > 0:
            self._sleep(wait)
