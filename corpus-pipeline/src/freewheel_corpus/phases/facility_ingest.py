"""Phase 3 facility ingest — NYC DOT bike facilities into ``facility_segments``.

Source: NYC Open Data dataset ``mzxg-pwib`` (NYC DOT Bicycle Routes), pulled as
GeoJSON through :mod:`freewheel_corpus.clients.socrata`. The cli filters to
``status='Current'`` server-side (Q7b — retired facilities must never score a
route as protected); this module keeps a belt-and-suspenders filter so an
unfiltered FeatureCollection (e.g. a test fixture) is still safe.

Class normalization (verified against the live dataset 2026-06-11):

- ``facilitycl`` codes → class:
  ``I`` → ``protected``, ``II`` → ``lane``, ``III`` → ``sharrow``, ``L`` → ``other``.
- ``grnwy == 'Greenway'`` **overrides** the code → ``greenway`` (a greenway tagged
  ``facilitycl='II'`` is still a greenway — confirmed against the oracle row
  ``segmentid=2579`` which is ``facilitycl='II'``, ``grnwy='Greenway'`` → greenway).
- any unknown ``facilitycl`` → ``other`` + a logged ``facility_class_unknown`` warning.

Each feature's geometry is stored as a ``MultiLineString`` (the column is
``MultiLineString NOT NULL``); a bare ``LineString`` is promoted to a
single-part ``MultiLineString``. ``facility_id`` = the dataset's ``segmentid``,
``borough`` = the coded ``boro`` mapped to a full name, ``status`` preserved for
audit, attribution verbatim.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

import psycopg
from shapely.geometry import LineString, MultiLineString, shape
from shapely.geometry.base import BaseGeometry

from freewheel_corpus.clients.arcgis import ArcGISClient
from freewheel_corpus.region_profile import NY, FacilityLayer, FacilitySource, RegionProfile

logger = logging.getLogger(__name__)

PHASE = "phase3"
SOURCE = "nyc_dot"

# NYC Open Data dataset id + the current-status filter value (cli builds the
# server-side $where from these).
NYC_DOT_DATASET = "mzxg-pwib"
CURRENT_STATUS = "Current"

ATTRIBUTION = "NYC DOT Bicycle Routes (NYC Open Data, mzxg-pwib)"

# facilitycl code -> normalized class (grnwy='Greenway' overrides to 'greenway').
_FACILITY_CLASS_MAP = {
    "I": "protected",   # protected path / off-street
    "II": "lane",       # on-street bike lane
    "III": "sharrow",   # shared lane (sharrow)
    "L": "other",       # link / connector
}

GREENWAY_VALUE = "Greenway"

# NYC DOT 'boro' code -> borough name (matches the oracle's full-name borough col).
_BOROUGH_MAP = {
    "1": "Manhattan",
    "2": "Bronx",
    "3": "Brooklyn",
    "4": "Queens",
    "5": "Staten Island",
}


def normalize_facility_class(props: dict[str, Any]) -> tuple[str, bool]:
    """Normalize a feature's facility class; return ``(class, was_unknown)``.

    ``grnwy == 'Greenway'`` wins over ``facilitycl``. An unrecognized
    ``facilitycl`` maps to ``'other'`` and flags ``was_unknown=True`` so the
    caller logs a warning (the value itself is preserved in the log).
    """
    if (props.get("grnwy") or "").strip() == GREENWAY_VALUE:
        return "greenway", False
    code = (props.get("facilitycl") or "").strip()
    if code in _FACILITY_CLASS_MAP:
        return _FACILITY_CLASS_MAP[code], False
    return "other", True


# --- SDOT (Seattle, ArcGIS) facility classification --------------------------

SDOT_SOURCE = "sdot"
ATTRIBUTION_SDOT = (
    "SDOT Bike Facilities (Seattle Department of Transportation, ArcGIS Online)"
)

# SDOT `CATEGORY` code -> normalized class. Codes decoded from the FeatureServer
# layer-2 renderer legend (verified 2026-06-16, seattle-source-schema.md §1/§3).
# The two contested calls are RESOLVED per Slice-3 decisions:
#   - BKF-NGW (Neighborhood Greenway) -> 'sharrow' (on-street calmed street, NOT
#     an off-street separated path; mapping it to 'greenway' would over-credit it
#     in p3's protected/greenway weights).
#   - BKF-OFFST (Misc Off Street) -> 'greenway' (a true off-street separated path).
# Multi-use Trails (layer 1) carry NO CATEGORY field; every feature -> 'greenway'
# via FacilityLayer.fixed_class, handled in the ingest, not here.
_SDOT_FACILITY_CLASS_MAP = {
    "BKF-PBL":   "protected",   # Protected Bike Lanes (physically separated)
    "BKF-BBL":   "lane",        # Buffered Bike Lanes (buffer != protection)
    "BKF-BL":    "lane",        # Painted Bike Lanes
    "BKF-CLMB":  "lane",        # Climbing Lanes (uphill bike lane)
    "BKF-SHW":   "sharrow",     # Sharrows / shared-lane markings
    "BKF-NGW":   "sharrow",     # Neighborhood Greenways -> on-street calmed street
    "BKF-OFFST": "greenway",    # Misc Off Street -> off-street separated path
    # <Null>/unrecognized -> "other" + logged warning
}


def normalize_sdot_facility_class(
    props: dict[str, Any], class_field: str
) -> tuple[str, bool]:
    """Normalize an SDOT facility feature's class; return ``(class, was_unknown)``.

    ``class_field`` is the layer's class column (``"CATEGORY"`` for layer 2). An
    unrecognized / ``<Null>`` code maps to ``'other'`` and flags
    ``was_unknown=True`` so the caller logs a ``facility_class_unknown`` warning
    (the value itself is preserved in the log) — the same contract as NYC's
    :func:`normalize_facility_class`.
    """
    code = (props.get(class_field) or "").strip()
    if code in _SDOT_FACILITY_CLASS_MAP:
        return _SDOT_FACILITY_CLASS_MAP[code], False
    return "other", True


# --- SFMTA (San Francisco, ArcGIS) facility classification -------------------

SFMTA_SOURCE = "sfmta"
ATTRIBUTION_SFMTA = (
    "SFMTA Bikeway Network (San Francisco Municipal Transportation Agency, ArcGIS)"
)

# SFMTA Bikeway Network ArcGIS FeatureServer (verified live 2026-06-17):
#   base: https://services.arcgis.com/ONuuV4O5ETfdTBvB/arcgis/rest/services
#   layer path: SFMTA_Bikeway_Network/FeatureServer/0/query
# Distinct facility_t values (queried live): 'BIKE ROUTE', 'BIKE LANE', 'BIKE PATH'
# barrier_ty values: '' (blank) or 'SAFE-HIT POSTS'
# sharrow values: 0 or 1
#
# JUDGMENT CALLS (UNVERIFIED — flag for human review):
#   - BIKE ROUTE + sharrow=0: route-signage-only corridor → 'other'.
#     Reasonable but not confirmed against SFMTA's own data dictionary.
#   - No status/retired filter: SFMTA has no active/retired status column;
#     ALL features are treated as current. Could include removed facilities.
#   - Socrata id s5wt-b6ed (originally in the brief) returns HTTP 404 (broken
#     federated view — the "Seattle lesson"). Using the ArcGIS source instead.
_SFMTA_FACILITY_T_VALUES = frozenset({"BIKE ROUTE", "BIKE LANE", "BIKE PATH"})


def normalize_sfmta_facility_class(
    props: dict[str, Any],
) -> tuple[str, bool]:
    """Normalize an SFMTA Bikeway Network feature's class; return ``(class, was_unknown)``.

    Uses THREE fields — unlike the single-field SDOT normalizer, SFMTA requires
    a multi-field dispatch:

    - ``facility_t``: ``'BIKE PATH'`` | ``'BIKE LANE'`` | ``'BIKE ROUTE'``
    - ``barrier_ty``: ``'SAFE-HIT POSTS'`` marks a physically-protected lane
    - ``sharrow``: ``1`` means a shared-lane marking is present

    Mapping (verified against live FeatureServer query 2026-06-17):

    - ``BIKE PATH`` → ``'greenway'`` (off-street multi-use path)
    - ``BIKE LANE`` + ``barrier_ty='SAFE-HIT POSTS'`` → ``'protected'``
    - ``BIKE LANE`` (no barrier) → ``'lane'``
    - ``BIKE ROUTE`` + ``sharrow=1`` → ``'sharrow'``
    - ``BIKE ROUTE`` + ``sharrow=0`` → ``'other'`` [UNVERIFIED: route signage only]
    - unknown ``facility_t`` → ``'other'`` + ``was_unknown=True``
    """
    facility_t = (props.get("facility_t") or "").strip()
    barrier_ty = (props.get("barrier_ty") or "").strip()
    sharrow = props.get("sharrow")

    if facility_t == "BIKE PATH":
        return "greenway", False
    if facility_t == "BIKE LANE":
        if barrier_ty == "SAFE-HIT POSTS":
            return "protected", False
        return "lane", False
    if facility_t == "BIKE ROUTE":
        if sharrow == 1 or sharrow == "1":
            return "sharrow", False
        # Route signage only — no physical improvement [UNVERIFIED judgment call]
        return "other", False
    # Unknown facility_t value — not in the known set
    return "other", True


def _to_multilinestring(geom: BaseGeometry) -> MultiLineString | None:
    """Coerce a line geometry to ``MultiLineString`` (None if not line-like/empty)."""
    if geom.is_empty:
        return None
    if isinstance(geom, MultiLineString):
        return geom
    if isinstance(geom, LineString):
        return MultiLineString([geom])
    # GeometryCollection or other — keep only line parts.
    lines = [g for g in getattr(geom, "geoms", []) if isinstance(g, LineString)]
    if not lines:
        return None
    return MultiLineString(lines)


@dataclass
class FacilityStats:
    """Counters returned by :func:`ingest_facilities`."""

    stored: int = 0
    skipped_retired: int = 0
    skipped_no_geom: int = 0
    by_class: dict[str, int] = field(default_factory=dict)
    unknown_classes: int = 0


_INSERT_SQL = """
INSERT INTO facility_segments (
    region, source, facility_id, facility_class, geom, status, borough, attribution
) VALUES (
    %(region)s, %(source)s, %(facility_id)s, %(facility_class)s,
    ST_GeomFromText(%(geom_wkt)s, 4326),
    %(status)s, %(borough)s, %(attribution)s
)
"""

_LOG_SQL = """
INSERT INTO ingest_log (phase, source, event_type, source_ref, details, message)
VALUES (%(phase)s, %(source)s, %(event_type)s, %(source_ref)s, %(details)s::jsonb, %(message)s)
"""


def _log(cur: psycopg.Cursor, *, event_type: str, source_ref: str | None,
         details: dict[str, Any], message: str) -> None:
    cur.execute(
        _LOG_SQL,
        {
            "phase": PHASE,
            "source": SOURCE,
            "event_type": event_type,
            "source_ref": source_ref,
            "details": json.dumps(details),
            "message": message,
        },
    )


def has_facilities(conn: psycopg.Connection, source: str = SOURCE) -> bool:
    """True when ``source``'s facility rows already exist in the DB (default NYC DOT).

    Scoring only READS ``facility_segments``, so when they are present the
    expensive per-row re-ingest (23,807 MultiLineStrings over a remote
    connection — the ~24 min hang in the WP5 finalize) is pure wasted work. The
    CLI uses this to SKIP the re-ingest and fall straight through to
    score-existing. Source-scoped to ``source`` (``nyc_dot`` for NY, ``sdot`` for
    Seattle) — the exact source the scorer queries — so a row from an unrelated
    facility source does not mask a missing ingest for the region being run.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT EXISTS (SELECT 1 FROM facility_segments WHERE source = %s)",
            (source,),
        )
        return bool(cur.fetchone()[0])


