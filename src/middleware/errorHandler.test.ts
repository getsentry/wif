import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { httpErrorHandler } from './errorHandler.js';
import { HttpError } from '../types.js';

describe('httpErrorHandler', () => {
  it('sends 4xx response for HttpError', () => {
    const err = new HttpError(401, 'Missing Slack verification data');
    const req = {} as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn();

    httpErrorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing Slack verification data' });
    expect(next).not.toHaveBeenCalled();
  });

  it('passes non-HttpError to next', () => {
    const err = new Error('Unexpected error');
    const req = {} as Request;
    const res = {} as Response;
    const next = vi.fn();

    httpErrorHandler(err, req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });

  it('handles various HttpError status codes', () => {
    const statusCodes = [400, 403, 404];
    for (const code of statusCodes) {
      const err = new HttpError(code, `Error ${code}`);
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn();

      httpErrorHandler(err, {} as Request, res, next);

      expect(res.status).toHaveBeenCalledWith(code);
      expect(res.json).toHaveBeenCalledWith({ error: `Error ${code}` });
    }
  });
});
