import { describe, it, expect, vi } from 'vitest';
import type { Feature, LineString, MultiLineString } from 'geojson';
import type {
  CorpusRouteProps,
  CorpusRouteDetailProps,
  CorpusStats,
  FacilityProps,
  PoiSummary,
} from '@bike-route-ai/shared';

import {
  parseBbox,
  parseClasses,
  createCorpusService,
} from './corpus-service.js';
import type { CorpusClient } from './corpus-service.js';

const routeFeature = (id: number): Feature<LineString, CorpusRouteProps> => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [[-74, 40], [-73, 41]] },
  properties: {
    id,
    name: `route-${id}`,
    source: 'canon',
    region: 'ny',
    distance_km: 10,
    is_loop: false,
    quality_score: 0.5,
    ascent_m: 100,
    descent_m: 100,
    network: null,
  },
});

const detailFeature = (
  id: number,
): Feature<LineString, CorpusRouteDetailProps> => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [[-74, 40], [-73, 41]] },
  properties: {
    ...routeFeature(id).properties,
    source_id: 'osm-1',
    match_quality: null,
    surface_breakdown: null,
    waytype_breakdown: null,
    steepness_breakdown: null,
    protected_lane_fraction: null,
    greenway_fraction: null,
    facility_coverage_fraction: null,
    attribution: null,
    osm_way_id_count: 0,
    tags: {},
  },
});

const poiSummary = (
  id: number,
  position_fraction: number | null,
  overrides: Partial<PoiSummary> = {},
): PoiSummary => ({
  id,
  name: `poi-${id}`,
  bucket: 'coffee_food',
  lat: 40.5,
  lng: -73.9,
  distance_m: 42,
  position_fraction,
  image_url: null,
  image_license: null,
  image_attribution: null,
  ...overrides,
});

const facilityFeature = (
  id: number,
): Feature<MultiLineString, FacilityProps> => ({
  type: 'Feature',
  geometry: { type: 'MultiLineString', coordinates: [[[-74, 40], [-73, 41]]] },
  properties: { id, facility_class: 'protected', borough: null },
});

const stats: CorpusStats = {
  routes_by_source: { canon: 2 },
  facilities_by_class: { protected: 1 },
  bbox: [-74, 40, -73, 41],
};

// Build a fully-mocked CorpusClient with vi.fn()s. Tests override per-need.
const makeClient = (overrides: Partial<CorpusClient> = {}): CorpusClient => ({
  getRoutesOverview: vi.fn().mockResolvedValue([]),
  getRouteById: vi.fn().mockResolvedValue(null),
  getFacilitiesInBbox: vi
    .fn()
    .mockResolvedValue({ features: [], truncated: false, count: 0 }),
  getStats: vi.fn().mockResolvedValue(stats),
  ...overrides,
});

const statusOf = (fn: () => unknown): number | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as { statusCode?: number }).statusCode;
  }
  return undefined;
};

describe('parseBbox', () => {
  it('parses four finite numbers into a tuple', () => {
    expect(parseBbox('-74,40,-73,41')).toEqual([-74, 40, -73, 41]);
  });

  it('throws a 400-shaped error on non-numeric input', () => {
    expect(statusOf(() => parseBbox('garbage'))).toBe(400);
  });

  it('throws a 400-shaped error on wrong arity', () => {
    expect(statusOf(() => parseBbox('-74,40,-73'))).toBe(400);
    expect(statusOf(() => parseBbox('-74,40,-73,41,42'))).toBe(400);
  });

  it('throws a 400-shaped error when min >= max', () => {
    expect(statusOf(() => parseBbox('-73,40,-74,41'))).toBe(400); // minLng >= maxLng
    expect(statusOf(() => parseBbox('-74,41,-73,40'))).toBe(400); // minLat >= maxLat
    expect(statusOf(() => parseBbox('-74,40,-74,41'))).toBe(400); // equal lng
  });

  it('rejects partially numeric tokens (Number semantics, not parseFloat)', () => {
    expect(statusOf(() => parseBbox('74abc,40,-73,41'))).toBe(400);
  });
});

describe('parseClasses', () => {
  it('keeps known classes', () => {
    expect(parseClasses('protected,greenway')).toEqual(['protected', 'greenway']);
  });

  it('drops unknown classes', () => {
    expect(parseClasses('protected,bogus,lane')).toEqual(['protected', 'lane']);
  });

  it('trims whitespace around each class', () => {
    expect(parseClasses('protected, greenway')).toEqual(['protected', 'greenway']);
  });

  it('returns undefined for empty string (means all)', () => {
    expect(parseClasses('')).toBeUndefined();
  });

  it('returns undefined for undefined input (means all)', () => {
    expect(parseClasses(undefined)).toBeUndefined();
  });

  it('returns undefined when every class is unknown (means all)', () => {
    expect(parseClasses('bogus,nope')).toBeUndefined();
  });
});

describe('createCorpusService().listRoutes', () => {
  it('wraps client rows into a valid FeatureCollection', async () => {
    const client = makeClient({
      getRoutesOverview: vi
        .fn()
        .mockResolvedValue([routeFeature(1), routeFeature(2)]),
    });
    const service = createCorpusService(client);

    const fc = await service.listRoutes();

    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(2);
    expect(client.getRoutesOverview).toHaveBeenCalledTimes(1);
  });

  it('forwards the region to the client so the read is partition-scoped', async () => {
    const client = makeClient({
      getRoutesOverview: vi.fn().mockResolvedValue([routeFeature(1)]),
    });
    const service = createCorpusService(client);

    await service.listRoutes('ny');

    expect(client.getRoutesOverview).toHaveBeenCalledWith('ny');
  });
});

