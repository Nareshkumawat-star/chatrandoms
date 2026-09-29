import type { NextFunction, Request, Response } from 'express';
import { Error as MongooseError } from 'mongoose';
import { logger } from '../lib/logger.js';

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  if (err instanceof MongooseError.ValidationError) {
    return res.status(400).json({ error: 'Validation failed', details: err.message });
  }
  if (err instanceof MongooseError.CastError) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  if (typeof err === 'object' && err && (err as { code?: number }).code === 11000) {
    return res.status(409).json({ error: 'Duplicate key' });
  }
  logger.error('Unhandled error:', err);
  return res.status(500).json({ error: 'Internal server error' });
}
