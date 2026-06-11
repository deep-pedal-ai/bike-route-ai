"""TDD (WP5 remediation): the length-ratio GUARD on the cross-source dedup pass.

The full-table dedup over-deleted distinct rides that merely share a corridor: a
SHORT ride wholly contained inside a LONG corridor reads as a duplicate under
``geometry.routes_overlap`` ("> 80% of the SHORTER route inside buffer(longer)"),
so the ladder/tiebreak then kept the shorter and hard-deleted the longer, more
complete ride (e.g. three different 9W-corridor destinations collapsing to one).

The fix: two routes may be merged ONLY IF they are both highly overlapping AND
similar in length —
``min(len_a, len_b) / max(len_a, len_b) >= dedup_length_ratio_min`` (default
0.8) — applied IN the dedup APPLICATION (:func:`p4.apply_dedup_pass`), so the
WP1 :func:`geometry.routes_overlap` semantics and the generation gate's use of
:func:`p4.routes_overlap_either` stay intact.

DB-backed (TEST_DATABASE_URL via ``clean_db``); skips cleanly when unset.
"""

from __future__ import annotations

from freewheel_corpus import migrations
from freewheel_corpus.phases import p4_canon_and_generation as p4

# A LONG corridor (canon, ~more complete) and a SHORT ride contained inside it on
# the same alignment (a different, distinct destination that happens to share the
# corridor). The short one overlaps > 80% of ITS OWN (shorter) length with the
# long one's buffer, so the un-guarded predicate flags them as duplicates — but
# their length ratio is far below 0.8, so the GUARD must keep BOTH.
_LONG_CORRIDOR = (
    "LINESTRING(-73.980 40.750, -73.960 40.750, -73.940 40.750, "
    "-73.920 40.750, -73.900 40.750, -73.880 40.750)"
)
# Short ride lies exactly on the first fifth of the corridor (fully inside the
# 25 m buffer of the long line) — a classic "short inside long corridor" pair.
_SHORT_INSIDE = "LINESTRING(-73.980 40.750, -73.972 40.750)"

# A near-equal-length coincident pair (a TRUE duplicate): same alignment, tiny
# lat offset, ratio ≈ 1.0 → must still be merged (lower-precedence loser deleted).
_DUP_A = "LINESTRING(-73.980 40.760, -73.960 40.760, -73.940 40.760)"
_DUP_B = "LINESTRING(-73.980 40.7601, -73.960 40.7601, -73.940 40.7601)"

# A DISTINCT same-corridor pair at length ratio ≈ 0.92 — the calibration case.
# Two out-and-back rides up the SAME corridor to DIFFERENT (nearby) turnarounds:
# the shorter is ~0.92× the longer and lies fully inside the longer's 25 m buffer
# (so the overlap predicate flags them), but they are genuinely distinct rides.
# This pair is the empirical signature of the live 9W rides (State Line Lookout ↔
# State Bike Route 9 measured 0.922). It MUST NOT be merged at the calibrated 0.95
# threshold — this test FAILS at 0.9 and PASSES at 0.95, pinning the calibration
# so a later revert to a lower default is caught. The longer line spans 13 segments
# (~0.06° lon, ~5 km projected) E→W; the shorter retraces ~12/13 of it.
_CORR_LONG = (
    "LINESTRING(-73.980 40.755, -73.975 40.755, -73.970 40.755, -73.965 40.755, "
    "-73.960 40.755, -73.955 40.755, -73.950 40.755, -73.945 40.755, "
    "-73.940 40.755, -73.935 40.755, -73.930 40.755, -73.925 40.755, "
    "-73.920 40.755)"
)
# Shorter ride: same corridor, turns around ~1 segment earlier (~12/13 ≈ 0.92).
_CORR_SHORT = (
    "LINESTRING(-73.980 40.755, -73.975 40.755, -73.970 40.755, -73.965 40.755, "
    "-73.960 40.755, -73.955 40.755, -73.950 40.755, -73.945 40.755, "
    "-73.940 40.755, -73.935 40.755, -73.930 40.755, -73.9255 40.755)"
)


def _migrate(conn):
    migrations.run_migrations(conn)
    conn.commit()


