-- Migration 004 — region partition key (multi-region corpus, Slice 1).
--
-- NOTE: renumbered 003 -> 004. The live freewheel-corpus DB already applied a
-- DIFFERENT migration 003 (003_pois.sql, the POI feature, from the
-- point-of-interest-enrichment branch) out-of-band. Both features independently
-- claimed slot 003; this one moved to 004 so the ledger stays consistent and
-- this migration stacks cleanly on top of 003_pois on the existing DB.
--
-- Introduces `region` as the read partition key end-to-end. The serving app
-- scopes the routes query, the initial camera, the facility bbox, and the
-- vector-similarity search by region so a query in one metro never ranks
-- another metro's routes (see docs/multi-region-seattle-plan.md §0, §5).
--
-- Slice 1 is NY-only: every existing row backfills to 'ny' via the NOT NULL
-- DEFAULT, and the pipeline phases write region='ny' explicitly (a literal for
-- now; the RegionProfile threading is a later slice). No Seattle data lands
-- here.
--
-- The `routes` unique key changes from (source, source_id) to
-- (region, source, source_id): OSM relation ids are globally unique, but canon
-- slugs and generated ids can collide across regions. Cross-region dedup is
-- geometrically harmless (bboxes a continent apart never overlap), so this is
-- about serving + per-region stats, not dedup correctness (§5).
--
-- Re-runnable: ADD COLUMN IF NOT EXISTS, and DROP CONSTRAINT IF EXISTS (both
-- the old and the new name) before ADD CONSTRAINT, so the script is idempotent
-- on its own — independent of the runner's schema_migrations ledger.

ALTER TABLE routes
    ADD COLUMN IF NOT EXISTS region text NOT NULL DEFAULT 'ny';

ALTER TABLE facility_segments
    ADD COLUMN IF NOT EXISTS region text NOT NULL DEFAULT 'ny';

-- Swap the unique key to include region. Drop the old constraint and the new
-- one (if a prior run added it) so the ADD below is re-runnable.
ALTER TABLE routes DROP CONSTRAINT IF EXISTS routes_source_source_id_key;
ALTER TABLE routes DROP CONSTRAINT IF EXISTS routes_region_source_source_id_key;
ALTER TABLE routes
    ADD CONSTRAINT routes_region_source_source_id_key
    UNIQUE (region, source, source_id);
