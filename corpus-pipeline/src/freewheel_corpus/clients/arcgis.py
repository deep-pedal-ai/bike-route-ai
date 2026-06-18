"""ArcGIS FeatureServer client — NYSDOT State Bike Routes, paginated + disk-cached.

The NYSDOT State Bike Routes layer lives on the NY DOT GIS portal (verified live
2026-06-11): ``gisportalny.dot.ny.gov/hostingny/rest/services`` (the ``/hostingny``
host, NOT the dev/``/arcgis`` portal). The client appends the layer path
``Framework/State_Bike_Routes/FeatureServer/0/query`` and requests ``f=geojson``.

ArcGIS paginates a FeatureServer query with ``resultOffset`` / ``resultRecordCount``
and signals more pages with ``properties.exceededTransferLimit: true`` on the
GeoJSON response (or ``exceededTransferLimit`` at the top level on some servers);
:meth:`ArcGISClient.fetch_all_features` walks every page and concatenates the
features. Each page is disk-cached (:class:`DiskCache`) keyed on the query params,
and a descriptive ``User-Agent`` is sent (mirrors the other clients).

:func:`clip_feature_to_metro` intersects a feature's geometry with the metro
boundary polygon and returns a single ``LineString`` (the longest connected
component, like ``assemble_relation``) plus the feature's properties, or ``None``
when the feature does not intersect metro. Returning a single ``LineString`` is a
hard contract: Phase 2 feeds ``clipped.geom`` straight into ``match_route`` (which
is LineString-only) and reads ``clipped.geom.coords[0]``.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx
from shapely.geometry import LineString, MultiLineString, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import linemerge
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from freewheel_corpus.cache import DiskCache
from freewheel_corpus.metro import load_metro_boundary

# The State Bike Routes layer path appended to the services base URL.
LAYER_PATH = "Framework/State_Bike_Routes/FeatureServer/0/query"

# ArcGIS caps a single page; 1000 is the usual server maxRecordCount. We page
# until exceededTransferLimit clears.
PAGE_SIZE = 1000

DEFAULT_USER_AGENT = "freewheel-corpus/0.1 (bike-route-ai; +https://github.com/deep-pedal-ai)"

_CACHE_CLIENT = "arcgis"

# A paginated ArcGIS fetch intermittently fails mid-walk: a real Seattle SDOT run
# hit "Server disconnected without sending a response" (httpx.RemoteProtocolError)
# and a manual re-run then succeeded with no other change — i.e. transient. The
# transport now backs off and retries these, mirroring the Overpass client. The
# transient-5xx set and the retry count/backoff are deliberately the SAME as
# overpass.py so the two clients stay consistent (see overpass._TRANSIENT_STATUSES).
_TRANSIENT_STATUSES = frozenset({429, 502, 503, 504})
_RETRY_ATTEMPTS = 4

# (query_url, params) -> parsed GeoJSON dict
Transport = Callable[[str, dict[str, Any]], Any]


def _is_transient_error(exc: BaseException) -> bool:
    """True for retryable ArcGIS failures: transient 5xx/429 or transport errors.

    ``httpx.TransportError`` covers the connection drops the live run hit —
    ``RemoteProtocolError`` ("server disconnected without sending a response"),
    ``ConnectError``/``ReadError``, and the timeout family are all subclasses.
    Non-transient 4xx (e.g. a bad query) are NOT retried.
    """
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in _TRANSIENT_STATUSES
    return isinstance(exc, httpx.TransportError)  # drops, timeouts, connection resets


def _http_transport(timeout: float) -> Transport:
    """Build the default HTTP transport: GET the FeatureServer query as GeoJSON.

    Retries transient endpoint failures (connection drops, 504 et al.) with
    exponential backoff (~5s, 10s, 20s over 4 attempts); after exhausting them
    the last error is re-raised so the caller surfaces the failure. Matches the
    Overpass client's backoff config.
    """

    @retry(
        retry=retry_if_exception(_is_transient_error),
        stop=stop_after_attempt(_RETRY_ATTEMPTS),
        wait=wait_exponential(multiplier=5, min=5, max=60),
        reraise=True,
    )
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


class ArcGISClient:
    """Paginated, disk-cached ArcGIS FeatureServer client (NYSDOT bike routes).

    Parameters mirror the other clients: an injectable ``transport``
    (``(url, params) -> geojson``) so tests avoid the network, and a
    :class:`DiskCache` keyed on the page params so a re-run replays for free.
    """

    def __init__(
        self,
        cache: DiskCache | None = None,
        *,
        base_url: str = "https://gisportalny.dot.ny.gov/hostingny/rest/services",
        layer_path: str = LAYER_PATH,
        transport: Transport | None = None,
        timeout: float = 120.0,
        page_size: int = PAGE_SIZE,
    ) -> None:
        # ``layer_path`` is region-specific (RegionProfile.arcgis_layer_path):
        # NYSDOT State Bike Routes for NY, WSDOT designated routes for Seattle.
        # Defaults to the NY layer so existing callers are unchanged.
        self.cache = cache if cache is not None else DiskCache()
        self.base_url = base_url
        self.query_url = base_url.rstrip("/") + "/" + layer_path
        self._transport = transport or _http_transport(timeout)
        self.page_size = page_size

    def _fetch_page(self, offset: int, *, no_cache: bool) -> Any:
        params = {
            "where": "1=1",
            "outFields": "*",
            "f": "geojson",
            "resultOffset": offset,
            "resultRecordCount": self.page_size,
            "outSR": 4326,
        }
        request_key = {"client": _CACHE_CLIENT, "url": self.query_url, "params": params}

        if not no_cache:
            cached = self.cache.get(_CACHE_CLIENT, request_key)
            if cached is not None:
                return cached

        payload = self._transport(self.query_url, params)
        self.cache.set(_CACHE_CLIENT, request_key, payload)
        return payload

    def fetch_all_features(self, *, no_cache: bool = False) -> list[dict[str, Any]]:
        """Walk every page via ``resultOffset`` and return the combined features.

        Stops when a page reports no ``exceededTransferLimit`` (or returns fewer
        than ``page_size`` features). Each page is cached independently.

        A 404 response is treated as an empty layer (the placeholder URL for
        regions whose P2 source has not yet been discovered returns 404).
        """
        features: list[dict[str, Any]] = []
        offset = 0
        while True:
            try:
                payload = self._fetch_page(offset, no_cache=no_cache)
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 404:
                    break  # layer not found — treat as empty, not an error
                raise
            page = payload.get("features", []) or []
            features.extend(page)

            exceeded = bool(
                payload.get("exceededTransferLimit")
                or (payload.get("properties") or {}).get("exceededTransferLimit")
            )
            if not exceeded or not page:
                break
            offset += len(page)
        return features


# --- Clip to metro -----------------------------------------------------------

@dataclass
class ClippedFeature:
    """A feature clipped to metro: a single ``LineString`` + its properties."""

    geom: LineString
    properties: dict[str, Any]


def _longest_linestring(geom: BaseGeometry) -> LineString | None:
    """Reduce a (possibly Multi) line geometry to its longest ``LineString``.

    A polygon intersection commonly yields a ``MultiLineString``; Phase 2 needs a
    single ``LineString`` (``match_route`` is LineString-only). We ``linemerge``
    first (folds exactly-touching pieces) and then keep the longest component, the
    same lossy-but-safe rule ``assemble_relation`` uses.
    """
    if geom.is_empty:
        return None
    if isinstance(geom, LineString):
        return geom
    if isinstance(geom, MultiLineString):
        merged = linemerge(geom)
        if isinstance(merged, LineString):
            return merged if not merged.is_empty else None
        if isinstance(merged, MultiLineString) and not merged.is_empty:
            return max(merged.geoms, key=lambda g: g.length)
        return None
    # A GeometryCollection (mixed) — pull any line parts out.
    lines = [g for g in getattr(geom, "geoms", []) if isinstance(g, LineString)]
    if not lines:
        return None
    return max(lines, key=lambda g: g.length)


def clip_feature_to_metro(
    feature: dict[str, Any], boundary: BaseGeometry | None = None
) -> ClippedFeature | None:
    """Clip a GeoJSON feature's line geometry to the metro polygon.

    Returns a :class:`ClippedFeature` (single longest ``LineString`` inside metro
    + the feature's properties) or ``None`` when the feature does not intersect
    the metro boundary. The boundary defaults to the committed
    ``config/metro_boundary.geojson`` (loaded once per call; cheap).
    """
    geom_json = feature.get("geometry")
    if not geom_json:
        return None
    geom = shape(geom_json)
    metro = boundary if boundary is not None else load_metro_boundary()

    if not geom.intersects(metro):
        return None
    clipped = geom.intersection(metro)
    line = _longest_linestring(clipped)
    if line is None or line.is_empty or len(line.coords) < 2:
        return None
    return ClippedFeature(geom=line, properties=feature.get("properties", {}) or {})
