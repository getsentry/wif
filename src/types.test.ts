import { describe, it, expect } from 'vitest';
import { HttpError } from './types.js';

describe('HttpError', () => {
  it('creates error with statusCode and message', () => {
    const err = new HttpError(404, 'Not found');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Not found');
    expect(err.name).toBe('HttpError');
  });

  it('extends Error and is instanceof Error', () => {
    const err = new HttpError(400, 'Bad request');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(HttpError);
  });

  it('supports various status codes', () => {
    expect(new HttpError(401, 'Unauthorized').statusCode).toBe(401);
    expect(new HttpError(403, 'Forbidden').statusCode).toBe(403);
    expect(new HttpError(500, 'Server error').statusCode).toBe(500);
  });
});
