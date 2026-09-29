import { Router } from 'express';
import { z } from 'zod';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { validate, asyncHandler } from '../middleware/validate.js';
import { ApiError } from '../middleware/errors.js';
import { sanitizeText } from '../utils/text.js';
import { hit } from '../lib/rateLimiter.js';
import { Report } from '../models/moderation.js';
import { isOnline } from '../services/presence.js';
import type { Request, Response } from 'express';

const router = Router();

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function publicUser(doc: {
  _id: unknown;
  username: string;
  displayName: string;
  avatar: string;
  bio: string;
  isGuest: boolean;
  reputation: number;
  lastSeen: Date;
}) {
  return {
    id: String(doc._id),
    username: doc.username,
    displayName: doc.displayName,
    avatar: doc.avatar,
    bio: doc.isGuest ? 'Guest user — exploring the world chat.' : doc.bio,
    isGuest: doc.isGuest,
    reputation: doc.reputation,
    online: isOnline(String(doc._id)),
    lastSeen: doc.lastSeen,
  };
}

// ---------- SEARCH (Chats section only) ----------
const searchSchema = z.object({
  q: z.string().min(1).max(30).transform((s) => sanitizeText(s, 30)),
});

router.get(
  '/search',
  requireAuth,
  validate(searchSchema, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const rl = hit(`usearch:${req.userId}`, 60, 60_000);
    if (!rl.ok) throw new ApiError(429, 'Too many searches — slow down');

    const q = (req.query.q as string) ?? '';
    const trimmed = q.replace(/^@/, '').trim();
    if (!trimmed) return res.json({ results: [], meta: { query: q, exactMatch: false } });

    // 1) Exact username match gets top priority.
    const exact = await User.findOne({ usernameLower: trimmed.toLowerCase() })
      .select('username displayName avatar bio isGuest reputation lastSeen')
      .lean();

    const results: ReturnType<typeof publicUser>[] = [];
    if (exact && !exact.isGuest) {
      results.push(publicUser(exact));
    }

    // 2) Partial username OR display-name matches (registered users only).
    const rx = escapeRegex(trimmed);
    const partial = await User.find({
      $and: [
        { isGuest: false },
        exact ? { _id: { $ne: exact._id } } : {},
        {
          $or: [
            { usernameLower: { $regex: rx, $options: 'i' } },
            { displayName: { $regex: rx, $options: 'i' } },
          ],
        },
      ],
    })
      .select('username displayName avatar bio isGuest reputation lastSeen')
      .sort({ reputation: -1, usernameLower: 1 })
      .limit(20)
      .lean();

    results.push(...partial.map((d) => publicUser(d)));

    res.json({
      results,
      meta: { query: q, exactMatch: Boolean(exact && !exact.isGuest) },
    });
  })
);

// ---------- PUBLIC PROFILE BY USERNAME ----------
router.get(
  '/:username',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const username = sanitizeText(req.params.username, 30).replace(/^@/, '');
    const user = await User.findOne({ usernameLower: username.toLowerCase() })
      .select('username displayName avatar bio isGuest reputation lastSeen blockedUserIds')
      .lean();
    if (!user) throw new ApiError(404, 'User not found');

    const me = await User.findById(req.userId, 'blockedUserIds mutedUserIds').lean();
    if (!me) throw new ApiError(404, 'Not found');

    const viewerRelationship = {
      blockedMe: ((me.blockedUserIds ?? []) as unknown[]).some((b) => String(b) === String(user._id)),
      iBlocked: ((user.blockedUserIds ?? []) as unknown[]).some(
        (b) => String(b) === String(req.userId)
      ),
      iMuted: ((me.mutedUserIds ?? []) as unknown[]).some((m) => String(m) === String(user._id)),
    };

    res.json({ user: publicUser(user), viewerRelationship });
  })
);

// ---------- UPDATE ME ----------
const updateMeSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  bio: z.string().max(200).optional(),
  avatar: z.string().max(400_000).optional(), // allows data-URL fallback when Cloudinary is unset
  anonymousMode: z.boolean().optional(),
  noiseFilterLevel: z.number().int().min(0).max(3).optional(),
});

