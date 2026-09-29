import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../lib/auth.js';
import { config } from '../config/env.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      username?: string;
      role?: 'user' | 'guest';
    }
  }
}

function extractToken(req: Request): string | null {
  const cookie = req.cookies?.[config.jwt.cookieName];
  if (cookie) return cookie;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/** Requires a valid access token (registered user or guest). */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.userId = payload.sub;
  req.username = payload.username;
  req.role = payload.role;
  next();
}

/** Attaches user when a token exists; never rejects (guest-friendly endpoints). */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (payload) {
    req.userId = payload.sub;
    req.username = payload.username;
    req.role = payload.role;
  }
  next();
}

/** Blocks guests from privileged actions (e.g., starting private chats). */
export function requireRegistered(req: Request, res: Response, next: NextFunction) {
  if (!req.userId) return res.status(401).json({ error: 'Authentication required' });
  if (req.role === 'guest') {
    return res.status(403).json({ error: 'Create an account to start private chats.' });
  }
  next();
}
