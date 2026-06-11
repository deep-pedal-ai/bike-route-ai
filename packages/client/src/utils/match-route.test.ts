import { describe, it, expect } from 'vitest';
import { matchRoute } from './match-route';
import { GRAVEL_ROUTE, ROAD_ROUTE, CASUAL_ROUTE } from '../data/mock-routes';

describe('matchRoute', () => {
  it('returns gravel route for "gravel" keyword', () => {
    expect(matchRoute('find me a gravel loop')).toBe(GRAVEL_ROUTE);
  });

  it('returns gravel route for "coffee" keyword', () => {
    expect(matchRoute('ride with a coffee stop')).toBe(GRAVEL_ROUTE);
  });

  it('returns gravel route for "fire road" keyword', () => {
    expect(matchRoute('fire road adventure')).toBe(GRAVEL_ROUTE);
  });

  it('returns road route for "coastal" keyword', () => {
    expect(matchRoute('coastal ride with big views')).toBe(ROAD_ROUTE);
  });

  it('returns road route for "endurance" keyword', () => {
    expect(matchRoute('endurance road ride')).toBe(ROAD_ROUTE);
  });

  it('returns road route for "coast" keyword', () => {
    expect(matchRoute('along the coast')).toBe(ROAD_ROUTE);
  });

  it('returns casual route for "easy" keyword', () => {
    expect(matchRoute('easy spin today')).toBe(CASUAL_ROUTE);
  });

  it('returns casual route for "flat" keyword', () => {
    expect(matchRoute('something flat and chill')).toBe(CASUAL_ROUTE);
  });

  it('returns casual route for "recovery" keyword', () => {
    expect(matchRoute('recovery ride')).toBe(CASUAL_ROUTE);
  });

  it('returns casual route for "path" keyword', () => {
    expect(matchRoute('path ride through the park')).toBe(CASUAL_ROUTE);
  });

  it('returns casual route for "greenway" keyword', () => {
    expect(matchRoute('greenway trail')).toBe(CASUAL_ROUTE);
  });

  it('returns fallback route for unrecognised query', () => {
    const result = matchRoute('something completely different');
    expect(result.id).toBe('custom');
  });

  it('fallback route includes query preview in tagline', () => {
    const result = matchRoute('my unique custom query');
    expect(result.tagline).toContain('my unique custom query');
  });

  it('fallback truncates long queries to 55 chars', () => {
    const longQuery = 'a'.repeat(80);
    const result = matchRoute(longQuery);
    expect(result.tagline).toContain('…');
  });

  it('is case-insensitive', () => {
    expect(matchRoute('GRAVEL AND COFFEE')).toBe(GRAVEL_ROUTE);
    expect(matchRoute('COASTAL ROAD')).toBe(ROAD_ROUTE);
    expect(matchRoute('EASY FLAT PATH')).toBe(CASUAL_ROUTE);
  });
});
