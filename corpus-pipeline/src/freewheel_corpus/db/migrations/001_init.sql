-- Migration 001 — initial PostGIS schema for the Freewheel corpus pipeline.
--
-- This is the ONLY migration in this build. Later phases (WP1-WP4) FILL and
-- COMPUTE columns; they do NOT add migrations. So every column any later phase
-- needs must be defined here.
--
-- ADR-0002: all projected geometry math uses EPSG:32618 (UTM 18N, metres);
--           stored geometry is EPSG:4326 (the SRID below).
-- ADR-0004: NO pgvector, NO description/embedding/embedding_model columns.
--           Those arrive in a documented future migration once the embedding
--           strategy (hence vector dimension) is chosen. See docs/embeddings-plan.md.
-- ADR-0003: cross-source dedup hard-deletes the losing row; the audit trail
--           lives in ingest_log (status='skipped_duplicate', both IDs in details).

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- routes — the sole integration seam with the serving app. The server's Route
-- DTO is a downstream projection of this table; design for the pipeline, not
-- the DTO.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS routes (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- Provenance + idempotency seam (upsert target for every phase).
    source          text NOT NULL,
    source_id       text NOT NULL,

    name            text,

    -- Geometry (EPSG:4326). geom_original holds the raw input for map-matched
    -- sources (Phase 2); NULL for native sources (Phase 1 OSM relations, canon).
    geom            geometry(LineString, 4326),
    geom_original   geometry(LineString, 4326),
    start_point     geometry(Point, 4326),

    is_loop         boolean,
    distance_km     double precision,

    -- 1.0 for native sources; matched_len/input_len for map-matched (Phase 2).
    match_quality   double precision,

    -- OSM provenance / tags.
    osm_way_ids     bigint[],
    network         text,
    operator        text,

    -- Elevation. NULL allowed (Q4: no mass elevation backfill for OSM relations).
    ascent_m        double precision,
    descent_m       double precision,

    -- Free-form tags JSONB. Holds e.g. canon's out_and_back flag (Q6b).
    tags            jsonb NOT NULL DEFAULT '{}'::jsonb,

    attribution     text,

    -- Fractional-by-length breakdowns (filled in Phases 2/4 from matched edges
    -- / decoded ORS RLE extras). JSONB maps {value -> fraction}.
    surface_breakdown    jsonb,
    waytype_breakdown    jsonb,
    steepness_breakdown  jsonb,

    -- Scoring columns (all nullable; filled in Phase 3 / WP3). EPSG:32618 math.
    protected_lane_fraction     double precision,
    greenway_fraction           double precision,
    facility_coverage_fraction  double precision,
    quality_score               double precision,

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT routes_source_source_id_key UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS routes_geom_gist        ON routes USING gist (geom);
CREATE INDEX IF NOT EXISTS routes_start_point_gist ON routes USING gist (start_point);

-- ---------------------------------------------------------------------------
-- facility_segments — NYC DOT (and later) bike-facility geometry, used by
-- Phase 3 scoring. Stored as MultiLineString; geom is NOT NULL.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS facility_segments (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    source          text NOT NULL,
    facility_id     text,

    -- Normalized class. Unknown source values map to 'other' + a logged warning.
    facility_class  text NOT NULL
        CHECK (facility_class IN ('protected', 'lane', 'sharrow', 'greenway', 'other')),

    geom            geometry(MultiLineString, 4326) NOT NULL,

    -- Q7b: filter to currently-existing facilities before storing; keep the
    -- source status so the filter is auditable.
    status          text,
    borough         text,

    attribution     text,

    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS facility_segments_geom_gist
    ON facility_segments USING gist (geom);

-- ---------------------------------------------------------------------------
-- ingest_log — append-only audit trail for every phase. Records skips,
-- rejects, dedup decisions, quota exits, etc.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingest_log (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    logged_at       timestamptz NOT NULL DEFAULT now(),

    phase           text,
    source          text,

    -- Event/type, e.g. failed_match, skipped_duplicate, rejected_short,
    -- gap_dropped, canon_skip_distance, quota_exit.
    event_type      text NOT NULL,

    -- Optional reference to the route/source this event concerns.
    route_id        bigint,
    source_ref      text,

    details         jsonb,
    message         text
);

CREATE INDEX IF NOT EXISTS ingest_log_event_type_idx ON ingest_log (event_type);
