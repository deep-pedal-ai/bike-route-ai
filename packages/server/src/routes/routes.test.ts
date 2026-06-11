import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';

describe('GET /api/routes', () => {
  it('returns 200 with a routes array', async () => {
    const res = await request(app).get('/api/routes');
    expect(res.status).toBe(200);
    expect(res.body.routes).toBeInstanceOf(Array);
  });

  it('each route has required fields', async () => {
    const res = await request(app).get('/api/routes');
    const route = res.body.routes[0];
    expect(route).toHaveProperty('id');
    expect(route).toHaveProperty('name');
    expect(route).toHaveProperty('distance');
    expect(route).toHaveProperty('waypoints');
  });
});
