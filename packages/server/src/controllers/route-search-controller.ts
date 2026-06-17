import type { NextFunction, Request, Response } from 'express';
import type { RouteSearchRequest } from '@bike-route-ai/shared';
import { HttpError } from '../middleware/http-error.js';
import { MAX_SEARCH_QUERY_LENGTH, type RouteSearchService } from '../services/route-search-types.js';

export function createRouteSearchController(routeSearchService: RouteSearchService) {
  return {
    async search(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const validation = validateSearchRequest(req.body);
        if (validation.ok) {
          const response = await routeSearchService.search(
            validation.body.query,
            validation.body.region,
          );
          res.json(response);
        } else {
          next(new HttpError(400, validation.error));
        }
      } catch (err) {
        next(err);
      }
    },
  };
}

type SearchRequestValidation =
  | { ok: true; body: RouteSearchRequest }
  | { ok: false; error: string };

function validateSearchRequest(body: unknown): SearchRequestValidation {
  if (!isRecord(body) || typeof body.query !== 'string') {
    return { ok: false, error: 'Request body must include a query string' };
  }

  const query = body.query.trim();
  if (query.length === 0) {
    return { ok: false, error: 'Query must not be empty' };
  }
  if (query.length > MAX_SEARCH_QUERY_LENGTH) {
    return { ok: false, error: `Query must be ${MAX_SEARCH_QUERY_LENGTH} characters or fewer` };
  }

  // region is optional; only carry it through when it's a non-empty string.
  const region = typeof body.region === 'string' && body.region.length > 0 ? body.region : undefined;

  return { ok: true, body: { query, region } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
