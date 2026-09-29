import jwt, { type SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from '../config/env.js';

export type AccessPayload = {
  sub: string; // user id
  username: string;
  role: 'user' | 'guest';
};

export function signAccessToken(payload: AccessPayload): string {
  return jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessTtl,
  } as SignOptions);
}

export function signRefreshToken(payload: AccessPayload): string {
  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshTtl,
  } as SignOptions);
}

export function verifyAccessToken(token: string): AccessPayload | null {
  try {
    return jwt.verify(token, config.jwt.accessSecret) as AccessPayload;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): AccessPayload | null {
  try {
    return jwt.verify(token, config.jwt.refreshSecret) as AccessPayload;
  } catch {
    return null;
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