def _insert(conn, *, source, source_id, wkt):
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO routes (source, source_id, name, geom, distance_km,
                                match_quality, quality_score, attribution)
            VALUES (%s, %s, %s, ST_GeomFromText(%s, 4326), 1.0, 1.0, 0.5, 'test')
            RETURNING id
            """,
            (source, source_id, f"{source}:{source_id}", wkt),
        )
        rid = cur.fetchone()[0]
    conn.commit()
    return rid


def _ids(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT id, source FROM routes ORDER BY id")
        return cur.fetchall()


def _dup_logs(conn):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT details FROM ingest_log WHERE event_type='skipped_duplicate'"
        )
        return [r[0] for r in cur.fetchall()]


def test_short_ride_inside_long_corridor_is_NOT_merged(clean_db):
    """(a) A short ride contained inside a long corridor (overlaps > 80% of its
    OWN length but length-ratio << 0.8) is NOT a duplicate — BOTH survive, no
    hard-delete, no skipped_duplicate log.

    This is the over-deletion the WP5 full pass caused; the length-ratio guard
    fixes it. Even though canon outranks osm in the ladder, the pair must never
    reach the precedence step because they are not similar-length."""
    _migrate(clean_db)
    long_id = _insert(clean_db, source="canon", source_id="long",
                      wkt=_LONG_CORRIDOR)
    short_id = _insert(clean_db, source="osm_relation", source_id="short",
                       wkt=_SHORT_INSIDE)

    removed = p4.apply_dedup_pass(clean_db)

    assert removed == 0, "short-inside-long-corridor must NOT be deduped"
    assert {r[0] for r in _ids(clean_db)} == {long_id, short_id}
    assert _dup_logs(clean_db) == []


def test_near_equal_length_coincident_pair_is_merged(clean_db):
    """(b) A near-equal-length coincident pair (a TRUE duplicate; ratio ≈ 1.0) is
    still merged: the lower-precedence loser is hard-deleted and both IDs logged.

    The guard must not over-protect — genuine duplicates of similar length still
    collapse per the ladder (canon beats osm)."""
    _migrate(clean_db)
    canon_id = _insert(clean_db, source="canon", source_id="dup-a", wkt=_DUP_A)
    osm_id = _insert(clean_db, source="osm_relation", source_id="dup-b", wkt=_DUP_B)

    removed = p4.apply_dedup_pass(clean_db)

    assert removed == 1
    surviving = _ids(clean_db)
    assert surviving == [(canon_id, "canon")]  # canon kept, osm deleted

    logs = _dup_logs(clean_db)
    assert len(logs) == 1
    assert logs[0]["kept_id"] == canon_id
    assert logs[0]["deleted_id"] == osm_id


def test_distinct_same_corridor_pair_at_ratio_92_is_NOT_merged(clean_db):
    """Calibration lock (WP5 remediation): two DISTINCT same-corridor rides whose
    length ratio is ≈ 0.92 (the live State-Line-Lookout ↔ State-Bike-Route-9
    signature) must NOT be merged at the calibrated 0.95 threshold.

    The brief's suggested 0.8 default — and even 0.9 — would delete one of these
    as a "duplicate" of the other, destroying a distinct named ride. This test
    FAILS at any threshold ≤ 0.92 and PASSES at 0.95, so it pins the calibration:
    a later revert to a lower default is caught by a red test, not by losing a
    corpus ride silently. The two complementary cases above (short-inside-long
    NOT merged; near-equal coincident MERGED) stay green at 0.95 too."""
    _migrate(clean_db)
    from freewheel_corpus import geometry
    from shapely import wkt as _wkt

    # Sanity: the fixture really is in the distinct-ride band (≈0.92), not a true
    # duplicate (≥0.997) — so this test asserts the calibration, not a typo.
    ratio = geometry.length_ratio(_wkt.loads(_CORR_LONG), _wkt.loads(_CORR_SHORT))
    assert 0.90 <= ratio < 0.95, f"fixture ratio {ratio:.3f} not in the 0.90–0.95 band"

    long_id = _insert(clean_db, source="canon", source_id="corr-long",
                      wkt=_CORR_LONG)
    short_id = _insert(clean_db, source="nysdot", source_id="corr-short",
                       wkt=_CORR_SHORT)

    removed = p4.apply_dedup_pass(clean_db)

    assert removed == 0, (
        "a distinct same-corridor pair at ratio ≈0.92 must NOT be deduped at the "
        "calibrated 0.95 threshold (would destroy a distinct named ride)"
    )
    assert {r[0] for r in _ids(clean_db)} == {long_id, short_id}
    assert _dup_logs(clean_db) == []