router.patch(
  '/me',
  requireAuth,
  validate(updateMeSchema),
  asyncHandler(async (req: Request, res: Response) => {
    if (req.role === 'guest') throw new ApiError(403, 'Guests cannot edit profile — create an account');
    const body = req.body as Record<string, unknown>;
    const $set: Record<string, unknown> = {};
    if (typeof body.displayName === 'string') $set.displayName = sanitizeText(body.displayName, 50);
    if (typeof body.bio === 'string') $set.bio = sanitizeText(body.bio, 200);
    if (typeof body.avatar === 'string') $set.avatar = body.avatar;
    if (typeof body.anonymousMode === 'boolean') $set.anonymousMode = body.anonymousMode;
    if (typeof body.noiseFilterLevel === 'number') $set.noiseFilterLevel = body.noiseFilterLevel;
    if (Object.keys($set).length === 0) throw new ApiError(400, 'Nothing to update');

    const user = await User.findByIdAndUpdate(req.userId, { $set }, { new: true });
    if (!user) throw new ApiError(404, 'User not found');

    res.json({
      user: {
        id: String(user._id),
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        bio: user.bio,
        isGuest: user.isGuest,
        reputation: user.reputation,
        anonymousMode: user.anonymousMode,
        noiseFilterLevel: user.noiseFilterLevel,
      },
    });
  })
);

// ---------- BLOCK / UNBLOCK ----------
router.post(
  '/:userId/block',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const targetId = req.params.userId;
    if (!/^[a-f\d]{24}$/i.test(targetId)) throw new ApiError(400, 'Invalid user id');
    if (targetId === req.userId) throw new ApiError(400, 'You cannot block yourself');

    const me = await User.findById(req.userId);
    if (!me) throw new ApiError(404, 'Not found');
    const has = me.blockedUserIds.some((b) => String(b) === targetId);
    if (has) {
      me.blockedUserIds = me.blockedUserIds.filter((b) => String(b) !== targetId);
    } else {
      me.blockedUserIds.push(targetId as never);
      if (!me.mutedUserIds.some((m) => String(m) === targetId)) {
        me.mutedUserIds.push(targetId as never);
      }
    }
    await me.save();
    res.json({ blocked: !has });
  })
);

// ---------- MUTE / UNMUTE ----------
router.post(
  '/:userId/mute',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const targetId = req.params.userId;
    if (!/^[a-f\d]{24}$/i.test(targetId)) throw new ApiError(400, 'Invalid user id');
    if (targetId === req.userId) throw new ApiError(400, 'You cannot mute yourself');

    const me = await User.findById(req.userId);
    if (!me) throw new ApiError(404, 'Not found');
    const has = me.mutedUserIds.some((m) => String(m) === targetId);
    if (has) {
      me.mutedUserIds = me.mutedUserIds.filter((m) => String(m) !== targetId);
    } else {
      me.mutedUserIds.push(targetId as never);
    }
    await me.save();
    res.json({ muted: !has });
  })
);

// ---------- REPORT USER ----------
const reportSchema = z.object({
  reason: z.string().min(1).max(80),
  details: z.string().max(500).optional(),
});

router.post(
  '/:userId/report',
  requireAuth,
  validate(reportSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const targetId = req.params.userId;
    if (!/^[a-f\d]{24}$/i.test(targetId)) throw new ApiError(400, 'Invalid user id');
    if (targetId === req.userId) throw new ApiError(400, 'You cannot report yourself');

    const { reason, details } = req.body as z.infer<typeof reportSchema>;
    try {
      await Report.create({
        reporterId: req.userId as never,
        targetType: 'user',
        targetId: targetId as never,
        reason: sanitizeText(reason, 80),
        details: sanitizeText(details ?? '', 500),
      });
    } catch {
      throw new ApiError(409, 'You already reported this user');
    }
    res.json({ ok: true });
  })
);

export default router;
