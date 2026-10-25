import { Router } from 'express';
import { z } from 'zod';
import { User } from '../models/User.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken, comparePassword, hashPassword } from '../lib/auth.js';
import { config } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { validate, asyncHandler } from '../middleware/validate.js';
import { ApiError } from '../middleware/errors.js';
import { hit } from '../lib/rateLimiter.js';
import type { Request, Response } from 'express';

const router = Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax' as const,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

function sendAuth(res: Response, userId: string, username: string, role: 'user' | 'guest') {
  const accessToken = signAccessToken({ sub: userId, username, role });
  const refreshToken = signRefreshToken({ sub: userId, username, role });
  res.cookie(config.jwt.cookieName, accessToken, cookieOptions());
  res.cookie('refreshToken', refreshToken, {
    ...cookieOptions(),
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  return { accessToken, refreshToken, user: { id: userId, username, role } };
}

function publicMe(doc: {
  _id: unknown;
  username: string;
  displayName: string;
  avatar: string;
  bio: string;
  isGuest: boolean;
  reputation: number;
  anonymousMode: boolean;
}) {
  return {
    id: String(doc._id),
    username: doc.username,
    displayName: doc.displayName,
    avatar: doc.avatar,
    bio: doc.bio,
    isGuest: doc.isGuest,
    reputation: doc.reputation,
    anonymousMode: doc.anonymousMode,
  };
}

// ---------- GUEST ----------
router.post(
  '/guest',
  asyncHandler(async (req, res) => {
    const limit = config.isProd ? 15 : 100;
    const rl = hit(`guest:${req.ip}`, limit, 60_000);
    if (!rl.ok) throw new ApiError(429, 'Too many guest sessions. Try again shortly.');

    const suffix = Math.random().toString(36).slice(2, 8);
    const username = `guest_${suffix}`;
    const user = await User.create({
      username,
      usernameLower: username.toLowerCase(),
      displayName: `Guest ${suffix.toUpperCase()}`,
      email: `${username}_${Date.now()}@guest.local`,
      passwordHash: null,
      isGuest: true,
      bio: 'Exploring the world chat 👋',
    });
    const tokens = sendAuth(res, String(user._id), user.username, 'guest');
    res.status(201).json({ ...tokens, me: publicMe(user) });
  })
);

// ---------- REGISTER ----------
const registerSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(20, 'Username cannot exceed 20 characters')
    .regex(USERNAME_RE, 'Username can only contain letters, numbers, and underscores')
    .transform((s) => s.trim()),
  displayName: z.string().min(1, 'Display name is required').max(50, 'Display name cannot exceed 50 characters').transform((s) => s.trim()),
  email: z.string().email('Please enter a valid email address').transform((s) => s.toLowerCase().trim()),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

router.post(
  '/register',
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const limit = config.isProd ? 10 : 100;
    const rl = hit(`register:${req.ip}`, limit, 60_000);
    if (!rl.ok) throw new ApiError(429, 'Too many registration attempts. Please wait a moment and try again.');

    const { username, displayName, email, password } = req.body as z.infer<typeof registerSchema>;

    const existing = await User.findOne({
      $or: [{ usernameLower: username.toLowerCase() }, { email }],
    });
    if (existing) {
      if (existing.usernameLower === username.toLowerCase()) {
        throw new ApiError(409, 'That username is already taken. Please choose another.');
      }
      throw new ApiError(409, 'An account with that email already exists. Try signing in instead.');
    }

    const passwordHash = await hashPassword(password);
    const user = await User.create({
      username,
      usernameLower: username.toLowerCase(),
      displayName,
      email,
      passwordHash,
      isGuest: false,
    });
    const tokens = sendAuth(res, String(user._id), user.username, 'user');
    res.status(201).json({ ...tokens, me: publicMe(user) });
  })
);

// ---------- LOGIN ----------
const loginSchema = z.object({
  identifier: z.string().min(1, 'Please enter your username or email').max(120),
  password: z.string().min(1, 'Please enter your password'),
});

router.post(
  '/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const limit = config.isProd ? 15 : 100;
    const rl = hit(`login:${req.ip}`, limit, 60_000);
    if (!rl.ok) throw new ApiError(429, 'Too many login attempts. Please wait a moment and try again.');

    const { identifier, password } = req.body as z.infer<typeof loginSchema>;
    const ident = identifier.toLowerCase().trim();
    const user = await User.findOne({
      $or: [{ usernameLower: ident }, { email: ident }],
    });
    if (!user) {
      throw new ApiError(401, 'No account found with that username or email.');
    }
    if (!user.passwordHash) {
      throw new ApiError(401, 'This is a guest account without a password. Please create an account or continue as guest.');
    }

    const ok = await comparePassword(password, user.passwordHash);
    if (!ok) {
      throw new ApiError(401, 'Incorrect password. Please try again.');
    }

    const tokens = sendAuth(res, String(user._id), user.username, 'user');
    res.json({ ...tokens, me: publicMe(user) });
  })
);

// ---------- REFRESH ----------
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token = (req.body?.refreshToken as string) || (req.cookies?.refreshToken as string);
    if (!token) throw new ApiError(401, 'No refresh token');
    const payload = verifyRefreshToken(token);
    if (!payload) throw new ApiError(401, 'Invalid refresh token');
    const tokens = sendAuth(res, payload.sub, payload.username, payload.role);
    res.json(tokens);
  })
);

// ---------- ME ----------
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.userId);
    if (!user) throw new ApiError(404, 'User not found');
    res.json({ me: publicMe(user) });
  })
);

// ---------- LOGOUT ----------
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    res.clearCookie(config.jwt.cookieName, { path: '/' });
    res.clearCookie('refreshToken', { path: '/' });
    res.json({ ok: true });
  })
);

export default router;
