import { describe, it, expect } from 'vitest';

import {
  boundsForRouteId,
  routeOpacityExpression,
  FULL_OPACITY,
  DIM_OPACITY,
} from './route-search-view';

import type { Feature, FeatureCollection, LineString } from 'geojson';
import type { CorpusRouteProps } from '@bike-route-ai/shared';

// --- Minimal MapLibre-expression evaluator -----------------------------------
// Scoped to ONLY the operators routeOpacityExpression emits, so it proves the
// expression's *effect* on feature props rather than its array structure. The
// single invariant under test: ids normalize to string before comparison, so a
// hovered string id matches a feature whose `id` prop is a number (the corpus
// layer stores `properties.id` as a number; search results carry it as text).
type Expr = unknown;

function evaluate(expr: Expr, props: Record<string, unknown>): unknown {
  if (!Array.isArray(expr)) {
    return expr;
  }
  const [op, ...args] = expr as [string, ...Expr[]];
  switch (op) {
    case 'get':
      return props[args[0] as string];
    case 'to-string':
      return String(evaluate(args[0], props));
    case '==':
      return evaluate(args[0], props) === evaluate(args[1], props);
    case 'case': {
      // ['case', cond1, out1, cond2, out2, …, fallback]
      for (let i = 0; i + 1 < args.length; i += 2) {
        if (evaluate(args[i], props) === true) {
          return evaluate(args[i + 1], props);
        }
      }
      return evaluate(args[args.length - 1], props);
    }
    default:
      throw new Error(`evaluator does not implement operator "${op}"`);
  }
}

function feature(
  id: number,
  coordinates: [number, number][],
): Feature<LineString, CorpusRouteProps> {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates },
    properties: {
      id,
      name: `route-${id}`,
      source: 'canon',
      distance_km: 10,
      is_loop: false,
      quality_score: 0.5,
      ascent_m: null,
      descent_m: null,
      network: null,
    },
  };
}

const fc: FeatureCollection<LineString, CorpusRouteProps> = {
  type: 'FeatureCollection',
  features: [
    feature(4, [
      [-74.0, 40.5],
      [-73.9, 40.6],
    ]),
    feature(286, [
      [-73.5, 40.8],
      [-73.2, 40.88],
    ]),
  ],
};

describe('boundsForRouteId', () => {
  it('returns the bounds of the matching feature for a numeric id', () => {
    expect(boundsForRouteId(fc, 286)).toEqual([
      [-73.5, 40.8],
      [-73.2, 40.88],
    ]);
  });

  it('matches the same feature when the id is a string (normalization)', () => {
    expect(boundsForRouteId(fc, '286')).toEqual([
      [-73.5, 40.8],
      [-73.2, 40.88],
    ]);
    // The numeric-prop feature `4` is found by the string id '4'.
    expect(boundsForRouteId(fc, '4')).toEqual([
      [-74.0, 40.5],
      [-73.9, 40.6],
    ]);
  });

  it('returns null for an id with no matching feature (no geometry)', () => {
    expect(boundsForRouteId(fc, 999)).toBeNull();
    expect(boundsForRouteId(fc, 'nope')).toBeNull();
  });
});

describe('routeOpacityExpression', () => {
  it('returns a uniform full opacity when nothing is hovered', () => {
    const expr = routeOpacityExpression(null);
    expect(evaluate(expr, { id: 4 })).toBe(FULL_OPACITY);
    expect(evaluate(expr, { id: 286 })).toBe(FULL_OPACITY);
  });

  it('brightens the hovered route and dims the others (string vs number ids)', () => {
    const expr = routeOpacityExpression('4');
    // Hovered id '4' matches the feature whose numeric prop id is 4.
    expect(evaluate(expr, { id: 4 })).toBe(FULL_OPACITY);
    expect(evaluate(expr, { id: '4' })).toBe(FULL_OPACITY);
    // Every other route is dimmed.
    expect(evaluate(expr, { id: 286 })).toBe(DIM_OPACITY);
  });

  it('accepts custom full/dim opacities (used by the casing layer)', () => {
    expect(routeOpacityExpression(null, 0.72, 0.08)).toBe(0.72);

    const expr = routeOpacityExpression('4', 0.72, 0.08);
    expect(evaluate(expr, { id: 4 })).toBe(0.72);
    expect(evaluate(expr, { id: 286 })).toBe(0.08);
  });
});
