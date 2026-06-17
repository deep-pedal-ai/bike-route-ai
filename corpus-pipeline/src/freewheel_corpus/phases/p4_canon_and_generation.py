"""Phase 4 — canon seeding + scored generation (WP4).

Two ingest paths, both writing ``routes`` via openrouteservice (ORS) directions:

1. **Canon** (:func:`ingest_canon`) — hand-curated marquee rides from
   ``config/canon.yaml`` (DRAFT human ``[lat, lon]`` coords + length/direction
   ``variants``). Each entry+variant is routed with ORS ``/v2/directions``
   (start + waypoints, plus a return leg for ``out_and_back``) requesting
   ``extra_info=[surface,waytype,steepness]`` and ``elevation=true``. The GeoJSON
   is parsed, the RLE extras decoded into fractional breakdowns, and the row is
   upserted with ``source='canon'``, ``match_quality=1.0``. A route whose routed
   distance is > ±25% of the entry's ``expected_km`` (or an ORS failure) is
   **logged + skipped** (not stored) — expected for DRAFT coords (PLAN §11).

2. **Generation** (:func:`generate_loops`) — ~12 hardcoded seed start points ×
   target lengths {15,25,40,60} km × seeds 0-4 routed as ORS round-trips. Each
   candidate is scored INLINE with the Phase-3 pure scorer; only loops with
   ``quality_score >= 0.55`` AND distance within ±20% of target AND not a
   duplicate of an existing route are kept. Rejects are logged **with scores**.

**Dedup application** (:func:`apply_dedup_pass`) uses the pure overlap predicate
from :mod:`freewheel_corpus.geometry` and applies the ADR-0003 precedence ladder,
hard-deleting the loser and logging both IDs. The ladder slots WP2's ``open_gpx``
just above ``generated`` (it is not in the original ADR-0003 list — see
:data:`SOURCE_PRECEDENCE`).

Pure (DB-free, no-network) helpers — the RLE decode, the coordinate swap, the
distance gate — are unit-tested with synthetic + captured fixtures; the live ORS
calls and the DB writes are exercised only in the env-gated DB / live tests.

ADR / decision refs: ADR-0002 (EPSG:32618), ADR-0003 (dedup ladder + hard-delete),
Q4 (elevation from /v2/directions output, per-endpoint quota counters), Q5
(coordinate swap + bounds guard), Q6b (out_and_back persisted into tags).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import psycopg
import yaml
from shapely.geometry import LineString

from freewheel_corpus import geometry
from freewheel_corpus.config.settings import Settings
from freewheel_corpus.metro import assert_in_metro_bounds

PHASE = "phase4"

CANON_SOURCE = "canon"
GENERATED_SOURCE = "generated"
CANON_ATTRIBUTION = (
    "© OpenStreetMap contributors, ODbL; routed via openrouteservice"
)
GENERATED_ATTRIBUTION = (
    "Generated loop on © OpenStreetMap contributors, ODbL; routed via openrouteservice"
)
MATCH_QUALITY = 1.0

# Slice 1 literal: every row is NY. RegionProfile threads this later (§2, §8).
REGION = "ny"

# --- ORS extra_info value-code → human string maps --------------------------
# ORS encodes surface / waytype / steepness as integer codes in the RLE extras.
# We map them to the string keys the Phase-3 surface_quality scorer + the
# breakdown columns expect (surface uses OSM-ish surface names so p3's
# _SURFACE_SCORES table applies directly). Codes are from the ORS extra-info
# reference; unlisted codes fall back to a generic string per type.

# ORS surface codes (extra_info=surface).
ORS_SURFACE_CODES = {
    0: "unknown",
    1: "paved",
    2: "unpaved",
    3: "asphalt",
    4: "concrete",
    5: "cobblestone",
    6: "metal",
    7: "wood",
    8: "compacted",  # "Compacted Gravel" → maps to p3 'compacted' (0.6)
    9: "fine_gravel",
    10: "gravel",
    11: "dirt",
    12: "ground",
    13: "ice",
    14: "paving_stones",
    15: "sand",
    16: "woodchips",
    17: "grass",
    18: "grass_paver",
}

# ORS waytype codes (extra_info=waytype).
ORS_WAYTYPE_CODES = {
    0: "unknown",
    1: "state_road",
    2: "road",
    3: "street",
    4: "path",
    5: "track",
    6: "cycleway",
    7: "footway",
    8: "steps",
    9: "ferry",
    10: "construction",
}


# ORS steepness codes (extra_info=steepness): -5..5, sign = down/up, magnitude =
# grade band. We keep them as signed-string keys for the steepness_breakdown.
def _steepness_label(code: int) -> str:
    return f"steepness_{code}"


def _value_label(extra_type: str, code: int) -> str:
    """Map an ORS extra value CODE to its human string key for the breakdown."""
    if extra_type == "surface":
        return ORS_SURFACE_CODES.get(code, f"surface_{code}")
    if extra_type == "waytype":
        return ORS_WAYTYPE_CODES.get(code, f"waytype_{code}")
    if extra_type == "steepness":
        return _steepness_label(code)
    return str(code)


# --- RLE extras decode (behavior 1, the mandated tracer bullet) -------------

def decode_rle_extra(
    coords: list[tuple[float, float]], values: list[list[int]]
) -> dict[int, float]:
    """Decode ORS run-length ``[from_idx, to_idx, value]`` triples → fractions.

    ``coords`` is the route geometry as ``(lon, lat)`` tuples (Z already
    stripped). ``values`` is the ORS ``extras.{type}.values`` list: each triple's
    ``from_idx`` / ``to_idx`` are **coordinate indices** into ``coords`` and
    ``value`` is the integer code for that span. We sum the projected
    (EPSG:32618) geometric length of ``coords[from..to]`` per value and normalize
    by the total length, returning ``{value_code -> fraction}`` summing to ~1.0.

    Verified against a real captured ORS response: the decoded per-value
    fractions reproduce ORS's own ``extras.{type}.summary[].amount`` percentages.
    Returns ``{}`` for a degenerate (< 2-point or zero-length) line.
    """
    if len(coords) < 2 or not values:
        return {}

    projected = geometry.project_to_utm(LineString(coords))
    pcoords = list(projected.coords)

    # Cumulative projected length up to each coordinate index.
    cum = [0.0]
    for i in range(1, len(pcoords)):
        seg = LineString([pcoords[i - 1], pcoords[i]]).length
        cum.append(cum[-1] + seg)
    total = cum[-1]
    if total <= 0:
        return {}

    by_value: dict[int, float] = {}
    for triple in values:
        frm, to, code = int(triple[0]), int(triple[1]), int(triple[2])
        # Clamp indices defensively (a malformed extra must not crash the run).
        frm = max(0, min(frm, len(cum) - 1))
        to = max(0, min(to, len(cum) - 1))
        length = cum[to] - cum[frm]
        if length <= 0:
            continue
        by_value[code] = by_value.get(code, 0.0) + length

    return {code: length / total for code, length in by_value.items()}


def named_breakdown(
    extra_type: str, coords: list[tuple[float, float]], values: list[list[int]]
) -> dict[str, float]:
    """Decode an RLE extra and map value CODES to their human string keys.

    Produces the ``{string -> fraction}`` breakdown stored in
    ``surface_breakdown`` / ``waytype_breakdown`` / ``steepness_breakdown`` and
    consumed by the Phase-3 ``surface_quality`` scorer. Codes that collide on the
    same string (rare) are summed.
    """
    coded = decode_rle_extra(coords, values)
    named: dict[str, float] = {}
    for code, fraction in coded.items():
        key = _value_label(extra_type, code)
        named[key] = named.get(key, 0.0) + fraction
    return named


# --- Coordinate helper: [lat,lon] (YAML) → [lon,lat] (code) + guard (Q5) -----

def latlon_to_lonlat(latlon: list[float] | tuple[float, float]) -> tuple[float, float]:
    """Swap a human ``[lat, lon]`` (canon.yaml) into code ``(lon, lat)`` (Q5).

    This is the ONE place the coordinate order flips. The metro-bounds guard
    (:func:`freewheel_corpus.metro.assert_in_metro_bounds`) runs on the result so
    a transposed coordinate — the single highest-risk bug class in this pipeline
    — raises loudly rather than routing into the ocean.
    """
    lat, lon = float(latlon[0]), float(latlon[1])
    assert_in_metro_bounds(lon, lat)
    return (lon, lat)


def latlon_list_to_lonlat(
    waypoints: list[list[float]] | list[tuple[float, float]]
) -> list[tuple[float, float]]:
    """Convert a list of human ``[lat, lon]`` waypoints to ``(lon, lat)`` tuples.

    Every waypoint is bounds-checked; a single out-of-metro point fails the whole
    conversion (one bad coordinate poisons the route).
    """
    return [latlon_to_lonlat(wp) for wp in waypoints]


# --- ORS directions GeoJSON → parsed route ----------------------------------

@dataclass
class ParsedRoute:
    """The pieces of an ORS directions response a Phase-4 row needs.

    - ``line``: the 2D ``(lon, lat)`` ``LineString`` (Z stripped for the 2D geom
      column).
    - ``distance_km``: ``properties.summary.distance`` (ORS gives metres) / 1000.
    - ``ascent_m`` / ``descent_m``: ``properties.ascent`` / ``descent`` (Q4 —
      read from the directions output, never separately computed).
    - ``surface_breakdown`` / ``waytype_breakdown`` / ``steepness_breakdown``:
      the decoded RLE extras as ``{string -> fraction}``.
    """

    line: LineString
    distance_km: float
    ascent_m: float | None
    descent_m: float | None
    surface_breakdown: dict[str, float] = field(default_factory=dict)
    waytype_breakdown: dict[str, float] = field(default_factory=dict)
    steepness_breakdown: dict[str, float] = field(default_factory=dict)


def parse_ors_feature(feature_collection: dict[str, Any]) -> ParsedRoute:
    """Parse an ORS directions GeoJSON FeatureCollection into a :class:`ParsedRoute`.

    ORS returns ``geometry.coordinates`` as ``[lon, lat, ele]`` 3-tuples when
    ``elevation=true``; the Z is stripped for the 2D ``routes.geom`` column. The
    RLE extras under ``properties.extras.{surface,waytype,steepness}`` are decoded
    into fractional breakdowns; a missing extra yields an empty breakdown.
    """
    feature = feature_collection["features"][0]
    coords3d = feature["geometry"]["coordinates"]
    coords2d = [(c[0], c[1]) for c in coords3d]  # strip Z for the 2D column
    props = feature["properties"]

    distance_m = float(props.get("summary", {}).get("distance", 0.0) or 0.0)
    ascent = props.get("ascent")
    descent = props.get("descent")
    extras = props.get("extras", {}) or {}

    def _bd(extra_type: str) -> dict[str, float]:
        block = extras.get(extra_type)
        if not block or not block.get("values"):
            return {}
        return named_breakdown(extra_type, coords2d, block["values"])

    return ParsedRoute(
        line=LineString(coords2d),
        distance_km=distance_m / 1000.0,
        ascent_m=float(ascent) if ascent is not None else None,
        descent_m=float(descent) if descent is not None else None,
        surface_breakdown=_bd("surface"),
        waytype_breakdown=_bd("waytype"),
        steepness_breakdown=_bd("steepness"),
    )


# --- Canon loading ----------------------------------------------------------

_DEFAULT_CANON_PATH = Path(__file__).resolve().parents[1] / "config" / "canon.yaml"


def load_canon(path: Path | str | None = None) -> list[dict[str, Any]]:
    """Load the canon DRAFT rides from ``config/canon.yaml`` (the ``rides`` list).

    Coordinates stay in human ``[lat, lon]`` here; the swap to code ``[lon, lat]``
    happens later in :func:`latlon_to_lonlat` (Q5 — one place). A missing file or
    empty ``rides`` returns an empty list.
    """
    canon_path = Path(path) if path is not None else _DEFAULT_CANON_PATH
    if not canon_path.exists():
        return []
    data = yaml.safe_load(canon_path.read_text()) or {}
    return data.get("rides", []) or []


def _iter_variants(entry: dict[str, Any]):
    """Yield ``(variant_slug, variant_name, expected_km, waypoints, out_and_back)``.

    Each canon entry has a base ``slug`` / ``start`` / ``waypoints`` /
    ``expected_km`` / ``out_and_back`` and a list of ``variants`` (each a name +
    its own ``expected_km`` and optionally overriding ``waypoints``). An entry
    with no ``variants`` is treated as a single implicit ``default`` variant.
    """
    base_wps = entry.get("waypoints", [])
    base_oab = bool(entry.get("out_and_back", False))
    variants = entry.get("variants") or [{"name": "default", "expected_km": entry["expected_km"]}]
    for var in variants:
        vname = var.get("name", "default")
        vslug = f"{entry['slug']}:{vname}"
        vexpected = float(var.get("expected_km", entry["expected_km"]))
        vwps = var.get("waypoints", base_wps)
        voab = bool(var.get("out_and_back", base_oab))
        yield vslug, vname, vexpected, vwps, voab


# --- Canon ingest (behavior 3: distance sanity gate) ------------------------

_CANON_UPSERT_SQL = """
INSERT INTO routes (
    region, source, source_id, name,
    geom, start_point, is_loop, distance_km, match_quality,
    ascent_m, descent_m,
    surface_breakdown, waytype_breakdown, steepness_breakdown,
    tags, attribution
) VALUES (
    %(region)s, %(source)s, %(source_id)s, %(name)s,
    ST_GeomFromText(%(geom_wkt)s, 4326),
    ST_GeomFromText(%(start_wkt)s, 4326),
    %(is_loop)s, %(distance_km)s, %(match_quality)s,
    %(ascent_m)s, %(descent_m)s,
    %(surface_breakdown)s::jsonb, %(waytype_breakdown)s::jsonb,
    %(steepness_breakdown)s::jsonb,
    %(tags)s::jsonb, %(attribution)s
)
ON CONFLICT (region, source, source_id) DO UPDATE SET
    name                = EXCLUDED.name,
    geom                = EXCLUDED.geom,
    start_point         = EXCLUDED.start_point,
    is_loop             = EXCLUDED.is_loop,
    distance_km         = EXCLUDED.distance_km,
    match_quality       = EXCLUDED.match_quality,
    ascent_m            = EXCLUDED.ascent_m,
    descent_m           = EXCLUDED.descent_m,
    surface_breakdown   = EXCLUDED.surface_breakdown,
    waytype_breakdown   = EXCLUDED.waytype_breakdown,
    steepness_breakdown = EXCLUDED.steepness_breakdown,
    tags                = EXCLUDED.tags,
    attribution         = EXCLUDED.attribution,
    updated_at          = now()
