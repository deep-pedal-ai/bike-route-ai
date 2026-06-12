import { describe, it, expect, vi } from 'vitest';
import { HttpError, errorHandler } from './error-handler.js';
import type { Request, Response, NextFunction } from 'express';

const makeRes = (): Response => {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
};

const fakeReq = {} as unknown as Request;
const fakeNext = vi.fn() as unknown as NextFunction;

describe('errorHandler', () => {
  it('maps an HttpError to its statusCode and message', () => {
    const res = makeRes();

    errorHandler(new HttpError(400, 'bad bbox'), fakeReq, res, fakeNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'bad bbox', statusCode: 400 });
  });

  it('maps an unexpected error to a generic 500 without leaking its message', () => {
    const res = makeRes();

    errorHandler(new Error('boom'), fakeReq, res, fakeNext);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Internal Server Error',
      statusCode: 500,
    });
  });
});
