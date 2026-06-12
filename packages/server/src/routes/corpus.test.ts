import type { Server } from 'node:http';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type {
  CorpusRoutesResponse,
  CorpusRouteDetailResponse,
  FacilitiesResponse,
  CorpusStats,
} from '@bike-route-ai/shared';

// db.ts builds its lazy pool from DATABASE_URL. Point it at the Neon test branch
// BEFORE importing app (so the first query connects to the right branch). When
// TEST_DATABASE_URL is absent we skip the whole integration suite with a clear
// message rather than failing on a missing connection string.
const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

if (hasTestDb) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// 30s: Neon serverless can cold-start on the first query of a run.
const TIMEOUT = 30000;

const describeIntegration = hasTestDb ? describe : describe.skip;

if (!hasTestDb) {
  console.warn(
    '[corpus.test] TEST_DATABASE_URL not set — skipping corpus integration tests. ' +
      'Run with cwd=packages/server so dotenv loads .env.',
  );
}

// Import app + db AFTER the DATABASE_URL assignment above. Top-level await
// (ESM) keeps the env mutation ordered strictly before app.js is evaluated, so
// the lazy pool reads the test-branch connection string. Only loaded when a
// test DB is configured; otherwise the suite is skipped and these are unused.
let app: Express;
let server: Server;
let closePool: () => Promise<void> = async () => {};

if (hasTestDb) {
  const [appMod, dbMod] = await Promise.all([
    import('../app.js'),
    import('../db.js'),
  ]);
  app = appMod.app;
  closePool = dbMod.closePool;
}

describeIntegration('GET /api/corpus', () => {
  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
  });

  // closePool releases the pool so the test process exits cleanly.
  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await closePool();
  });

  it(
    'GET /routes -> 200 FeatureCollection of routes within the NY bbox',
    async () => {
      const res = await request(server).get('/api/corpus/routes');
      expect(res.status).toBe(200);
      const body = res.body as CorpusRoutesResponse;
      expect(body.type).toBe('FeatureCollection');
      expect(Array.isArray(body.features)).toBe(true);
      expect(body.features.length).toBeGreaterThan(0);

      const firstCoord = body.features[0].geometry.coordinates[0];
      const [lng, lat] = firstCoord;
      expect(lng).toBeGreaterThanOrEqual(-75.1);
      expect(lng).toBeLessThanOrEqual(-72.7);
      expect(lat).toBeGreaterThanOrEqual(40.2);
      expect(lat).toBeLessThanOrEqual(44.2);
    },
    TIMEOUT,
  );

  it(
    'GET /routes/:id -> 200 detail Feature for a known id; -1 -> 404 {error,statusCode}',
    async () => {
      const listRes = await request(server).get('/api/corpus/routes');
      const list = listRes.body as CorpusRoutesResponse;
      const knownId = list.features[0].properties.id;

      const res = await request(server).get(`/api/corpus/routes/${knownId}`);
      expect(res.status).toBe(200);
      const detail = res.body as CorpusRouteDetailResponse;
      expect(detail.type).toBe('Feature');
      expect(detail.properties.id).toBe(knownId);
      // detail-only prop present (distinguishes detail props from overview props)
      expect(detail.properties).toHaveProperty('source_id');

      const missing = await request(server).get('/api/corpus/routes/-1');
      expect(missing.status).toBe(404);
      const errBody = missing.body as { error: string; statusCode: number };
      expect(typeof errBody.error).toBe('string');
      expect(errBody.statusCode).toBe(404);
    },
    TIMEOUT,
  );

  it(
    'GET /facilities requires bbox (400) and returns a FeatureCollection with meta when given one',
    async () => {
      const noBbox = await request(server).get('/api/corpus/facilities');
      expect(noBbox.status).toBe(400);
      const noBboxBody = noBbox.body as { error: string; statusCode: number };
      expect(typeof noBboxBody.error).toBe('string');
      expect(noBboxBody.statusCode).toBe(400);

      const res = await request(server)
        .get('/api/corpus/facilities')
        .query({ bbox: '-74.1,40.5,-73.7,40.95' });
      expect(res.status).toBe(200);
      const body = res.body as FacilitiesResponse;
      expect(body.type).toBe('FeatureCollection');
      expect(Array.isArray(body.features)).toBe(true);
      expect(body).toHaveProperty('truncated');
      expect(body).toHaveProperty('count');
      expect(typeof body.truncated).toBe('boolean');
      expect(typeof body.count).toBe('number');
    },
    TIMEOUT,
  );

  it(
    'GET /stats -> 200 with numeric (not string) source counts',
    async () => {
      const res = await request(server).get('/api/corpus/stats');
      expect(res.status).toBe(200);
      const body = res.body as CorpusStats;
      expect(typeof body.routes_by_source).toBe('object');
      expect(body.routes_by_source).not.toBeNull();
      // numeric-string trap guard: SQL builds counts as JSON numbers, so the
      // canon source count must be a number, not a pg bigint string.
      expect(typeof body.routes_by_source.canon).toBe('number');
      expect(Array.isArray(body.bbox)).toBe(true);
      expect(body.bbox.length).toBe(4);
    },
    TIMEOUT,
  );
});
