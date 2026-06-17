// Corpus map-tab contract — TYPES ONLY (shared is types-only per CLAUDE.md).
// Frozen in P0; any change requires an orchestrator re-freeze + dependent notice.
// RE-FROZEN (multi-region Slice 1): added `region` to CorpusRouteProps as the
// read partition key (flows into CorpusRouteDetailProps). Dependents notified:
//   server  — db/schema.ts mirror, corpus-client.ts SQL (overview + detail),
//             corpus-service getRoutesOverview(region?) seam.
//   client  — corpus-field-docs.ts (exhaustive Record over the detail keys),
//             RouteDetailPanel tooltips, use-corpus-routes(region) hook.
// GeoJSON-native: geometry is EPSG:4326 with [lng, lat] coordinate order.
import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiLineString,
} from 'geojson';

// Overview properties — returned for every route in GET /api/corpus/routes.
export type CorpusRouteProps = {
  id: number;
  name: string | null;
  source: string;
  // Read partition key (e.g. 'ny'). Every route belongs to exactly one region;
  // the serving app scopes queries, camera, and search by it.
  region: string;
  distance_km: number | null;
  is_loop: boolean | null;
  quality_score: number | null;
  ascent_m: number | null;
  descent_m: number | null;
  network: string | null;
};

// Full detail — returned for GET /api/corpus/routes/:id.
export type CorpusRouteDetailProps = CorpusRouteProps & {
  source_id: string;
  match_quality: number | null;
  surface_breakdown: Record<string, number> | null;
  waytype_breakdown: Record<string, number> | null;
  steepness_breakdown: Record<string, number> | null;
  protected_lane_fraction: number | null;
  greenway_fraction: number | null;
  facility_coverage_fraction: number | null;
  attribution: string | null;
  osm_way_id_count: number;
  tags: Record<string, unknown>;
};

export type FacilityProps = {
  id: number;
  facility_class: string;
  borough: string | null;
};

// ---- Endpoint payloads -----------------------------------------------------
export type CorpusRoutesResponse = FeatureCollection<LineString, CorpusRouteProps>;
export type CorpusRouteDetailResponse = Feature<LineString, CorpusRouteDetailProps>;

export type FacilitiesResponseMeta = { truncated: boolean; count: number };
export type FacilitiesResponse = FeatureCollection<MultiLineString, FacilityProps> &
  FacilitiesResponseMeta;

export type CorpusStats = {
  routes_by_source: Record<string, number>;
  facilities_by_class: Record<string, number>;
  bbox: [number, number, number, number];
};

// Bounding box as [minLng, minLat, maxLng, maxLat].
export type Bbox = [number, number, number, number];
