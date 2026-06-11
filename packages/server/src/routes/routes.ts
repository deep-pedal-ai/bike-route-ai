import { Router } from 'express';
import type { RouteResponse } from '@bike-route-ai/shared';

export const routesRouter = Router();

routesRouter.get('/', (_req, res) => {
  const response: RouteResponse = {
    routes: [
      {
        id: '1',
        name: 'Sample Route',
        distance: 12.5,
        waypoints: [
          [37.7749, -122.4194],
          [37.8044, -122.2712],
        ],
      },
    ],
  };
  res.json(response);
});
