import { describe, it, expect } from 'vitest';

import { fitBoundsFromFeatures } from './bounds';
import corpusSample from '../fixtures/corpus-sample.json';

import type { FeatureCollection, LineString } from 'geojson';
import type { CorpusRouteProps } from '@bike-route-ai/shared';

const routes = corpusSample.routes as unknown as FeatureCollection<
  LineString,
  CorpusRouteProps
>;

describe('fitBoundsFromFeatures', () => {
  it('computes [[west,south],[east,north]] from all route coordinates', () => {
    const [[west, south], [east, north]] = fitBoundsFromFeatures(routes);

    // Hardcoded extremes of the fixture's 6 routes (independently computed),
    // NOT recomputed in the test — so the assertion can fail if the function
    // mis-aggregates or flips lng/lat.
    expect(west).toBeCloseTo(-73.979443, 6);
    expect(south).toBeCloseTo(40.580519, 6);
    expect(east).toBeCloseTo(-73.2130933, 6);
    expect(north).toBeCloseTo(40.8872418, 6);
  });

  it('returns a plausible NY extent (lng/lat order not flipped)', () => {
    const [[west, south], [east, north]] = fitBoundsFromFeatures(routes);

    expect(west).toBeGreaterThanOrEqual(-75.1);
    expect(east).toBeLessThanOrEqual(-72.7);
    expect(south).toBeGreaterThanOrEqual(40.2);
    expect(north).toBeLessThanOrEqual(44.2);
    expect(west).toBeLessThan(east);
    expect(south).toBeLessThan(north);
  });
});
