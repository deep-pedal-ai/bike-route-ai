import type { Request, Response, NextFunction } from 'express';

import {
  getRoutesOverview,
  getRouteById,
  getFacilitiesInBbox,
  getStats,
} from '../clients/corpus-client.js';
import {
  createCorpusService,
  ServiceError,
  type CorpusClient,
} from '../services/corpus-service.js';
import { HttpError } from '../middleware/error-handler.js';

// Composition root (tiny): assemble S1's four standalone client functions into
// the CorpusClient seam and build the service ONCE at module scope. Handlers
// close over `service` and stay thin (extract params, call service, res.json).
const client: CorpusClient = {
  getRoutesOverview,
  getRouteById,
  getFacilitiesInBbox,
  getStats,
};

const service = createCorpusService(client);

// The service throws ServiceError (a sibling of HttpError, NOT a subclass), so
// the central errorHandler — which only maps HttpError — would otherwise 500 a
// 400/404. Bridge here: translate ServiceError -> HttpError (preserving its
// statusCode + message), pass HttpError through untouched, let anything else
// fall to the handler's generic 500.
function forward(err: unknown, next: NextFunction): void {
  if (err instanceof ServiceError) {
    console.warn(`[corpus] ${err.statusCode}: ${err.message}`);
    next(new HttpError(err.statusCode, err.message));
    return;
  }
  next(err);
}

export async function listRoutes(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.listRoutes();
    res.json(result);
  } catch (err) {
    forward(err, next);
  }
}

export async function getRoute(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = Number(req.params.id);
    const result = await service.getRoute(id);
    res.json(result);
  } catch (err) {
    forward(err, next);
  }
}

export async function listFacilities(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const bbox = req.query.bbox as string | undefined;
    // bbox is REQUIRED. Guard before the service: a missing param would make
    // parseBbox call .split on undefined (a TypeError -> 500), not a 400.
    if (bbox === undefined) {
      throw new HttpError(400, 'bbox query parameter is required');
    }
    const classes = req.query.classes as string | undefined;
    const result = await service.listFacilities(bbox, classes);
    res.json(result);
  } catch (err) {
    forward(err, next);
  }
}

export async function stats(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.stats();
    res.json(result);
  } catch (err) {
    forward(err, next);
  }
}
