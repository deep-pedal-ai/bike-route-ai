import type { Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../app.js';
import type { RouteSearchService } from '../services/route-search-types.js';

// supertest's `request(app)` spins up a fresh ephemeral server per call, which
// intermittently returns a bare 404 under rapid sequential requests. Drive a
// persistent server bound to a real port instead, and crucially AWAIT the
// `listening` event before issuing requests (see docs/map-tab-handoff.md).
function listen(app: ReturnType<typeof createApp>): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function withServer<T>(
  app: ReturnType<typeof createApp>,
  fn: (server: Server) => Promise<T>,
): Promise<T> {
  const server = await listen(app);
  try {
    return await fn(server);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('GET /api/routes', () => {
  let server: Server;

  beforeAll(async () => {
    server = await listen(createApp());
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns 200 with a routes array', async () => {
    const res = await request(server).get('/api/routes');
    expect(res.status).toBe(200);
    expect(res.body.routes).toBeInstanceOf(Array);
  });

  it('each route has required fields', async () => {
    const res = await request(server).get('/api/routes');
    const route = res.body.routes[0];
    expect(route).toHaveProperty('id');
    expect(route).toHaveProperty('name');
    expect(route).toHaveProperty('distance');
    expect(route).toHaveProperty('waypoints');
  });
});

describe('POST /api/routes/search', () => {
  it('returns route search results', async () => {
    const app = createApp({
      routeSearchService: createFakeSearchService(async (query) => ({
        filtersRelaxed: false,
        results: [
          {
            id: 'greenway',
            name: `Result for ${query}`,
            distanceKm: 18,
            ascentM: null,
            isLoop: true,
            qualityScore: 0.9,
            surfaceBreakdown: { paved: 1 },
            blurb: 'A quiet paved loop.',
          },
        ],
      })),
    });

    const res = await withServer(app, (server) =>
      request(server).post('/api/routes/search').send({ query: 'quiet loop' }),
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      filtersRelaxed: false,
      results: [{ id: 'greenway', name: 'Result for quiet loop' }],
    });
  });

  it('returns 400 for a blank query', async () => {
    const app = createApp({ routeSearchService: createFakeSearchService() });

    const res = await withServer(app, (server) =>
      request(server).post('/api/routes/search').send({ query: '   ' }),
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Query must not be empty', statusCode: 400 });
  });

  it('returns a generic 500 without leaking the message when search fails', async () => {
    const app = createApp({
      routeSearchService: createFakeSearchService(async () => {
        throw new Error('search failed');
      }),
    });

    const res = await withServer(app, (server) =>
      request(server).post('/api/routes/search').send({ query: 'quiet loop' }),
    );

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal Server Error', statusCode: 500 });
  });
});

function createFakeSearchService(
  search: RouteSearchService['search'] = async () => ({ results: [], filtersRelaxed: false }),
): RouteSearchService {
  return { search };
}
