import { describe, it, expect } from 'vitest';
import { GRAVEL_ROUTE, ROAD_ROUTE, CASUAL_ROUTE, buildFallbackRoute } from './mock-routes';

describe('mock routes', () => {
  it('gravel route has correct shape', () => {
    expect(GRAVEL_ROUTE.distanceMiles).toBe(22);
    expect(GRAVEL_ROUTE.elevationFt).toBe(1200);
    expect(GRAVEL_ROUTE.difficulty).toBe('Moderate');
    expect(GRAVEL_ROUTE.surfaces.length).toBeGreaterThan(0);
    expect(GRAVEL_ROUTE.turns.length).toBeGreaterThan(0);
    expect(GRAVEL_ROUTE.gearTips.length).toBeGreaterThan(0);
  });

  it('road route has correct shape', () => {
    expect(ROAD_ROUTE.distanceMiles).toBe(45);
    expect(ROAD_ROUTE.elevationFt).toBe(2800);
    expect(ROAD_ROUTE.difficulty).toBe('Hard');
    expect(ROAD_ROUTE.surfaces[0].percentage).toBe(100);
  });

  it('casual route has correct shape', () => {
    expect(CASUAL_ROUTE.distanceMiles).toBe(12);
    expect(CASUAL_ROUTE.elevationFt).toBe(150);
    expect(CASUAL_ROUTE.difficulty).toBe('Easy');
  });

  it('all routes have surface percentages summing to 100', () => {
    for (const route of [GRAVEL_ROUTE, ROAD_ROUTE, CASUAL_ROUTE]) {
      const total = route.surfaces.reduce((sum, s) => sum + s.percentage, 0);
      expect(total).toBe(100);
    }
  });
});

describe('buildFallbackRoute', () => {
  it('returns a route with id "custom"', () => {
    expect(buildFallbackRoute('test query').id).toBe('custom');
  });

  it('includes the query in the tagline', () => {
    const route = buildFallbackRoute('my test query');
    expect(route.tagline).toContain('my test query');
  });

  it('truncates queries longer than 55 chars with ellipsis', () => {
    const longQuery = 'x'.repeat(60);
    const route = buildFallbackRoute(longQuery);
    expect(route.tagline).toContain('…');
    expect(route.tagline).not.toContain('x'.repeat(60));
  });

  it('does not truncate queries of 55 chars or fewer', () => {
    const shortQuery = 'x'.repeat(55);
    const route = buildFallbackRoute(shortQuery);
    expect(route.tagline).not.toContain('…');
  });

  it('has all required route fields', () => {
    const route = buildFallbackRoute('query');
    expect(route.turns.length).toBeGreaterThan(0);
    expect(route.gearTips.length).toBeGreaterThan(0);
    expect(route.surfaces.length).toBeGreaterThan(0);
    expect(route.highlights.length).toBeGreaterThan(0);
  });
});
