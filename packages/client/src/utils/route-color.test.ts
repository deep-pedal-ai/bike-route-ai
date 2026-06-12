import { describe, it, expect } from 'vitest';

import { colorBySource, colorByQuality } from './route-color';

const HEX = /^#[0-9a-fA-F]{6}$/;

describe('colorBySource', () => {
  it('returns distinct hex colors for the four known sources', () => {
    const sources = ['osm_relation', 'canon', 'generated', 'nysdot'];
    const colors = sources.map(colorBySource);

    for (const c of colors) {
      expect(c).toMatch(HEX);
    }
    expect(new Set(colors).size).toBe(4);
  });

  it('maps an unknown source to a default color distinct from every known source', () => {
    const known = ['osm_relation', 'canon', 'generated', 'nysdot'].map(colorBySource);
    const fallback = colorBySource('something_new');

    expect(fallback).toMatch(HEX);
    expect(known).not.toContain(fallback);
  });

  it('is stable — the same source always yields the same color', () => {
    expect(colorBySource('canon')).toBe(colorBySource('canon'));
  });
});

describe('colorByQuality', () => {
  it('returns a hex color where the high end differs from the low end', () => {
    expect(colorByQuality(1)).toMatch(HEX);
    expect(colorByQuality(0)).toMatch(HEX);
    expect(colorByQuality(1)).not.toBe(colorByQuality(0));
  });

  it('maps a null score to a neutral hex color', () => {
    const neutral = colorByQuality(null);

    expect(neutral).toMatch(HEX);
    expect(neutral).not.toBe(colorByQuality(1));
    expect(neutral).not.toBe(colorByQuality(0));
  });
});
