import { describe, it, expect } from 'vitest';

import { buildFilter } from './maplibre-filter';

import type { FilterState } from './maplibre-filter';
import type { CorpusRouteProps } from '@bike-route-ai/shared';

// --- Minimal MapLibre-expression evaluator -----------------------------------
// Scoped to ONLY the operators buildFilter emits, so it proves the filter's
// *effect* on feature props rather than its array structure (which is free to
// be refactored). It is deliberately NOT a general MapLibre interpreter.
type Expr = unknown;

function evaluate(expr: Expr, props: Record<string, unknown>): unknown {
  if (!Array.isArray(expr)) {
    return expr;
  }
  const [op, ...args] = expr as [string, ...Expr[]];
  switch (op) {
    case 'get':
      return props[args[0] as string];
    case 'all':
      return args.every((a) => evaluate(a, props) === true);
    case 'any':
      return args.some((a) => evaluate(a, props) === true);
    case '==':
      return evaluate(args[0], props) === evaluate(args[1], props);
    case '>=': {
      const l = evaluate(args[0], props);
      const r = evaluate(args[1], props);
      return typeof l === 'number' && typeof r === 'number' && l >= r;
    }
    case '<=': {
      const l = evaluate(args[0], props);
      const r = evaluate(args[1], props);
      return typeof l === 'number' && typeof r === 'number' && l <= r;
    }
    default:
      throw new Error(`evaluator does not implement operator "${op}"`);
  }
}

function keeps(state: FilterState, props: Partial<CorpusRouteProps>): boolean {
  return evaluate(buildFilter(state), props as Record<string, unknown>) === true;
}

const base: CorpusRouteProps = {
  id: 1,
  name: 'r',
  source: 'canon',
  distance_km: 10,
  is_loop: false,
  quality_score: 0.5,
  ascent_m: null,
  descent_m: null,
  network: null,
};

describe('buildFilter — sources', () => {
  it('keeps a feature whose source is selected and drops one that is not', () => {
    const state: FilterState = { sources: ['canon', 'nysdot'] };

    expect(keeps(state, { ...base, source: 'canon' })).toBe(true);
    expect(keeps(state, { ...base, source: 'generated' })).toBe(false);
  });

  it('treats an empty sources array as "match all" (no source constraint)', () => {
    const state: FilterState = { sources: [] };

    expect(keeps(state, { ...base, source: 'canon' })).toBe(true);
    expect(keeps(state, { ...base, source: 'nysdot' })).toBe(true);
  });
});

describe('buildFilter — distance bounds', () => {
  it('applies minKm and maxKm as inclusive bounds on distance_km', () => {
    const state: FilterState = { sources: [], minKm: 5, maxKm: 20 };

    expect(keeps(state, { ...base, distance_km: 4.9 })).toBe(false);
    expect(keeps(state, { ...base, distance_km: 5 })).toBe(true);
    expect(keeps(state, { ...base, distance_km: 12 })).toBe(true);
    expect(keeps(state, { ...base, distance_km: 20 })).toBe(true);
    expect(keeps(state, { ...base, distance_km: 20.1 })).toBe(false);
  });

  it('drops a feature with null distance_km when a distance bound is set', () => {
    expect(keeps({ sources: [], minKm: 5 }, { ...base, distance_km: null })).toBe(false);
    expect(keeps({ sources: [], maxKm: 20 }, { ...base, distance_km: null })).toBe(false);
  });

  it('does not constrain distance when no bound is set', () => {
    expect(keeps({ sources: [] }, { ...base, distance_km: null })).toBe(true);
    expect(keeps({ sources: [] }, { ...base, distance_km: 999 })).toBe(true);
  });
});

describe('buildFilter — loopOnly', () => {
  it('keeps only loops when loopOnly is true', () => {
    const state: FilterState = { sources: [], loopOnly: true };

    expect(keeps(state, { ...base, is_loop: true })).toBe(true);
    expect(keeps(state, { ...base, is_loop: false })).toBe(false);
  });

  it('keeps both loops and non-loops when loopOnly is false or undefined', () => {
    expect(keeps({ sources: [], loopOnly: false }, { ...base, is_loop: false })).toBe(true);
    expect(keeps({ sources: [], loopOnly: false }, { ...base, is_loop: true })).toBe(true);
    expect(keeps({ sources: [] }, { ...base, is_loop: false })).toBe(true);
  });
});

describe('buildFilter — minQuality', () => {
  it('keeps features at or above the quality threshold, drops those below', () => {
    const state: FilterState = { sources: [], minQuality: 0.6 };

    expect(keeps(state, { ...base, quality_score: 0.59 })).toBe(false);
    expect(keeps(state, { ...base, quality_score: 0.6 })).toBe(true);
    expect(keeps(state, { ...base, quality_score: 0.9 })).toBe(true);
  });

  it('drops a feature with null quality_score when minQuality is set', () => {
    expect(keeps({ sources: [], minQuality: 0.6 }, { ...base, quality_score: null })).toBe(false);
  });

  it('does not constrain quality when minQuality is unset', () => {
    expect(keeps({ sources: [] }, { ...base, quality_score: null })).toBe(true);
  });
});

describe('buildFilter — combined clauses', () => {
  it('requires every active clause to pass (AND semantics)', () => {
    const state: FilterState = {
      sources: ['canon'],
      minKm: 5,
      maxKm: 20,
      loopOnly: true,
      minQuality: 0.6,
    };

    expect(
      keeps(state, {
        ...base,
        source: 'canon',
        distance_km: 10,
        is_loop: true,
        quality_score: 0.8,
      }),
    ).toBe(true);

    // Fails on source only.
    expect(
      keeps(state, {
        ...base,
        source: 'generated',
        distance_km: 10,
        is_loop: true,
        quality_score: 0.8,
      }),
    ).toBe(false);
  });
});
