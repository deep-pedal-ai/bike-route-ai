import type { ErrorRequestHandler } from 'express';

type HttpLikeError = Error & {
  statusCode?: number;
  status?: number;
};

export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, next) => {
  void next;
  const normalized = normalizeError(err);
  res.status(normalized.statusCode).json({
    error: normalized.message,
    statusCode: normalized.statusCode,
  });
};

function normalizeError(err: unknown): { message: string; statusCode: number } {
  if (err instanceof Error) {
    const httpError = err as HttpLikeError;
    const statusCode = normalizeStatusCode(httpError.statusCode ?? httpError.status);
    return {
      message: err.message || 'Internal server error',
      statusCode,
    };
  }

  return {
    message: 'Internal server error',
    statusCode: 500,
  };
}

function normalizeStatusCode(statusCode: number | undefined): number {
  if (statusCode && Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599) {
    return statusCode;
  }
  return 500;
}
