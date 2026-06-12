---
status: accepted
---

# Cross-source dedup keeps the higher-precedence source and hard-deletes the loser

Marquee NYC rides (Central Park loop, Hudson River Greenway, Prospect Park,
etc.) will almost certainly appear more than once: as an `osm_relation` harvested
in Phase 1 **and** as a hand-curated `canon` entry in Phase 4. Two routes are
duplicates when, after `ST_Simplify`, the length of
`ST_Intersection(ST_Buffer(a, 25m), b)` exceeds 80% of the shorter route's
length (computed in the projected CRS — see ADR-0002).

The spec says "keep the higher-quality source", but `quality_score` ties or
flips arbitrarily between `canon` and `osm_relation` (both carry source-prior
1.0), so the winner would be non-deterministic and could change between
phase-3 re-runs.

**Decision:**
- Dedup runs as an explicit **full-table cross-source pass** during the final
  Phase-3 re-run, after every source is ingested and scored.
- Ties / near-ties break by a fixed precedence ladder:
  **`canon > osm_relation > nysdot > usbrs > generated`**.
- The losing row is **hard-deleted**; an `ingest_log` row records
  `status='skipped_duplicate'` with both route IDs in `detail`.

**Why precedence over raw score:** a coordinate-verified, human-curated canon
ride is more trustworthy than a raw OSM relation of the nominally-same route,
even when facility math gives the OSM row a fractionally higher score. The
ladder makes the surviving row deterministic and re-run stable.

**Why hard-delete over tombstone:** keeps the `routes` table clean for the
recommender (no double-recommendations) and needs no extra column; the audit
trail lives in `ingest_log`.

> NOTE (WP4): WP2 later introduced a `source='open_gpx'` not present in the
> original ladder above. It is slotted just above `generated`
> (`canon > osm_relation > nysdot > usbrs > open_gpx > generated`): manual GPX is
> more trustworthy than a machine-generated loop but below the government/native
> sources. See `phases/p4_canon_and_generation.SOURCE_PRECEDENCE`.
