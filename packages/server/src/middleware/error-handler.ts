import type { Request, Response, NextFunction } from 'express';
import { HttpError } from './http-error.js';

// Re-export so existing importers (corpus-controller, error-handler.test) keep
// resolving HttpError from here. http-error.ts is the single source of truth,
// shared with the route-search controller, so `instanceof HttpError` holds for
// errors thrown by either feature.
export { HttpError };

// Central Express error middleware (4-arg signature). HttpErrors expose their
// statusCode + message; anything else is treated as an unexpected 500 with a
// generic message so internal (e.g. DB) error text never leaks to the client.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ error: err.message, statusCode: err.statusCode });
    return;
  }
  console.error('Unexpected error:', err);
  res.status(500).json({ error: 'Internal Server Error', statusCode: 500 });
}
