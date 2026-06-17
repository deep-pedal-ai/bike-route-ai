import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiLineString,
} from 'geojson';
import type {
  CorpusRouteProps,
  CorpusRouteDetailProps,
  CorpusStats,
  FacilityProps,
  FacilitiesResponse,
} from '@bike-route-ai/shared';

import { toFeatureCollection, toFacilitiesResponse } from './geojson.js';

// The read seam the service depends on. S1's clients/corpus-client.ts implements
// these EXACT signatures; the service depends only on this type (never the real
// client, which hits the DB and is built in parallel).
export type CorpusClient = {
  getRoutesOverview(
    region?: string,
  ): Promise<Feature<LineString, CorpusRouteProps>[]>;
  getRouteById(
    id: number,
  ): Promise<Feature<LineString, CorpusRouteDetailProps> | null>;
  getFacilitiesInBbox(
    bbox: [number, number, number, number],
    classes?: string[],
  ): Promise<{
    features: Feature<MultiLineString, FacilityProps>[];
    truncated: boolean;
    count: number;
  }>;
  getStats(): Promise<CorpusStats>;
};

// A typed error carrying an HTTP statusCode. The central error handler (S3a)
// duck-types on `err.statusCode ?? 500`, so a local class is all that's needed;
// we deliberately do NOT import middleware/error-handler.ts (out of scope,
// built in parallel).
export class ServiceError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'ServiceError';
    this.statusCode = statusCode;
  }
}

// The 5 known facility classes; anything else is dropped by parseClasses.
const KNOWN_CLASSES = [
  'protected',
  'lane',
  'sharrow',
  'greenway',
  'other',
] as const;

export type Bbox = [number, number, number, number];

// Parse "minLng,minLat,maxLng,maxLat" into a tuple. Requires 4 FINITE numbers
// with minLng < maxLng AND minLat < maxLat, else throws a 400-shaped error.
export function parseBbox(str: string): Bbox {
  const parts = str.split(',');
  if (parts.length !== 4) {
    throw new ServiceError(400, 'bbox must be 4 comma-separated numbers');
  }
  const nums = parts.map((p) => Number(p));
  if (!nums.every((n) => Number.isFinite(n))) {
    throw new ServiceError(400, 'bbox must contain only finite numbers');
  }
  const [minLng, minLat, maxLng, maxLat] = nums;
  if (minLng >= maxLng || minLat >= maxLat) {
    throw new ServiceError(400, 'bbox min must be less than max');
  }
  return [minLng, minLat, maxLng, maxLat];
}

// Parse a comma-separated class list, whitelisting against the 5 known classes
// and dropping unknown values. Returns undefined when the result is empty
// (absent, '', or all-unknown) — undefined means "all classes".
export function parseClasses(str?: string): string[] | undefined {
  if (str === undefined) {
    return undefined;
  }
  const known: readonly string[] = KNOWN_CLASSES;
  const filtered = str
    .split(',')
    .map((c) => c.trim())
    .filter((c) => known.includes(c));
  return filtered.length > 0 ? filtered : undefined;
}

// Factory: wire a CorpusClient into the pure application-service operations.
export function createCorpusService(client: CorpusClient) {
  return {
    async listRoutes(
      region?: string,
    ): Promise<FeatureCollection<LineString, CorpusRouteProps>> {
      const features = await client.getRoutesOverview(region);
      return toFeatureCollection(features);
    },

    async getRoute(
      id: number,
    ): Promise<Feature<LineString, CorpusRouteDetailProps>> {
      const feature = await client.getRouteById(id);
      if (feature === null) {
        throw new ServiceError(404, `route ${id} not found`);
      }
      return feature;
    },

    async listFacilities(
      rawBbox: string,
      rawClasses?: string,
    ): Promise<FacilitiesResponse> {
      const bbox = parseBbox(rawBbox);
      const classes = parseClasses(rawClasses);
      const { features, truncated, count } = await client.getFacilitiesInBbox(
        bbox,
        classes,
      );
      return toFacilitiesResponse(features, truncated, count);
    },

    async stats(): Promise<CorpusStats> {
      return client.getStats();
    },
  };
}
