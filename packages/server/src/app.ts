import express from 'express';
import { createRoutesRouter } from './routes/routes.js';
import { corpusRouter } from './routes/corpus.js';
import { errorHandler } from './middleware/error-handler.js';
import type { RouteSearchService } from './services/route-search-types.js';

type AppDependencies = {
  routeSearchService?: RouteSearchService;
};

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();

  app.use(express.json());
  app.use('/api/routes', createRoutesRouter(dependencies));
  app.use('/api/corpus', corpusRouter);

  // Central error middleware MUST be registered last, after all routes.
  app.use(errorHandler);

  return app;
}

export const app = createApp();
