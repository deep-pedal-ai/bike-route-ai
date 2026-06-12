import { describe, it, expect } from 'vitest';

import { facilityColor } from './facility-color';

const HEX = /^#[0-9a-fA-F]{6}$/;
const CLASSES = ['protected', 'lane', 'sharrow', 'greenway', 'other'];

describe('facilityColor', () => {
  it('returns distinct hex colors for the five known facility classes', () => {
    const colors = CLASSES.map(facilityColor);

    for (const c of colors) {
      expect(c).toMatch(HEX);
    }
    expect(new Set(colors).size).toBe(5);
  });

  it('maps an unknown class to a default color distinct from every known class', () => {
    const known = CLASSES.map(facilityColor);
    const fallback = facilityColor('mystery');

    expect(fallback).toMatch(HEX);
    expect(known).not.toContain(fallback);
  });
});
