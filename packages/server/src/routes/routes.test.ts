import type { Server } from 'node:http';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

import { app } from '../app.js';

describe('GET /api/routes', () => {
  let server: Server;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
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
