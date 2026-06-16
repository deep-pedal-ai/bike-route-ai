import { describe, it, expect, afterAll } from 'vitest';

import { closePool } from '../db.js';
import {
  getRoutesOverview,
  getRouteById,
  getFacilitiesInBbox,
  getStats,
} from './corpus-client.js';

import type {
  CorpusRouteProps,
  CorpusRouteDetailProps,
} from '@bike-route-ai/shared';

// Integration tests hit the live Neon test branch. They only run when a test DB
// connection string is provided (TEST_DATABASE_URL, loaded by dotenv setupFiles);
// otherwise the whole suite is skipped with a clear message.
const TEST_DB_URL = process.env.TEST_DATABASE_URL;

// Point the lazy pool (db.ts reads DATABASE_URL) at the Neon test branch for this
// test process only. Lands before the first getPool() call, so the singleton picks
// it up. The runtime server is unaffected — it never sets TEST_DATABASE_URL.
if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
}

// Generous per-test timeout for Neon cold-start (applied on each it() where it is
// unambiguously honored, and on the describe block as a fallback).
const INTEGRATION_TIMEOUT_MS = 30_000;

// NY bounding box (lng, lat) — proves coordinate order is [lng, lat], not flipped.
const NY_BBOX = { minLng: -75.1, minLat: 40.2, maxLng: -72.7, maxLat: 44.2 } as const;
const inNyBbox = ([lng, lat]: [number, number]): boolean =>
  lng >= NY_BBOX.minLng &&
  lng <= NY_BBOX.maxLng &&
  lat >= NY_BBOX.minLat &&
  lat <= NY_BBOX.maxLat;

const OVERVIEW_KEYS: ReadonlyArray<keyof CorpusRouteProps> = [
  'id',
  'name',
  'source',
  'region',
  'distance_km',
  'is_loop',
  'quality_score',
  'ascent_m',
  'descent_m',
  'network',
];

const DETAIL_KEYS: ReadonlyArray<keyof CorpusRouteDetailProps> = [
  ...OVERVIEW_KEYS,
  'source_id',
  'match_quality',
  'surface_breakdown',
  'waytype_breakdown',
  'steepness_breakdown',
  'protected_lane_fraction',
  'greenway_fraction',
  'facility_coverage_fraction',
  'attribution',
  'osm_way_id_count',
  'tags',
  // S8: detail read-path JOINs nearby POIs; coalesce(..., '[]') makes the key
  // always present, so the exact-key assertion below must include it.
  'pois',
];

// A tiny bbox (sparse) vs a metro-wide bbox (dense, exceeds the cap).
const TINY_BBOX: [number, number, number, number] = [-73.99, 40.74, -73.98, 40.75];
const METRO_BBOX: [number, number, number, number] = [-74.1, 40.5, -73.7, 40.95];

const describeIf = TEST_DB_URL ? describe : describe.skip;

if (!TEST_DB_URL) {
  console.log(
    '[corpus-client.test] TEST_DATABASE_URL not set — skipping Neon integration tests.',
  );
}

describeIf(
  'corpus-client (integration, Neon test branch)',
  () => {
    afterAll(async () => {
      await closePool();
    });

    it('getRoutesOverview returns non-empty LineString Features with NY coords', async () => {
      const features = await getRoutesOverview();

      expect(Array.isArray(features)).toBe(true);
      expect(features.length).toBeGreaterThan(0);

      for (const feature of features) {
        expect(feature.type).toBe('Feature');
        expect(feature.geometry.type).toBe('LineString');
      }

      const firstCoord = features[0].geometry.coordinates[0] as [number, number];
      expect(inNyBbox(firstCoord)).toBe(true);
    }, INTEGRATION_TIMEOUT_MS);

    it('overview feature.properties has exactly the CorpusRouteProps keys', async () => {
      const features = await getRoutesOverview();
      const keys = Object.keys(features[0].properties).sort();
      expect(keys).toEqual([...OVERVIEW_KEYS].sort());
    }, INTEGRATION_TIMEOUT_MS);

    it('getRouteById(known) returns full detail; surface_breakdown is object|null; getRouteById(-1) is null', async () => {
      const overview = await getRoutesOverview();
      const knownId = overview[0].properties.id;

      const feature = await getRouteById(knownId);
      expect(feature).not.toBeNull();
      if (feature === null) throw new Error('expected a Feature');

      expect(feature.type).toBe('Feature');
      expect(feature.geometry.type).toBe('LineString');

      const keys = Object.keys(feature.properties).sort();
      expect(keys).toEqual([...DETAIL_KEYS].sort());

      const { surface_breakdown, osm_way_id_count, tags } = feature.properties;
      const surfaceIsObjectOrNull =
        surface_breakdown === null ||
        (typeof surface_breakdown === 'object' &&
          !Array.isArray(surface_breakdown));
      expect(surfaceIsObjectOrNull).toBe(true);
      expect(typeof osm_way_id_count).toBe('number');
      expect(typeof tags).toBe('object');

      const missing = await getRouteById(-1);
      expect(missing).toBeNull();
    }, INTEGRATION_TIMEOUT_MS);

    it('getFacilitiesInBbox: tiny bbox has fewer features than metro; class filter returns only that class', async () => {
      const tiny = await getFacilitiesInBbox(TINY_BBOX);
      const metro = await getFacilitiesInBbox(METRO_BBOX);

      expect(tiny.count).toBeLessThan(metro.count);
      expect(tiny.features.length).toBe(tiny.count);

      for (const feature of metro.features) {
        expect(feature.type).toBe('Feature');
        expect(feature.geometry.type).toBe('MultiLineString');
      }

      const protectedOnly = await getFacilitiesInBbox(METRO_BBOX, ['protected']);
      expect(protectedOnly.features.length).toBeGreaterThan(0);
      for (const feature of protectedOnly.features) {
        expect(feature.properties.facility_class).toBe('protected');
      }
    }, INTEGRATION_TIMEOUT_MS);

    it('getFacilitiesInBbox: metro-wide bbox sets truncated=true; tiny bbox sets truncated=false', async () => {
      const metro = await getFacilitiesInBbox(METRO_BBOX);
      expect(metro.truncated).toBe(true);
      expect(metro.features.length).toBe(metro.count);

      const tiny = await getFacilitiesInBbox(TINY_BBOX);
      expect(tiny.truncated).toBe(false);
    }, INTEGRATION_TIMEOUT_MS);

    it('getStats: counts are JSON numbers (not pg strings) and bbox is a NY tuple', async () => {
      const stats = await getStats();

      expect(typeof stats.routes_by_source).toBe('object');
      expect(Object.keys(stats.routes_by_source).length).toBeGreaterThan(0);
      for (const value of Object.values(stats.routes_by_source)) {
        // Guards the bigint/count-as-string trap: must be a real number.
        expect(typeof value).toBe('number');
      }

      expect(Object.keys(stats.facilities_by_class).length).toBeGreaterThan(0);
      for (const value of Object.values(stats.facilities_by_class)) {
        expect(typeof value).toBe('number');
      }

      expect(stats.bbox).toHaveLength(4);
      for (const n of stats.bbox) expect(typeof n).toBe('number');
      const [minLng, minLat, maxLng, maxLat] = stats.bbox;
      expect(minLng).toBeLessThan(maxLng);
      expect(minLat).toBeLessThan(maxLat);
      expect(inNyBbox([minLng, minLat])).toBe(true);
      expect(inNyBbox([maxLng, maxLat])).toBe(true);
    }, INTEGRATION_TIMEOUT_MS);
  },
  INTEGRATION_TIMEOUT_MS,
);
