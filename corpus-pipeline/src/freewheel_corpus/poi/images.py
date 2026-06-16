"""S4: Wikimedia image resolver — a POI's ``wikidata`` id -> a storable image ref.

The path (validated in feature §2a, §13):

    wikidata id  ->  Wikidata entity ``P18`` (the Commons filename)
                 ->  Commons ``imageinfo`` API (license + attribution)

We store the **Commons filename** plus a derived ``Special:FilePath`` URL (stable
and resizable), the license short-name, and the attribution string — never a
blob and never a raw ``upload.wikimedia.org`` URL (feature §5). Most POIs have no
``wikidata`` tag or no ``P18``; that is the COMMON case (§2a: ~0% for
water/viewpoint), so this returns ``None`` rather than raising.

HTTP is injected as a ``transport(url) -> json`` callable so the two hops are
mockable; tests dispatch on the URL. The default transport uses ``httpx``.
"""

from __future__ import annotations

import urllib.parse
from collections.abc import Callable
from dataclasses import dataclass

import httpx

Transport = Callable[[str], dict]

# Descriptive User-Agent — the Wikimedia APIs ask for one (and may 403 without).
DEFAULT_USER_AGENT = (
    "freewheel-corpus/0.1 (bike-route-ai; +https://github.com/deep-pedal-ai)"
)

_WIKIDATA_ENTITY_URL = "https://www.wikidata.org/wiki/Special:EntityData/{qid}.json"
_COMMONS_IMAGEINFO_URL = (
    "https://commons.wikimedia.org/w/api.php?action=query&format=json"
    "&prop=imageinfo&iiprop=extmetadata&titles=File:{title}"
)
_FILEPATH_URL = "https://commons.wikimedia.org/wiki/Special:FilePath/{title}"


@dataclass(frozen=True)
class ImageRef:
    """A resolved, storable Wikimedia image reference for one POI.

    Attributes
    ----------
    commons_filename:
        The bare Commons filename (e.g. ``Bethesda Fountain.jpg``) — the stable
        identifier we persist in ``pois.image_url``'s source.
    image_url:
        A derived ``Special:FilePath`` URL (stable + resizable via ``?width=``),
        suitable for ``pois.image_url``.
    license:
        License short-name (e.g. ``CC BY-SA 4.0``) for compliance display.
    attribution:
        The artist / attribution string Wikimedia requires us to display.
    """

    commons_filename: str
    image_url: str
    license: str | None
    attribution: str | None


def _default_transport(url: str) -> dict:
    resp = httpx.get(url, headers={"User-Agent": DEFAULT_USER_AGENT}, timeout=30.0)
    resp.raise_for_status()
    return resp.json()


def file_path_url(commons_filename: str, *, width: int | None = None) -> str:
    """Derive a stable, resizable ``Special:FilePath`` URL from a Commons filename.

    Pure function of the filename (no HTTP) — the frontend can derive thumbnails
    the same way by appending ``?width=``.
    """
    encoded = urllib.parse.quote(commons_filename.replace(" ", "_"))
    url = _FILEPATH_URL.format(title=encoded)
    if width is not None:
        url += f"?width={width}"
    return url


def resolve_image(
    wikidata_id: str | None,
    *,
    transport: Transport | None = None,
) -> ImageRef | None:
    """Resolve a POI's ``wikidata`` id to an :class:`ImageRef`, or ``None``.

    Returns ``None`` (never raises) when the id is missing/blank or the entity
    carries no ``P18`` image — the common case per §2a. License/attribution are
    best-effort: a missing imageinfo response still yields an :class:`ImageRef`
    (filename + derived URL) with ``None`` license fields rather than failing.
    """
    if not wikidata_id or not wikidata_id.strip():
        return None
    qid = wikidata_id.strip()

    fetch = transport or _default_transport

    filename = _fetch_p18_filename(qid, fetch)
    if filename is None:
        return None

    license_name, attribution = _fetch_license_attribution(filename, fetch)
    return ImageRef(
        commons_filename=filename,
        image_url=file_path_url(filename),
        license=license_name,
        attribution=attribution,
    )


def _fetch_p18_filename(qid: str, fetch: Transport) -> str | None:
    """Pull the ``P18`` Commons filename from the Wikidata entity, or ``None``.

    Non-throwing: a network failure on this hop is treated as "no image" (the
    common case per §2a), so a Wikimedia hiccup degrades one POI to icon-only
    rather than aborting the whole p6 batch.
    """
    url = _WIKIDATA_ENTITY_URL.format(qid=urllib.parse.quote(qid))
    try:
        payload = fetch(url)
    except Exception:  # noqa: BLE001 — image resolution is best-effort, never fatal
        return None
    entity = payload.get("entities", {}).get(qid)
    if not entity:
        return None
    claims = entity.get("claims", {}).get("P18")
    if not claims:
        return None
    try:
        value = claims[0]["mainsnak"]["datavalue"]["value"]
    except (KeyError, IndexError, TypeError):
        return None
    if not isinstance(value, str) or not value:
        return None
    return value


def _fetch_license_attribution(
    filename: str, fetch: Transport
) -> tuple[str | None, str | None]:
    """Best-effort license short-name + attribution from the Commons imageinfo API."""
    title = urllib.parse.quote(filename.replace(" ", "_"))
    url = _COMMONS_IMAGEINFO_URL.format(title=title)
    try:
        payload = fetch(url)
    except Exception:  # noqa: BLE001 — license is best-effort, never fatal
        return None, None

    pages = payload.get("query", {}).get("pages", {})
    for page in pages.values():
        infos = page.get("imageinfo")
        if not infos:
            continue
        extmeta = infos[0].get("extmetadata", {})
        license_name = _extmeta_value(extmeta, "LicenseShortName")
        attribution = _extmeta_value(extmeta, "Artist")
        return license_name, attribution
    return None, None


def _extmeta_value(extmeta: dict, key: str) -> str | None:
    entry = extmeta.get(key)
    if isinstance(entry, dict):
        value = entry.get("value")
        return value if isinstance(value, str) else None
    return None
