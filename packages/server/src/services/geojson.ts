import type {
  Feature,
  FeatureCollection,
  Geometry,
  MultiLineString,
} from 'geojson';
import type { FacilityProps, FacilitiesResponse } from '@bike-route-ai/shared';

// Wrap a list of features in a GeoJSON FeatureCollection. Generic so it serves
// any geometry/properties pairing (routes overview, etc.) while staying
// `any`-free.
export function toFeatureCollection<G extends Geometry, P>(
  features: Feature<G, P>[],
): FeatureCollection<G, P> {
  return { type: 'FeatureCollection', features };
}

// The facilities endpoint augments a FeatureCollection with truncated/count
// meta (FacilitiesResponse shape).
export function toFacilitiesResponse(
  features: Feature<MultiLineString, FacilityProps>[],
  truncated: boolean,
  count: number,
): FacilitiesResponse {
  return { type: 'FeatureCollection', features, truncated, count };
}