def ingest_facilities(
    conn: psycopg.Connection,
    feature_collection: dict[str, Any],
    profile: RegionProfile = NY,
) -> FacilityStats:
    """Ingest a NYC DOT facilities GeoJSON FeatureCollection into facility_segments.

    Idempotent at the run level: the existing ``nyc_dot`` rows **for this region**
    are deleted first, then the current FeatureCollection is inserted fresh (a
    re-run replaces, never duplicates). Filters out non-``Current`` features (Q7b),
    normalizes the class, stores geometry as ``MultiLineString``. Returns counts
    including a by-class histogram. ``profile`` sets the ``region`` partition value
    (default NY).
    """
    stats = FacilityStats()
    features = feature_collection.get("features", []) or []

    with conn.cursor() as cur:
        # Recompute-in-place: clear this source's rows for this region so a re-run
        # is idempotent and never touches another region's facilities.
        cur.execute(
            "DELETE FROM facility_segments WHERE source = %s AND region = %s",
            (SOURCE, profile.key),
        )

        for feat in features:
            props = feat.get("properties", {}) or {}
            status = props.get("status")
            if status is not None and status != CURRENT_STATUS:
                stats.skipped_retired += 1
                continue

            geom_json = feat.get("geometry")
            if not geom_json:
                stats.skipped_no_geom += 1
                continue
            multi = _to_multilinestring(shape(geom_json))
            if multi is None:
                stats.skipped_no_geom += 1
                continue

            facility_class, was_unknown = normalize_facility_class(props)
            if was_unknown:
                stats.unknown_classes += 1
                logger.warning(
                    "facility %s has unknown facilitycl=%r → mapped to 'other'",
                    props.get("segmentid"),
                    props.get("facilitycl"),
                )
                _log(
                    cur,
                    event_type="facility_class_unknown",
                    source_ref=str(props.get("segmentid")),
                    details={
                        "segmentid": props.get("segmentid"),
                        "facilitycl": props.get("facilitycl"),
                    },
                    message=(
                        f"unknown facilitycl={props.get('facilitycl')!r}; "
                        f"mapped to 'other'"
                    ),
                )

            boro_code = (props.get("boro") or "").strip()
            cur.execute(
                _INSERT_SQL,
                {
                    "region": profile.key,
                    "source": SOURCE,
                    "facility_id": (
                        str(props["segmentid"]) if props.get("segmentid") is not None else None
                    ),
                    "facility_class": facility_class,
                    "geom_wkt": multi.wkt,
                    "status": status,
                    "borough": _BOROUGH_MAP.get(boro_code),
                    "attribution": ATTRIBUTION,
                },
            )
            stats.stored += 1
            stats.by_class[facility_class] = stats.by_class.get(facility_class, 0) + 1

    conn.commit()
    return stats


