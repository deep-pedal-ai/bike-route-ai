import type { Request, Response, NextFunction } from 'express';

// A typed error carrying an HTTP status code. Controllers/services throw this
// for client-facing failures (e.g. 400 bad bbox, 404 not found); the central
// errorHandler turns it into the standard { error, statusCode } response shape.
export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

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
  res.status(500).json({ error: 'Internal Server Error', statusCode: 500 });
}
