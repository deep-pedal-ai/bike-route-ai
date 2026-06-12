"""Socrata client — NYC DOT facility GeoJSON, paged + disk-cached.

NYC Open Data (data.cityofnewyork.us) serves the NYC DOT Bicycle Routes dataset
``mzxg-pwib`` via the Socrata GeoJSON export endpoint
``/resource/{dataset}.geojson``. The export is paged with ``$limit`` / ``$offset``
and filtered server-side with a SoQL ``$where`` (Phase 3 passes
``status='Current'`` so retired facilities never leave the server — Q7b).

:meth:`SocrataClient.fetch_geojson` walks every page and returns a single GeoJSON
``FeatureCollection`` with the concatenated features. Each page is disk-cached
(:class:`DiskCache`) keyed on dataset + where + offset, and a descriptive
``User-Agent`` is sent (mirrors the other clients).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import httpx

from freewheel_corpus.cache import DiskCache

# Socrata caps a single GeoJSON page; 50000 is the documented export maximum.
PAGE_SIZE = 50000

DEFAULT_USER_AGENT = "freewheel-corpus/0.1 (bike-route-ai; +https://github.com/deep-pedal-ai)"

_CACHE_CLIENT = "socrata"

# (url, params) -> parsed GeoJSON dict
Transport = Callable[[str, dict[str, Any]], Any]


def _http_transport(timeout: float) -> Transport:
    """Build the default HTTP transport: GET the Socrata GeoJSON export."""

    def _get(url: str, params: dict[str, Any]) -> Any:
        resp = httpx.get(
            url,
            params=params,
            headers={"User-Agent": DEFAULT_USER_AGENT},
            timeout=timeout,
        )
        resp.raise_for_status()
        return resp.json()

    return _get


class SocrataClient:
    """Paged, disk-cached Socrata GeoJSON-export client.

    Parameters mirror the other clients: an injectable ``transport``
    (``(url, params) -> geojson``) so tests avoid the network, and a
    :class:`DiskCache` keyed on the page request so a re-run replays for free.
    """

    def __init__(
        self,
        cache: DiskCache | None = None,
        *,
        base_url: str = "https://data.cityofnewyork.us",
        transport: Transport | None = None,
        timeout: float = 120.0,
        page_size: int = PAGE_SIZE,
    ) -> None:
        self.cache = cache if cache is not None else DiskCache()
        self.base_url = base_url
        self._transport = transport or _http_transport(timeout)
        self.page_size = page_size

    def _resource_url(self, dataset: str) -> str:
        return f"{self.base_url.rstrip('/')}/resource/{dataset}.geojson"

    def _fetch_page(
        self, dataset: str, *, where: str | None, offset: int, no_cache: bool
    ) -> Any:
        url = self._resource_url(dataset)
        params: dict[str, Any] = {"$limit": self.page_size, "$offset": offset}
        if where:
            params["$where"] = where
        request_key = {
            "client": _CACHE_CLIENT,
            "dataset": dataset,
            "where": where,
            "offset": offset,
            "limit": self.page_size,
        }

        if not no_cache:
            cached = self.cache.get(_CACHE_CLIENT, request_key)
            if cached is not None:
                return cached

        payload = self._transport(url, params)
        self.cache.set(_CACHE_CLIENT, request_key, payload)
        return payload

    def fetch_geojson(
        self, dataset: str, *, where: str | None = None, no_cache: bool = False
    ) -> dict[str, Any]:
        """Fetch every page of a Socrata dataset as one GeoJSON FeatureCollection.

        Walks ``$offset`` in ``page_size`` steps until a page returns fewer than
        ``page_size`` features. ``where`` is a SoQL filter applied server-side.
        """
        features: list[dict[str, Any]] = []
        offset = 0
        while True:
            payload = self._fetch_page(
                dataset, where=where, offset=offset, no_cache=no_cache
            )
            page = payload.get("features", []) or []
            features.extend(page)
            if len(page) < self.page_size:
                break
            offset += len(page)
        return {"type": "FeatureCollection", "features": features}