# --- SDOT (Seattle) facility ingest via ArcGIS -------------------------------

def _sdot_facility_id(props: dict[str, Any]) -> str | None:
    """SDOT facility id: COMPKEY (the segmentid analog), falling back to OBJECTID."""
    for key in ("COMPKEY", "OBJECTID"):
        val = props.get(key)
        if val is not None:
            return str(val)
    return None


def _classify_arcgis_feature(
    props: dict[str, Any], layer: FacilityLayer, source_type: str | None = None
) -> tuple[str, bool]:
    """Classify one ArcGIS facility feature per its layer's rule and source.

    Dispatch order:

    1. ``source_type='sfmta'`` → :func:`normalize_sfmta_facility_class` (multi-field:
       ``facility_t`` + ``barrier_ty`` + ``sharrow``).
    2. ``class_field is None`` → ``fixed_class`` (all Multi-use Trails are greenway).
    3. Otherwise → :func:`normalize_sdot_facility_class` (single ``class_field``).

    Returns ``(facility_class, was_unknown)`` (``was_unknown`` is always ``False``
    for a fixed-class layer; SFMTA follows its own ``was_unknown`` convention).

    ``source_type`` is the ``FacilitySource.source`` string (``'sdot'``, ``'sfmta'``,
    …); ``None`` falls through to the SDOT path for backward compatibility.
    """
    if source_type == SFMTA_SOURCE:
        return normalize_sfmta_facility_class(props)
    if layer.class_field is None:
        return (layer.fixed_class or "other"), False
    return normalize_sdot_facility_class(props, layer.class_field)