describe('createCorpusService().getRoute', () => {
  it('returns the Feature when the route exists', async () => {
    const client = makeClient({
      getRouteById: vi.fn().mockResolvedValue(detailFeature(286)),
    });
    const service = createCorpusService(client);

    const feature = await service.getRoute(286);

    expect(feature.type).toBe('Feature');
    expect(feature.properties.id).toBe(286);
    expect(client.getRouteById).toHaveBeenCalledWith(286);
  });

  it('throws a 404-shaped error when the route is missing', async () => {
    const client = makeClient({
      getRouteById: vi.fn().mockResolvedValue(null),
    });
    const service = createCorpusService(client);

    let caught: unknown;
    try {
      await service.getRoute(999);
    } catch (e) {
      caught = e;
    }
    expect((caught as { statusCode?: number }).statusCode).toBe(404);
  });

  it('passes POIs through unchanged, preserving order and each element', async () => {
    // The client (SQL) is responsible for ORDER BY position_fraction; the
    // service is a passthrough. So the testable behavior at this seam is
    // order-PRESERVATION: pre-ordered input comes back in the same order with
    // every element field intact (name/bucket/lat/lng/image fields).
    const pois: PoiSummary[] = [
      poiSummary(10, 0.1, { bucket: 'coffee_food' }),
      poiSummary(20, 0.5, {
        bucket: 'landmark',
        image_url: 'https://commons/File:X.jpg',
        image_license: 'CC-BY-SA-4.0',
        image_attribution: 'Photographer Y',
      }),
      poiSummary(30, 0.9, { bucket: 'scenic' }),
    ];
    const feature = detailFeature(286);
    feature.properties.pois = pois;
    const client = makeClient({
      getRouteById: vi.fn().mockResolvedValue(feature),
    });
    const service = createCorpusService(client);

    const result = await service.getRoute(286);

    expect(result.properties.pois).toEqual(pois);
    // Order is preserved as given.
    expect(result.properties.pois?.map((p) => p.id)).toEqual([10, 20, 30]);
    // Each element carries the display fields.
    const landmark = result.properties.pois?.[1];
    expect(landmark).toMatchObject({
      bucket: 'landmark',
      lat: 40.5,
      lng: -73.9,
      image_url: 'https://commons/File:X.jpg',
      image_attribution: 'Photographer Y',
    });
  });

  it('surfaces pois: [] for a route with no nearby POIs', async () => {
    const feature = detailFeature(287);
    feature.properties.pois = [];
    const client = makeClient({
      getRouteById: vi.fn().mockResolvedValue(feature),
    });
    const service = createCorpusService(client);

    const result = await service.getRoute(287);

    expect(result.properties.pois).toEqual([]);
  });
});

describe('createCorpusService().listFacilities', () => {
  it('forwards the parsed bbox and classes to the client', async () => {
    const client = makeClient({
      getFacilitiesInBbox: vi.fn().mockResolvedValue({
        features: [facilityFeature(1)],
        truncated: false,
        count: 1,
      }),
    });
    const service = createCorpusService(client);

    await service.listFacilities('-74,40,-73,41', 'protected,bogus,greenway');

    expect(client.getFacilitiesInBbox).toHaveBeenCalledWith(
      [-74, 40, -73, 41],
      ['protected', 'greenway'],
    );
  });

  it('forwards undefined classes when none are given (means all)', async () => {
    const client = makeClient();
    const service = createCorpusService(client);

    await service.listFacilities('-74,40,-73,41', undefined);

    expect(client.getFacilitiesInBbox).toHaveBeenCalledWith(
      [-74, 40, -73, 41],
      undefined,
    );
  });

  it('passes through truncated/count meta in the response', async () => {
    const client = makeClient({
      getFacilitiesInBbox: vi.fn().mockResolvedValue({
        features: [facilityFeature(1), facilityFeature(2)],
        truncated: true,
        count: 2,
      }),
    });
    const service = createCorpusService(client);

    const res = await service.listFacilities('-74,40,-73,41', undefined);

    expect(res.type).toBe('FeatureCollection');
    expect(res.features).toHaveLength(2);
    expect(res.truncated).toBe(true);
    expect(res.count).toBe(2);
  });

  it('rejects an invalid bbox with a 400-shaped error', async () => {
    const client = makeClient();
    const service = createCorpusService(client);

    let caught: unknown;
    try {
      await service.listFacilities('garbage', undefined);
    } catch (e) {
      caught = e;
    }
    expect((caught as { statusCode?: number }).statusCode).toBe(400);
    expect(client.getFacilitiesInBbox).not.toHaveBeenCalled();
  });
});

describe('createCorpusService().stats', () => {
  it('returns the client stats passthrough', async () => {
    const client = makeClient();
    const service = createCorpusService(client);

    const result = await service.stats();

    expect(result).toEqual(stats);
    expect(client.getStats).toHaveBeenCalledTimes(1);
  });
});
