import { describe, it, expect } from 'vitest';
import type { CorpusRouteDetailProps } from '@bike-route-ai/shared';
import { CORPUS_FIELD_DOCS } from './corpus-field-docs';

// The full set of detail keys the panel must be able to explain. Listing them
// gives a runtime exhaustiveness check that complements the compile-time
// Record<keyof CorpusRouteDetailProps, string> guard in corpus-field-docs.ts.
const DETAIL_KEYS: (keyof CorpusRouteDetailProps)[] = [
  'id',
  'name',
  'source',
  'region',
  'distance_km',
  'is_loop',
  'quality_score',
  'ascent_m',
  'descent_m',
  'network',
  'source_id',
  'match_quality',
  'surface_breakdown',
  'waytype_breakdown',
  'steepness_breakdown',
  'protected_lane_fraction',
  'greenway_fraction',
  'facility_coverage_fraction',
  'attribution',
  'osm_way_id_count',
  'tags',
];

describe('CORPUS_FIELD_DOCS', () => {
  it('has a non-empty description for every CorpusRouteDetailProps key', () => {
    for (const key of DETAIL_KEYS) {
      const doc = CORPUS_FIELD_DOCS[key];
      expect(doc, `missing doc for ${key}`).toBeTruthy();
      expect(doc.trim().length).toBeGreaterThan(0);
    }
  });

  it('covers exactly the detail keys — no stray or missing entries', () => {
    expect(Object.keys(CORPUS_FIELD_DOCS).sort()).toEqual([...DETAIL_KEYS].sort());
  });

  it('carries the match_quality help text from the migration comment', () => {
    expect(CORPUS_FIELD_DOCS.match_quality).toContain('native sources');
  });
});
