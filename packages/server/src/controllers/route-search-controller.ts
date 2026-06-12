import type { NextFunction, Request, Response } from 'express';
import type { RouteSearchRequest } from '@bike-route-ai/shared';
import { HttpError } from '../middleware/http-error.js';
import { MAX_SEARCH_QUERY_LENGTH, type RouteSearchService } from '../services/route-search-types.js';

export function createRouteSearchController(routeSearchService: RouteSearchService) {
  return {
    async search(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const validation = validateSearchRequest(req.body);
        if (!validation.ok) {
          next(new HttpError(400, validation.error));
          return;
        }

        const response = await routeSearchService.search(validation.body.query);
        res.json(response);
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

  return { ok: true, body: { query } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
