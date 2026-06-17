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

logger = logging.getLogger(__name__)

PHASE = "phase3"
SOURCE = "nyc_dot"

# NYC Open Data dataset id + the current-status filter value (cli builds the
# server-side $where from these).
NYC_DOT_DATASET = "mzxg-pwib"
CURRENT_STATUS = "Current"

ATTRIBUTION = "NYC DOT Bicycle Routes (NYC Open Data, mzxg-pwib)"

# Slice 1 literal: every facility row is NY. RegionProfile threads this later (§2, §8).
REGION = "ny"

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


def has_facilities(conn: psycopg.Connection) -> bool:
    """True when the NYC DOT facility source already has rows in the DB.

    Scoring only READS ``facility_segments``, so when they are present the
    expensive per-row re-ingest (23,807 MultiLineStrings over a remote
    connection — the ~24 min hang in the WP5 finalize) is pure wasted work. The
    CLI uses this to SKIP the re-ingest and fall straight through to
    score-existing. Source-scoped to :data:`SOURCE` (``nyc_dot``) — the exact
    source the scorer queries — so a row from an unrelated facility source does
    not mask a missing NYC DOT ingest.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT EXISTS (SELECT 1 FROM facility_segments WHERE source = %s)",
            (SOURCE,),
        )
        return bool(cur.fetchone()[0])


def ingest_facilities(
    conn: psycopg.Connection, feature_collection: dict[str, Any]
) -> FacilityStats:
    """Ingest a NYC DOT facilities GeoJSON FeatureCollection into facility_segments.

    Idempotent at the run level: the existing ``nyc_dot`` rows are deleted first,
    then the current FeatureCollection is inserted fresh (a re-run replaces, never
    duplicates). Filters out non-``Current`` features (Q7b), normalizes the class,
    stores geometry as ``MultiLineString``. Returns counts including a by-class
    histogram.
    """
    stats = FacilityStats()
    features = feature_collection.get("features", []) or []

    with conn.cursor() as cur:
        # Recompute-in-place: clear this source's rows so a re-run is idempotent.
        cur.execute("DELETE FROM facility_segments WHERE source = %s", (SOURCE,))

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
                    "region": REGION,
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