def ingest_arcgis_facilities(
    conn: psycopg.Connection,
    source: FacilitySource,
    profile: RegionProfile = NY,
    *,
    client_factory=ArcGISClient,
    no_cache: bool = False,
) -> FacilityStats:
    """Ingest a region's bike facilities from one or more ArcGIS layers (Seattle/SDOT).

    Mirrors :func:`ingest_facilities` (the NYC Socrata path) but sources from
    ArcGIS: each :class:`~freewheel_corpus.region_profile.FacilityLayer` is fetched
    via :class:`ArcGISClient`, status-filtered (belt-and-suspenders) on the layer's
    ``status_field``/``status_value`` when present, classified per the layer rule
    (``CATEGORY`` map on layer 2, fixed ``greenway`` on the Multi-use Trails layer),
    stored as ``MultiLineString``. ``source.source`` (``'sdot'``) sets the
    ``facility_segments.source`` column; ``borough`` is left NULL (no SDOT analog).
    Idempotent per region+source: deletes this source's rows for this region first.

    ``client_factory`` is injectable so tests pass a fake (returning canned
    features) without touching the network.
    """
    if source.provider != "arcgis":
        raise ValueError(
            f"ingest_arcgis_facilities expects an arcgis FacilitySource, got "
            f"provider={source.provider!r}"
        )

    stats = FacilityStats()
    with conn.cursor() as cur:
        # Recompute-in-place: clear this source's rows for this region (idempotent,
        # never touches another region's or source's facilities).
        cur.execute(
            "DELETE FROM facility_segments WHERE source = %s AND region = %s",
            (source.source, profile.key),
        )

        for layer in source.layers:
            client = client_factory(base_url=source.base_url, layer_path=layer.layer_path)
            features = client.fetch_all_features(no_cache=no_cache)

            for feat in features:
                props = feat.get("properties", {}) or {}

                # Belt-and-suspenders in-service filter (server-side WHERE may not
                # be applied for an injected fixture; layer 1 has no status field).
                if layer.status_field is not None:
                    status_val = props.get(layer.status_field)
                    if status_val is not None and status_val != layer.status_value:
                        stats.skipped_retired += 1
                        continue

                geom_json = feat.get("geometry")
                if not geom_json:
                    stats.skipped_no_geom += 1
                    continue
                multi = _to_multilinestring(shape(geom_json))
                if multi is None:
                    stats.skipped_no_geom += 1
                    continue

                facility_class, was_unknown = _classify_arcgis_feature(
                    props, layer, source_type=source.source
                )
                facility_id = _sdot_facility_id(props)
                if was_unknown:
                    stats.unknown_classes += 1
                    code = props.get(layer.class_field) if layer.class_field else None
                    src_label = source.source or "arcgis"
                    logger.warning(
                        "%s facility %s has unknown %s=%r -> mapped to 'other'",
                        src_label, facility_id, layer.class_field, code,
                    )
                    _log(
                        cur,
                        event_type="facility_class_unknown",
                        source_ref=facility_id,
                        details={"facility_id": facility_id,
                                 "class_field": layer.class_field, "value": code},
                        message=f"unknown {layer.class_field}={code!r}; mapped to 'other'",
                    )

                status = (
                    props.get(layer.status_field) if layer.status_field else None
                )
                # Select the correct attribution string per source.
                if source.source == SFMTA_SOURCE:
                    attribution = ATTRIBUTION_SFMTA
                else:
                    attribution = ATTRIBUTION_SDOT
                cur.execute(
                    _INSERT_SQL,
                    {
                        "region": profile.key,
                        "source": source.source,
                        "facility_id": facility_id,
                        "facility_class": facility_class,
                        "geom_wkt": multi.wkt,
                        "status": status,
                        "borough": None,  # no ArcGIS borough analog
                        "attribution": attribution,
                    },
                )
                stats.stored += 1
                stats.by_class[facility_class] = stats.by_class.get(facility_class, 0) + 1

    conn.commit()
    return stats
