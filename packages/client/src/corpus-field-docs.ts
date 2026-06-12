import type { CorpusRouteDetailProps } from '@bike-route-ai/shared';

// Plain-English field descriptions, copied/adapted from the corpus-pipeline
// migration `001_init.sql` column comments. These drive the RouteDetailPanel
// tooltips — the "understand my data" surface. Keyed by `CorpusRouteDetailProps`
// so a missing field fails typecheck (exhaustiveness guard).
export const CORPUS_FIELD_DOCS: Record<keyof CorpusRouteDetailProps, string> = {
  id: 'Stable primary key for this route in the corpus.',
  name: 'Human-readable route name (may be empty for unnamed routes).',
  source:
    'Provenance — which pipeline source produced this route (e.g. osm_relation, canon, nysdot, generated).',
  source_id:
    'Stable per-source identifier; (source, source_id) uniquely keys the route — the pipeline upsert/idempotency seam.',
  distance_km: 'Route length in kilometres.',
  is_loop: 'Whether the route returns to its start (a loop).',
  quality_score:
    'Overall route quality score (0–1), computed in the Phase 3 scoring pass.',
  ascent_m:
    'Total elevation gain in metres. Null when not computed (no mass elevation backfill for OSM relations).',
  descent_m: 'Total elevation loss in metres. Null when not computed.',
  network: 'OSM cycle-network classification (e.g. lcn/rcn/ncn) where present.',
  match_quality:
    '1.0 for native sources; matched_len/input_len for map-matched routes.',
  surface_breakdown:
    'Fraction of the route by surface type (e.g. asphalt, gravel) — a map of value → fraction-by-length.',
  waytype_breakdown:
    'Fraction of the route by way type (e.g. cycleway, footway, street) — a map of value → fraction-by-length.',
  steepness_breakdown:
    'Fraction of the route by steepness bucket — a map of value → fraction-by-length.',
  protected_lane_fraction:
    'Fraction of the route length on protected bike lanes (Phase 3 scoring).',
  greenway_fraction:
    'Fraction of the route length on greenways (Phase 3 scoring).',
  facility_coverage_fraction:
    'Fraction of the route length covered by any mapped bike facility (Phase 3 scoring).',
  attribution: "Required source attribution / licence text for this route's data.",
  osm_way_id_count:
    'Number of OSM way IDs backing this route (0 for non-OSM sources).',
  tags: "Free-form tags carried from the source (e.g. canon's out_and_back flag).",
};
