// Corpus map-tab contract — TYPES ONLY (shared is types-only per CLAUDE.md).
// Frozen in P0; any change requires an orchestrator re-freeze + dependent notice.
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
  distance_km: number | null;
  is_loop: boolean | null;
  quality_score: number | null;
  ascent_m: number | null;
  descent_m: number | null;
  network: string | null;
};

// POI enrichment (feature: docs/poi-enrichment-feature.md). The five display
// buckets — these slugs are the contract shared verbatim with the Python
// pipeline's POI taxonomy (corpus-pipeline .../poi/taxonomy.py). Pins are
// colored/iconned by bucket on the client.
export type PoiBucket =
  | 'coffee_food'
  | 'water_rest'
  | 'scenic'
  | 'landmark'
  | 'bike_services';

// One nearby point of interest, as served on the route-detail response. Display
// only — proper nouns/coords/images live here, never in the embedding (§7).
// Coordinates are EPSG:4326. `position_fraction` is 0..1 along the route and
// drives pin ordering. Image fields are null for most POIs (§2a) — render the
// bucket icon and omit the thumbnail when `image_url` is null. The Google Maps
// deep-link is derived on the client from (lat,lng), never stored.
export type PoiSummary = {
  id: number;
  name: string | null;
  bucket: PoiBucket;
  lat: number;
  lng: number;
  distance_m: number;
  position_fraction: number | null;
  image_url: string | null;
  image_license: string | null;
  image_attribution: string | null;
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
  // Nearby POIs, ordered by position_fraction. Optional for back-compat with a
  // server build that predates S8; clients treat a missing value as []. Always
  // present (possibly empty) once the detail read-path JOINs it in.
  pois?: PoiSummary[];
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
