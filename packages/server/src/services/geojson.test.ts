import { describe, it, expect } from 'vitest';
import type { Feature, LineString, MultiLineString } from 'geojson';
import type { FacilityProps } from '@bike-route-ai/shared';

import { toFeatureCollection, toFacilitiesResponse } from './geojson.js';

type Props = { id: number };

const feature = (id: number): Feature<LineString, Props> => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [[-74, 40], [-73, 41]] },
  properties: { id },
});

describe('toFeatureCollection', () => {
  it('wraps features in a FeatureCollection', () => {
    const fc = toFeatureCollection([feature(1), feature(2)]);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0].properties.id).toBe(1);
  });

  it('produces an empty collection for no features', () => {
    const fc = toFeatureCollection<LineString, Props>([]);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toEqual([]);
  });
});

const facility = (id: number): Feature<MultiLineString, FacilityProps> => ({
  type: 'Feature',
  geometry: { type: 'MultiLineString', coordinates: [[[-74, 40], [-73, 41]]] },
  properties: { id, facility_class: 'protected', borough: null },
});

describe('toFacilitiesResponse', () => {
  it('wraps features with truncated/count meta', () => {
    const res = toFacilitiesResponse([facility(1)], true, 1);
    expect(res.type).toBe('FeatureCollection');
    expect(res.features).toHaveLength(1);
    expect(res.truncated).toBe(true);
    expect(res.count).toBe(1);
  });
});
