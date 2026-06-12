import { describe, it, expect } from 'vitest';
import fixture from './corpus-sample.json';

// NY bounding box — the coordinate-order regression guard. ST_AsGeoJSON emits
// [lng, lat]; a hand-flip would swap the axes and drop routes into the ocean.
const NY = { minLng: -75.1, maxLng: -72.7, minLat: 40.2, maxLat: 44.2 };

describe('corpus-sample fixture', () => {
  it('routes parse as a valid FeatureCollection of LineStrings', () => {
    expect(fixture.routes.type).toBe('FeatureCollection');
    expect(fixture.routes.features.length).toBeGreaterThan(0);
    for (const f of fixture.routes.features) {
      expect(f.type).toBe('Feature');
      expect(f.geometry.type).toBe('LineString');
    }
  });

  it("first route's first coordinate is [lng, lat] inside the NY bbox", () => {
    const [lng, lat] = fixture.routes.features[0].geometry.coordinates[0];
    expect(lng).toBeGreaterThanOrEqual(NY.minLng);
    expect(lng).toBeLessThanOrEqual(NY.maxLng);
    expect(lat).toBeGreaterThanOrEqual(NY.minLat);
    expect(lat).toBeLessThanOrEqual(NY.maxLat);
  });

  it('includes multiple sources and at least one loop', () => {
    const sources = new Set(fixture.routes.features.map((f) => f.properties.source));
    expect(sources.size).toBeGreaterThanOrEqual(2);
    expect(fixture.routes.features.some((f) => f.properties.is_loop)).toBe(true);
  });

  it('has a detail feature with a populated surface_breakdown and a facility sample', () => {
    expect(fixture.routeDetail.geometry.type).toBe('LineString');
    expect(
      Object.keys(fixture.routeDetail.properties.surface_breakdown).length,
    ).toBeGreaterThan(0);
    expect(fixture.facilities.features.length).toBeGreaterThan(0);
  });
});
