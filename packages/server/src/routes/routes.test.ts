import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import type { RouteSearchService } from '../services/route-search-types.js';

describe('GET /api/routes', () => {
  it('returns 200 with a routes array', async () => {
    const res = await request(createApp()).get('/api/routes');
    expect(res.status).toBe(200);
    expect(res.body.routes).toBeInstanceOf(Array);
  });

  it('each route has required fields', async () => {
    const res = await request(createApp()).get('/api/routes');
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

    const res = await request(app)
      .post('/api/routes/search')
      .send({ query: 'quiet loop' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      filtersRelaxed: false,
      results: [{ id: 'greenway', name: 'Result for quiet loop' }],
    });
  });

  it('returns 400 for a blank query', async () => {
    const res = await request(createApp({ routeSearchService: createFakeSearchService() }))
      .post('/api/routes/search')
      .send({ query: '   ' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Query must not be empty', statusCode: 400 });
  });

  it('returns the standard error shape when search fails', async () => {
    const app = createApp({
      routeSearchService: createFakeSearchService(async () => {
        throw new Error('search failed');
      }),
    });

    const res = await request(app)
      .post('/api/routes/search')
      .send({ query: 'quiet loop' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'search failed', statusCode: 500 });
  });
});

function createFakeSearchService(
  search: RouteSearchService['search'] = async () => ({ results: [], filtersRelaxed: false }),
): RouteSearchService {
  return { search };
}