RETURNING id
"""

_LOG_SQL = """
INSERT INTO ingest_log (phase, source, event_type, route_id, source_ref, details, message)
VALUES (%(phase)s, %(source)s, %(event_type)s, %(route_id)s, %(source_ref)s,
        %(details)s::jsonb, %(message)s)
"""


@dataclass
class CanonStats:
    """Counters returned by :func:`ingest_canon`."""

    stored: int = 0
    skipped_distance: int = 0
    ors_failed: int = 0
    quota_paused: bool = False
    ids: list[int] = field(default_factory=list)


def _log(
    cur: psycopg.Cursor,
    *,
    source: str,
    event_type: str,
    source_ref: str,
    details: dict[str, Any],
    message: str,
    route_id: int | None = None,
) -> None:
    cur.execute(
        _LOG_SQL,
        {
            "phase": PHASE,
            "source": source,
            "event_type": event_type,
            "route_id": route_id,
            "source_ref": source_ref,
            "details": json.dumps(details),
            "message": message,
        },
    )


def _within_tolerance(routed_km: float, expected_km: float, tolerance: float) -> bool:
    """True when ``routed_km`` is within ``±tolerance`` of ``expected_km``."""
    if expected_km <= 0:
        return False
    return abs(routed_km - expected_km) <= tolerance * expected_km


def ingest_canon(
    conn: psycopg.Connection,
    entries: list[dict[str, Any]],
    *,
    ors_client: Any,
    settings: Settings | None = None,
) -> CanonStats:
    """Route + ingest canon entries (per variant), gated by the ±25% distance check.

    For each entry/variant: convert the human ``[lat, lon]`` start + waypoints to
    ``(lon, lat)`` (Q5, with bounds guard), append the return leg when
    ``out_and_back``, route via ORS directions, parse the response, and apply the
    canon distance sanity gate: a routed distance > ±``canon_distance_tolerance``
    (25%) of the variant's ``expected_km`` → log ``canon_skip_distance`` + SKIP
    (not stored). Otherwise upsert with ``source='canon'``,
    ``source_id=slug:variant``, ``match_quality=1.0``, the three breakdowns,
    ascent/descent (Q4), ``out_and_back`` in ``tags`` (Q6b), verbatim attribution.

    An ORS quota exhaustion (:class:`~freewheel_corpus.clients.ors.OrsQuotaExceeded`)
    stops the loop, sets ``quota_paused=True``, logs a ``quota_exit``, COMMITS the
    work done so far, and returns — the CLI maps this to a graceful exit 0 (resume
    tomorrow). An individual ORS error is logged (``canon_ors_error``) + skipped
    without aborting the batch.
    """
    from freewheel_corpus.clients.ors import OrsQuotaExceeded

    s = settings or Settings()
    tolerance = s.canon_distance_tolerance
    stats = CanonStats()

    with conn.cursor() as cur:
        for entry in entries:
            start_latlon = entry["start"]
            for vslug, vname, vexpected, vwps, voab in _iter_variants(entry):
                # Build the [lon, lat] coordinate list (guarded swap).
                try:
                    start = latlon_to_lonlat(start_latlon)
                    waypoints = latlon_list_to_lonlat(vwps)
                except Exception as exc:  # bounds guard → bad DRAFT coord
                    stats.skipped_distance += 1  # treat as a skip, not a crash
                    _log(
                        cur,
                        source=CANON_SOURCE,
                        event_type="canon_skip_coord",
                        source_ref=vslug,
                        details={"error": str(exc)},
                        message=f"canon coord rejected by bounds guard: {exc}",
                    )
                    continue

                coords = [start, *waypoints]
                if voab:
                    # Out-and-back: append the reverse path back to the start so
                    # the route returns; expected_km is the FULL round-trip length.
                    coords = coords + list(reversed(coords[:-1]))

                try:
                    fc = ors_client.directions(coords)
                except OrsQuotaExceeded as exc:
                    stats.quota_paused = True
                    _log(
                        cur,
                        source=CANON_SOURCE,
                        event_type="quota_exit",
                        source_ref=vslug,
                        details={"endpoint": exc.endpoint, "count": exc.count,
                                 "limit": exc.limit},
                        message=str(exc),
                    )
                    conn.commit()
                    return stats
                except Exception as exc:  # endpoint down / routing failure
                    stats.ors_failed += 1
                    _log(
                        cur,
                        source=CANON_SOURCE,
                        event_type="canon_ors_error",
                        source_ref=vslug,
                        details={"error": str(exc)},
                        message=f"ORS directions failed for {vslug}: {exc}",
                    )
                    continue

                parsed = parse_ors_feature(fc)

                if not _within_tolerance(parsed.distance_km, vexpected, tolerance):
                    stats.skipped_distance += 1
                    _log(
                        cur,
                        source=CANON_SOURCE,
                        event_type="canon_skip_distance",
                        source_ref=vslug,
                        details={
                            "expected_km": round(vexpected, 4),
                            "routed_km": round(parsed.distance_km, 4),
                            "tolerance": tolerance,
                        },
                        message=(
                            f"routed {parsed.distance_km:.2f} km vs expected "
                            f"{vexpected:.2f} km (> ±{int(tolerance*100)}%); "
                            f"skipped (DRAFT coord — verify before re-run)"
                        ),
                    )
                    continue

                line = parsed.line
                startpt = line.coords[0]
                tags = {"out_and_back": voab, "variant": vname}
                params = {
                    "region": REGION,
                    "source": CANON_SOURCE,
                    "source_id": vslug,
                    "name": f"{entry.get('name', entry['slug'])} ({vname})",
                    "geom_wkt": line.wkt,
                    "start_wkt": f"POINT({startpt[0]} {startpt[1]})",
                    "is_loop": geometry.is_loop(line),
                    "distance_km": parsed.distance_km,
                    "match_quality": MATCH_QUALITY,
                    "ascent_m": parsed.ascent_m,
                    "descent_m": parsed.descent_m,
                    "surface_breakdown": json.dumps(parsed.surface_breakdown) if parsed.surface_breakdown else None,
                    "waytype_breakdown": json.dumps(parsed.waytype_breakdown) if parsed.waytype_breakdown else None,
                    "steepness_breakdown": json.dumps(parsed.steepness_breakdown) if parsed.steepness_breakdown else None,
                    "tags": json.dumps(tags),
                    "attribution": CANON_ATTRIBUTION,
                }
                cur.execute(_CANON_UPSERT_SQL, params)
                stats.stored += 1
                stats.ids.append(cur.fetchone()[0])

    conn.commit()
    return stats


# --- Dedup application (behavior 4: precedence ladder + hard-delete) ---------

# ADR-0003 precedence ladder: higher index = lower priority (loses). The ADR
# lists `canon > osm_relation > nysdot > usbrs > generated`; WP2 introduced
# `open_gpx` which the ADR predates, so it is slotted just ABOVE `generated`
# (manual GPX is more trustworthy than a machine-generated loop, but below the
# government/native sources). An unranked source sorts to the very bottom.
SOURCE_PRECEDENCE = [
    "canon",
    "osm_relation",
    "nysdot",
    "usbrs",
    "open_gpx",
    "generated",
]


def _rank(source: str) -> int:
    """Ladder rank for a source (lower = higher priority; unknown = bottom)."""
    try:
        return SOURCE_PRECEDENCE.index(source)
    except ValueError:
        return len(SOURCE_PRECEDENCE)  # unranked → loses to everything ranked


def _precedence_winner(
    a: tuple[int, str], b: tuple[int, str]
) -> tuple[tuple[int, str], tuple[int, str]]:
    """Return ``(winner, loser)`` for two ``(id, source)`` routes by the ladder.

    The winner is the higher-ranked source. On an EQUAL rank (e.g. two
    osm_relation rows) the lower ``id`` wins so the outcome is deterministic and
    re-run stable (ADR-0003's whole point).
    """
    ra, rb = _rank(a[1]), _rank(b[1])
    if ra != rb:
        return (a, b) if ra < rb else (b, a)
    # Same source/rank → keep the lower id deterministically.
    return (a, b) if a[0] <= b[0] else (b, a)


def routes_overlap_either(a: LineString, b: LineString) -> bool:
    """Symmetric wrapper over the (asymmetric) overlap predicate.

    ``geometry.routes_overlap`` buffers only its first argument, so it is not
    symmetric. For dedup we want "these two are the same ride" regardless of
    order, so we buffer the LONGER route (the more reliable container) and also
    test the reverse — either direction exceeding the threshold means duplicate.
    """
    pa = geometry.project_to_utm(a)
    pb = geometry.project_to_utm(b)
    longer, shorter = (a, b) if pa.length >= pb.length else (b, a)
    return geometry.routes_overlap(longer, shorter) or geometry.routes_overlap(
        shorter, longer
    )


_DEDUP_LOAD_SQL = (
    "SELECT id, source, ST_AsBinary(geom) AS geom FROM routes "
    "WHERE geom IS NOT NULL ORDER BY id"
)
_DELETE_SQL = "DELETE FROM routes WHERE id = %(id)s"


def apply_dedup_pass(
    conn: psycopg.Connection,
    *,
    only_sources: list[str] | None = None,
    length_ratio_min: float | None = None,
) -> int:
    """Full-table cross-source dedup: pair overlapping routes, keep the
    higher-precedence one, HARD-DELETE the loser, log both IDs (ADR-0003).

    A pair is a duplicate candidate ONLY IF both (a) they overlap (the WP1 pure
    predicate :func:`routes_overlap_either`, the symmetric wrapper) AND (b) they
    are **similar in length** —
    ``min(len_a, len_b) / max(len_a, len_b) >= length_ratio_min`` (the WP5
    length-ratio guard, default :data:`settings.dedup_length_ratio_min` / 0.8).
    The guard is what stops the over-deletion the un-guarded pass caused: a SHORT
    ride wholly inside a LONG corridor overlaps > 80% of its OWN (shorter) length,
    so the bare overlap predicate flagged it a duplicate and the ladder then
    deleted the longer, MORE complete ride. Requiring similar length means distinct
    corridor-sharing rides (e.g. three different 9W destinations) are kept, while
    near-equal coincident twins (ratio ≈ 1.0) still merge. The guard lives HERE in
    the application, so :func:`geometry.routes_overlap` (WP1 tested semantics) and
    the generation gate's use of :func:`routes_overlap_either` stay untouched.

    The winner is chosen by :data:`SOURCE_PRECEDENCE` alone — NOT by
    ``quality_score`` (ADR-0003: a human-curated canon ride beats a raw OSM
    relation even when facility math scores OSM fractionally higher; the ladder
    makes the survivor deterministic and re-run stable). Each ``skipped_duplicate``
    log row carries both route IDs + sources in ``details``.

    Used by Phase 4 (generated-candidate dedup) and the final Phase-3 cross-source
    pass (WP5). ``only_sources`` optionally restricts which candidates may be
    DELETED (the survivor can still be any source) — Phase 4 generation uses this
    to remove only freshly-generated duplicates, leaving the established corpus
    untouched until the WP5 full pass. ``length_ratio_min`` overrides the guard
    threshold (defaults to the configured one).

    Returns the number of rows hard-deleted.
    """
    from shapely import wkb

    if length_ratio_min is None:
        length_ratio_min = Settings().dedup_length_ratio_min

    with conn.cursor() as load_cur, conn.cursor() as work_cur:
        load_cur.execute(_DEDUP_LOAD_SQL)
        rows = [
            (rid, source, wkb.loads(bytes(geom_wkb)))
            for rid, source, geom_wkb in load_cur.fetchall()
        ]

        deleted: set[int] = set()
        removed = 0
        for i in range(len(rows)):
            id_a, src_a, geom_a = rows[i]
            if id_a in deleted:
                continue
            for j in range(i + 1, len(rows)):
                id_b, src_b, geom_b = rows[j]
                if id_b in deleted:
                    continue
                # WP5 length-ratio guard (cheap-first): two routes merge only if
                # they are similar length. A short ride inside a long corridor has
                # ratio << 1 → skipped here, so it can never be deleted as a "dup".
                if geometry.length_ratio(geom_a, geom_b) < length_ratio_min:
                    continue
                if not routes_overlap_either(geom_a, geom_b):
                    continue

                winner, loser = _precedence_winner((id_a, src_a), (id_b, src_b))
                # Honour only_sources: if the chosen loser is NOT a deletable
                # source, fall back to deleting the other only if IT is deletable;
                # otherwise leave both (neither in scope for this pass).
                if only_sources is not None and loser[1] not in only_sources:
                    other = winner  # the would-be survivor
                    if other[1] in only_sources and other != (id_a, src_a):
                        # Can't delete the higher-precedence one — skip the pair.
                        continue
                    if other[1] not in only_sources:
                        continue
                    winner, loser = loser, other  # delete the in-scope one instead

                _log(
                    work_cur,
                    source=loser[1],
                    event_type="skipped_duplicate",
                    source_ref=str(loser[0]),
                    details={
                        "kept_id": winner[0],
                        "kept_source": winner[1],
                        "deleted_id": loser[0],
                        "deleted_source": loser[1],
                    },
                    message=(
                        f"route {loser[0]} ({loser[1]}) is a duplicate of "
                        f"{winner[0]} ({winner[1]}); hard-deleted the lower-"
                        f"precedence row (ladder: {' > '.join(SOURCE_PRECEDENCE)})"
                    ),
                )
                work_cur.execute(_DELETE_SQL, {"id": loser[0]})
                deleted.add(loser[0])
                removed += 1
                if loser[0] == id_a:
                    break  # geom_a is gone; stop pairing it

    conn.commit()
    return removed


# --- Generation (behavior 6: quality gate) ----------------------------------

# ~12 hardcoded seed start points (lon, lat) across the metro area. These are
# launch points for round-trip generation; the loops they produce are scored and
# gated, so an imperfect seed simply yields no kept loops (it is not a coord that
# must be human-verified like canon). Commented with their rough locale.
GENERATION_SEED_POINTS: list[tuple[float, float]] = [
    (-73.9665, 40.7812),   # Central Park, Manhattan
    (-73.9690, 40.6602),   # Prospect Park, Brooklyn
    (-74.0090, 40.7033),   # Battery Park / Lower Manhattan
    (-73.9760, 40.7050),   # Brooklyn Bridge / DUMBO
    (-73.8740, 40.7460),   # Flushing Meadows, Queens
    (-73.8230, 40.6010),   # Rockaway / Jamaica Bay, Queens
    (-73.8900, 40.8930),   # Van Cortlandt Park, Bronx
    (-73.8650, 40.8500),   # Bronx River Pathway, Bronx
    (-74.1500, 40.5800),   # Staten Island south shore
    (-73.9100, 40.8500),   # Randalls Island / Harlem
    (-73.7900, 40.7300),   # Cunningham / Kissena, Queens
    (-73.9450, 40.7900),   # Upper East Side / East River, Manhattan
]

# Target round-trip lengths (km → metres) and seeds, per the brief
# (~12 seeds × 4 lengths × 5 seeds ≈ 240 round-trip calls).
GENERATION_TARGET_KM = [15, 25, 40, 60]
GENERATION_SEEDS = [0, 1, 2, 3, 4]
GENERATION_ROUND_TRIP_POINTS = 5


@dataclass
class GenerationStats:
    """Counters returned by :func:`generate_loops`."""

    kept: int = 0
    rejected_length: int = 0
    rejected_quality: int = 0
    rejected_duplicate: int = 0
    ors_failed: int = 0
    quota_paused: bool = False
    ids: list[int] = field(default_factory=list)


_GEN_UPSERT_SQL = """
INSERT INTO routes (
    region, source, source_id, name,
    geom, start_point, is_loop, distance_km, match_quality,
    ascent_m, descent_m,
    surface_breakdown, waytype_breakdown, steepness_breakdown,
    protected_lane_fraction, greenway_fraction, facility_coverage_fraction,
    quality_score,
    tags, attribution
) VALUES (
    %(region)s, %(source)s, %(source_id)s, %(name)s,
    ST_GeomFromText(%(geom_wkt)s, 4326),
    ST_GeomFromText(%(start_wkt)s, 4326),
    %(is_loop)s, %(distance_km)s, %(match_quality)s,
    %(ascent_m)s, %(descent_m)s,
    %(surface_breakdown)s::jsonb, %(waytype_breakdown)s::jsonb,
    %(steepness_breakdown)s::jsonb,
    %(protected)s, %(greenway)s, %(coverage)s, %(quality)s,
    %(tags)s::jsonb, %(attribution)s
)
ON CONFLICT (region, source, source_id) DO UPDATE SET
    name                = EXCLUDED.name,
    geom                = EXCLUDED.geom,
    start_point         = EXCLUDED.start_point,
    is_loop             = EXCLUDED.is_loop,
    distance_km         = EXCLUDED.distance_km,
    match_quality       = EXCLUDED.match_quality,
    ascent_m            = EXCLUDED.ascent_m,
    descent_m           = EXCLUDED.descent_m,
    surface_breakdown   = EXCLUDED.surface_breakdown,
    waytype_breakdown   = EXCLUDED.waytype_breakdown,
    steepness_breakdown = EXCLUDED.steepness_breakdown,
    protected_lane_fraction    = EXCLUDED.protected_lane_fraction,
    greenway_fraction          = EXCLUDED.greenway_fraction,
    facility_coverage_fraction = EXCLUDED.facility_coverage_fraction,
    quality_score              = EXCLUDED.quality_score,
    tags                = EXCLUDED.tags,
    attribution         = EXCLUDED.attribution,
    updated_at          = now()
RETURNING id
"""

_EXISTING_GEOMS_SQL = (
    "SELECT id, ST_AsBinary(geom) AS geom FROM routes WHERE geom IS NOT NULL"
)


def _score_candidate(
    cur: psycopg.Cursor,
    line: LineString,
    surface_breakdown: dict[str, float],
    *,
    coverage,
    facility_source: str,
    settings: Settings,
) -> tuple[float, float, float, float]:
    """Inline Phase-3 score for a candidate (reuses the p3 pure scorer + query).

    Returns ``(protected, greenway, coverage_fraction, quality_score)``. The
    facility segments within 15 m are loaded from ``facility_segments`` exactly as
    Phase 3 does, so a generated loop is scored on the SAME basis as every stored
    route. ``source='generated'`` so its source prior is 0.5.
    """
    from freewheel_corpus.phases import p3_quality_scoring as p3

    by_class = p3._facilities_near(cur, line, source=facility_source)
    cov = p3.facility_coverage_fraction(line, coverage)
    prot = p3.protected_lane_fraction_in_coverage(line, by_class, coverage)
    grn = p3.greenway_fraction_in_coverage(line, by_class, coverage)
    surf = p3.surface_quality(surface_breakdown, settings)
    q = p3.quality_score(
        protected_lane_fraction=prot,
        greenway_fraction=grn,
        surface_quality=surf,
        source=GENERATED_SOURCE,
        settings=settings,
    )
    return prot, grn, cov, q


def generate_loops(
    conn: psycopg.Connection,
    *,
    ors_client: Any,
    seed_points: list[tuple[float, float]] | None = None,
    target_lengths_m: list[int] | None = None,
    seeds: list[int] | None = None,
    facility_source: str = "nyc_dot",
    coverage_geojson: dict[str, Any] | None = None,
    settings: Settings | None = None,
) -> GenerationStats:
    """Generate round-trip loops, score them inline, keep only the gated winners.

    For each ``(seed_point, target_length, seed)``: request an ORS round-trip,
    parse it, and apply the generation gate — KEEP iff
    ``quality_score >= min_quality_score`` (0.55) AND the routed distance is
    within ±``generation_length_tolerance`` (20%) of the target AND the loop is
    not a duplicate of an existing route (``routes_overlap_either``). Kept loops
    are upserted with ``source='generated'`` and their scores; every reject is
    logged WITH its score (``generation_reject_{length,quality,duplicate}``).

    Order of checks: length first (cheap), then quality, then duplicate (so a
    reject is attributed to its first failing reason). ORS quota exhaustion pauses
    the run (``quota_paused=True``, logged ``quota_exit``); the CLI maps it to a
    graceful exit 0.
    """
    from freewheel_corpus.clients.ors import OrsQuotaExceeded
    from freewheel_corpus.phases import p3_quality_scoring as p3

    s = settings or Settings()
    seed_points = seed_points if seed_points is not None else GENERATION_SEED_POINTS
    target_lengths_m = (
        target_lengths_m
        if target_lengths_m is not None
        else [km * 1000 for km in GENERATION_TARGET_KM]
    )
    seeds = seeds if seeds is not None else GENERATION_SEEDS
    coverage = p3.load_coverage(coverage_geojson)
    tol = s.generation_length_tolerance
    min_q = s.min_quality_score

    stats = GenerationStats()

    from shapely import wkb

    with conn.cursor() as cur, conn.cursor() as work_cur:
        # Load existing geometries once for the duplicate check (kept loops are
        # appended to this in-memory list so two new loops can't both survive as
        # duplicates of each other).
        cur.execute(_EXISTING_GEOMS_SQL)
        existing: list[LineString] = [
            wkb.loads(bytes(g)) for _, g in cur.fetchall()
        ]

        for sp_idx, start in enumerate(seed_points):
            for length_m in target_lengths_m:
                target_km = length_m / 1000.0
                for seed in seeds:
                    source_id = f"gen-{sp_idx}-{int(target_km)}km-s{seed}"
                    try:
                        fc = ors_client.round_trip(
                            start,
                            length_m=length_m,
                            points=GENERATION_ROUND_TRIP_POINTS,
                            seed=seed,
                        )
                    except OrsQuotaExceeded as exc:
                        stats.quota_paused = True
                        _log(work_cur, source=GENERATED_SOURCE,
                             event_type="quota_exit", source_ref=source_id,
                             details={"endpoint": exc.endpoint, "count": exc.count,
                                      "limit": exc.limit},
                             message=str(exc))
                        conn.commit()
                        return stats
                    except Exception as exc:
                        stats.ors_failed += 1
                        _log(work_cur, source=GENERATED_SOURCE,
                             event_type="generation_ors_error", source_ref=source_id,
                             details={"error": str(exc)},
                             message=f"ORS round_trip failed for {source_id}: {exc}")
                        continue

                    parsed = parse_ors_feature(fc)
                    line = parsed.line

                    # Score it inline (always, so rejects carry a score).
                    prot, grn, cov, q = _score_candidate(
                        work_cur, line, parsed.surface_breakdown,
                        coverage=coverage, facility_source=facility_source,
                        settings=s,
                    )
                    score_detail = {
                        "quality_score": round(q, 4),
                        "protected_lane_fraction": round(prot, 4),
                        "greenway_fraction": round(grn, 4),
                        "facility_coverage_fraction": round(cov, 4),
                        "routed_km": round(parsed.distance_km, 4),
                        "target_km": round(target_km, 4),
                        "threshold": min_q,
                    }

                    # Gate 1: length band.
                    if not _within_tolerance(parsed.distance_km, target_km, tol):
                        stats.rejected_length += 1
                        _log(work_cur, source=GENERATED_SOURCE,
                             event_type="generation_reject_length",
                             source_ref=source_id, details=score_detail,
                             message=(f"{source_id}: routed {parsed.distance_km:.1f} km "
                                      f"vs target {target_km:.0f} km "
                                      f"(> ±{int(tol*100)}%); rejected"))
                        continue

                    # Gate 2: quality band.
                    if q < min_q:
                        stats.rejected_quality += 1
                        _log(work_cur, source=GENERATED_SOURCE,
                             event_type="generation_reject_quality",
                             source_ref=source_id, details=score_detail,
                             message=(f"{source_id}: quality_score {q:.3f} "
                                      f"< {min_q}; rejected"))
                        continue

                    # Gate 3: duplicate of an existing (or already-kept) route.
                    if any(routes_overlap_either(line, ex) for ex in existing):
                        stats.rejected_duplicate += 1
                        _log(work_cur, source=GENERATED_SOURCE,
                             event_type="generation_reject_duplicate",
                             source_ref=source_id, details=score_detail,
                             message=(f"{source_id}: overlaps an existing route; "
                                      f"rejected as duplicate"))
                        continue

                    # Keep it.
                    startpt = line.coords[0]
                    tags = {"seed_point_index": sp_idx, "target_km": target_km, "seed": seed}
                    params = {
                        "region": REGION,
                        "source": GENERATED_SOURCE,
                        "source_id": source_id,
                        "name": f"Generated loop {int(target_km)} km (seed {seed}) #{sp_idx}",
                        "geom_wkt": line.wkt,
                        "start_wkt": f"POINT({startpt[0]} {startpt[1]})",
                        "is_loop": geometry.is_loop(line),
                        "distance_km": parsed.distance_km,
                        "match_quality": MATCH_QUALITY,
                        "ascent_m": parsed.ascent_m,
                        "descent_m": parsed.descent_m,
                        "surface_breakdown": json.dumps(parsed.surface_breakdown) if parsed.surface_breakdown else None,
                        "waytype_breakdown": json.dumps(parsed.waytype_breakdown) if parsed.waytype_breakdown else None,
                        "steepness_breakdown": json.dumps(parsed.steepness_breakdown) if parsed.steepness_breakdown else None,
                        "protected": prot,
                        "greenway": grn,
                        "coverage": cov,
                        "quality": q,
                        "tags": json.dumps(tags),
                        "attribution": GENERATED_ATTRIBUTION,
                    }
                    work_cur.execute(_GEN_UPSERT_SQL, params)
                    rid = work_cur.fetchone()[0]
                    stats.kept += 1
                    stats.ids.append(rid)
                    existing.append(line)  # prevent later dups against this one

    conn.commit()
    return stats
