import type { Request, Response } from "express";
import { HttpError } from "../types.js";

/**
 * Error handler middleware: 4xx = user error (no Sentry), 5xx = server error (report to Sentry).
 * Must be registered before Sentry's setupExpressErrorHandler.
 */
export function httpErrorHandler(
  err: Error,
  _req: Request,
  res: Response,
  next: (err: Error) => void,
): void {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  next(err);
}
