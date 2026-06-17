-- Migration 003 — POI enrichment (feature: docs/poi-enrichment-feature.md §5).
--
-- Additive only: Phase 1-5 schema is untouched. Two new tables produced by the
-- new offline phase p6. `pois` is normalized (one row per OSM place — a place
-- near several routes is fetched, and its Wikimedia image resolved, ONCE) and
-- `route_pois` is the per-route link carrying the route-relative facts.
--
-- We store the Commons image *URL* + license + attribution, never a blob: the
-- DB stays light and Wikimedia's attribution requirement is satisfiable from the
-- row. The Google Maps deep-link is derived on the frontend from geometry and is
-- deliberately NOT stored (it would be stale duplication).

CREATE TABLE IF NOT EXISTS pois (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- OSM provenance + idempotency seam (upsert target for p6 re-runs).
    osm_type           text NOT NULL,          -- node | way | relation
    osm_id             bigint NOT NULL,

    name               text,
    category_bucket    text NOT NULL,          -- one of the 5 buckets (feature §6)

    geom               geometry(Point, 4326) NOT NULL,

    -- Raw OSM tags retained so we can re-bucket / re-rank later WITHOUT re-hitting
    -- Overpass (provenance, not decoration).
    raw_osm_tags       jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- Image provenance via wikidata -> Wikidata P18 -> Commons. Most POIs resolve
    -- to no image and that is the expected case (feature §2a), so all nullable.
    wikidata_id        text,
    image_url          text,
    image_license      text,                   -- licensing compliance, not optional when image present
    image_attribution  text,                   -- Wikimedia requires attribution display

    last_refreshed_at  timestamptz NOT NULL DEFAULT now(),  -- freshness key for p6 skip window
    created_at         timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT pois_osm_key UNIQUE (osm_type, osm_id)   -- makes p6 re-runs idempotent (upsert on conflict)
);

CREATE INDEX IF NOT EXISTS pois_geom_gist ON pois USING gist (geom);

CREATE TABLE IF NOT EXISTS route_pois (
    route_id           bigint NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    poi_id             bigint NOT NULL REFERENCES pois(id)   ON DELETE CASCADE,
    distance_m         double precision NOT NULL,   -- POI -> route line, metres
    matched_bucket     text NOT NULL,
    position_fraction  double precision,            -- 0..1 along route: powers spread + pin ordering
    PRIMARY KEY (route_id, poi_id)
);

CREATE INDEX IF NOT EXISTS route_pois_route_id_idx ON route_pois (route_id);
