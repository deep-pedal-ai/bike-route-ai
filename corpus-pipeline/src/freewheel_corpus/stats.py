"""Corpus ``stats`` — counts by source, score distribution, rejected/unmatched.

The CLI ``stats`` command formats a human report; this module owns the pure data
gathering so the shape is unit-testable (WP5 behavior 2). :func:`gather_stats`
runs a handful of read-only aggregate queries against the corpus and returns a
:class:`CorpusStats` struct:

- ``by_source`` — route counts per source (the "counts by source" deliverable).
- ``score_buckets`` — a ``quality_score`` histogram, rounded to one decimal
  (the "score distribution" deliverable; a min/avg/max summary alone is not a
  distribution, so we report both).
- ``rejected`` / ``unmatched`` — counts from the ``ingest_log`` audit trail
  (rejected = routes dropped/skipped before or during storage incl. dedup
  hard-deletes; unmatched = Phase-2 map-match failures).

All numbers come from the live DB; nothing is mutated. The score buckets use
PostgreSQL ``round(quality_score::numeric, 1)`` (round-half-up), so 0.55 → 0.6.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import psycopg

# ingest_log event types that mean "a candidate route did not make it into the
# corpus" (rejected) vs "a route's geometry could not be map-matched" (unmatched).
# Keep these explicit so a new event type does not silently change the counts.
REJECTED_EVENTS = (
    "rejected_short",
    "rejected_empty",
    "skipped_duplicate",
    "canon_skip_distance",
    "canon_skip_coord",
    "canon_ors_error",
    "generation_reject_length",
    "generation_reject_quality",
    "generation_reject_duplicate",
    "generation_ors_error",
)
UNMATCHED_EVENTS = ("failed_match",)


@dataclass
class CorpusStats:
    """The corpus shape reported by ``stats`` (WP5 behavior 2)."""

    total: int = 0
    scored: int = 0
    by_source: list[tuple[str, int]] = field(default_factory=list)
    score_min: float | None = None
    score_avg: float | None = None
    score_max: float | None = None
    # quality_score histogram: (bucket_value rounded to 0.1, count), ordered.
    score_buckets: list[tuple[float, int]] = field(default_factory=list)
    facility_segments: int = 0
    rejected: int = 0
    unmatched: int = 0
    # Full ingest_log event-type breakdown (for transparency in the report).
    events: list[tuple[str, int]] = field(default_factory=list)


def gather_stats(conn: psycopg.Connection) -> CorpusStats:
    """Gather the corpus stats (read-only) into a :class:`CorpusStats` struct."""
    result = CorpusStats()
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM routes")
        result.total = cur.fetchone()[0]

        cur.execute(
            "SELECT source, count(*) FROM routes GROUP BY source ORDER BY source"
        )
        result.by_source = [(s, n) for s, n in cur.fetchall()]

        cur.execute("SELECT count(*) FROM routes WHERE quality_score IS NOT NULL")
        result.scored = cur.fetchone()[0]

        cur.execute(
            "SELECT min(quality_score), avg(quality_score), max(quality_score) "
            "FROM routes WHERE quality_score IS NOT NULL"
        )
        qmin, qavg, qmax = cur.fetchone()
        result.score_min = float(qmin) if qmin is not None else None
        result.score_avg = float(qavg) if qavg is not None else None
        result.score_max = float(qmax) if qmax is not None else None

        # Score distribution: histogram in 0.1-wide buckets.
        cur.execute(
            "SELECT round(quality_score::numeric, 1) AS bucket, count(*) "
            "FROM routes WHERE quality_score IS NOT NULL "
            "GROUP BY bucket ORDER BY bucket"
        )
        result.score_buckets = [(float(b), n) for b, n in cur.fetchall()]

        cur.execute("SELECT count(*) FROM facility_segments")
        result.facility_segments = cur.fetchone()[0]

        cur.execute(
            "SELECT event_type, count(*) FROM ingest_log "
            "GROUP BY event_type ORDER BY event_type"
        )
        result.events = [(et, n) for et, n in cur.fetchall()]

    by_event = dict(result.events)
    result.rejected = sum(by_event.get(e, 0) for e in REJECTED_EVENTS)
    result.unmatched = sum(by_event.get(e, 0) for e in UNMATCHED_EVENTS)
    return result


def format_stats(result: CorpusStats) -> str:
    """Render a :class:`CorpusStats` as the human ``stats`` report (multi-line)."""
    lines = ["Freewheel corpus — stats", f"  routes total:        {result.total}"]
    lines.append("  routes by source:")
    if result.by_source:
        for src, n in result.by_source:
            lines.append(f"    {src}: {n}")
    else:
        lines.append("    (none)")
    lines.append(f"  scored routes:       {result.scored}")
    if result.scored:
        lines.append(
            f"  quality_score:       min={result.score_min:.3f} "
            f"avg={result.score_avg:.3f} max={result.score_max:.3f}"
        )
        lines.append("  score distribution (0.1 buckets):")
        for bucket, n in result.score_buckets:
            bar = "#" * n
            lines.append(f"    {bucket:.1f}: {n:>3}  {bar}")
    else:
        lines.append("  quality_score:       (no scored routes)")
    lines.append(f"  facility_segments:   {result.facility_segments}")
    lines.append(f"  rejected (logged):   {result.rejected}")
    lines.append(f"  unmatched (logged):  {result.unmatched}")
    lines.append("  ingest_log events:")
    if result.events:
        for et, n in result.events:
            lines.append(f"    {et}: {n}")
    else:
        lines.append("    (none)")
    return "\n".join(lines)
