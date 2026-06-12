import { Router } from 'express';
import type { RouteResponse } from '@bike-route-ai/shared';
import { createRouteSearchController } from '../controllers/route-search-controller.js';
import { createDefaultRouteSearchService } from '../services/default-route-search-service.js';
import type { RouteSearchService } from '../services/route-search-types.js';

type RoutesRouterDependencies = {
  routeSearchService?: RouteSearchService;
};

export function createRoutesRouter(dependencies: RoutesRouterDependencies = {}) {
  const router = Router();
  const routeSearchController = createRouteSearchController(
    dependencies.routeSearchService ?? createDefaultRouteSearchService(),
  );

  router.get('/', (_req, res) => {
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

  router.post('/search', routeSearchController.search);

  return router;
}

export const routesRouter = createRoutesRouter();
