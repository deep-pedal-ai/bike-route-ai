import { Router } from 'express';

import {
  listRoutes,
  getRoute,
  listFacilities,
  stats,
} from '../controllers/corpus-controller.js';

// Router maps URLs to controller functions only (no logic). Mounted at
// '/api/corpus', so paths here are relative to that. '/routes/:id' MUST be
// registered after the static '/facilities' and '/stats' siblings live under
// distinct prefixes; within the routes resource, the literal collection path
// '/routes' is registered before the '/routes/:id' param route so a bare
// GET /routes is not captured as id.
export const corpusRouter = Router();

corpusRouter.get('/routes', listRoutes);
corpusRouter.get('/facilities', listFacilities);
corpusRouter.get('/stats', stats);
corpusRouter.get('/routes/:id', getRoute);
