import { Router } from 'express';
import { z } from 'zod';
import { GlobalMessage } from '../models/GlobalMessage.js';
import { Challenge, dailyChallengeText, Milestone, Report } from '../models/moderation.js';
import { User } from '../models/User.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { validate, asyncHandler } from '../middleware/validate.js';
import { ApiError } from '../middleware/errors.js';
import { sanitizeText } from '../utils/text.js';
import { hit } from '../lib/rateLimiter.js';
import { getOnlineCount } from '../services/presence.js';
import type { Request, Response } from 'express';

const router = Router();

// ---------- FEED ----------
const feedQuery = z.object({
  before: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  mode: z.enum(['latest', 'trending', 'questions']).optional(),
});

router.get(
  '/messages',
  optionalAuth,
  validate(feedQuery, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 100);
    const mode = (req.query.mode as string) ?? 'latest';
    const before = (req.query.before as string) || null;

    const filter: Record<string, unknown> = { isDeleted: false };
    if (mode === 'questions') filter.kind = 'question';
    if (before) {
      const ts = Number(before);
      if (!Number.isFinite(ts)) throw new ApiError(400, 'Invalid cursor');
      filter.createdAt = { $lt: new Date(ts) };
    }

    const sort: Record<string, 1 | -1> =
      mode === 'trending' ? { score: -1, createdAt: -1 } : { createdAt: -1 };

    const messages = await GlobalMessage.find(filter).sort(sort).limit(limit).lean();
    const nextBefore =
      messages.length === limit && messages.length > 0
        ? String(new Date(messages[messages.length - 1].createdAt).getTime())
        : null;

    res.json({
      messages: messages.reverse(),
      nextBefore,
      hasMore: messages.length === limit,
      onlineCount: getOnlineCount(),
    });
  })
);

// ---------- POST MESSAGE (REST fallback) ----------
const postSchema = z.object({
  text: z.string().min(1).max(1000),
  kind: z.enum(['message', 'question']).optional(),
  replyToId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  ttlMinutes: z.number().int().min(0).max(1440).optional(),
  anonymous: z.boolean().optional(),
});

router.post(
  '/messages',
  requireAuth,
  validate(postSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const rl = hit(`gmsg:${req.userId}`, 5, 10_000);
    if (!rl.ok) throw new ApiError(429, 'Slow down — too many messages');

    const user = await User.findById(req.userId);
    if (!user) throw new ApiError(404, 'Account not found');

    const text = sanitizeText(String(req.body.text), 1000);
    if (!text) throw new ApiError(400, 'Message cannot be empty');

    const kind = req.body.kind === 'question' && req.role !== 'guest' ? 'question' : 'message';
    const anonymous = Boolean(req.body.anonymous) && user.anonymousMode;

    let replySnapshot: { id: string; username: string; text: string } | null = null;
    if (req.body.replyToId) {
      const parent = await GlobalMessage.findOne({ _id: req.body.replyToId, isDeleted: false }).lean();
      if (parent) {
        replySnapshot = {
          id: String(parent._id),
          username: parent.isAnonymous ? 'anonymous' : parent.senderUsername,
          text: parent.text.slice(0, 140),
        };
      }
    }

    const ttl = Number(req.body.ttlMinutes ?? 0);
    const expiresAt = ttl > 0 ? new Date(Date.now() + Math.min(ttl, 1440) * 60_000) : null;

    const doc = await GlobalMessage.create({
      senderId: req.userId as never,
      senderUsername: user.username,
      senderDisplayName: user.displayName,
      senderAvatar: user.avatar,
      isAnonymous: anonymous,
      text,
      kind,
      replyToId: req.body.replyToId && replySnapshot ? (req.body.replyToId as never) : null,
      replySnapshot,
      expiresAt,
    });

    res.status(201).json({ message: doc });
  })
);

// ---------- META: pulse, challenge, milestones, trending ----------
router.get(
  '/meta',
  optionalAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10);

    const challenge =
      (await Challenge.findOne({ dateKey }).lean()) ??
      ({ dateKey, text: dailyChallengeText(now), isAuto: true } as unknown as {
        dateKey: string;
        text: string;
        isAuto: boolean;
      });

    const [totalMessages, totalUsers, milestone] = await Promise.all([
      GlobalMessage.countDocuments({ isDeleted: false }),
      User.countDocuments({ isGuest: false }),
      Milestone.findOne().sort({ celebratedAt: -1 }).lean(),
    ]);

    const nextMilestoneTarget = Math.max(100, Math.ceil((totalMessages + 1) / 100) * 100);
    const progress = Math.min(100, Math.round((totalMessages / nextMilestoneTarget) * 100));

    const trending = await GlobalMessage.find({ isDeleted: false, kind: { $ne: 'challenge' } })
      .sort({ score: -1, createdAt: -1 })
      .limit(5)
      .select('text score reactions kind')
      .lean();

    res.json({
      onlineCount: getOnlineCount(),
      challenge,
      totals: { messages: totalMessages, users: totalUsers },
      milestone: milestone
        ? { label: milestone.label, value: milestone.value, celebratedAt: milestone.celebratedAt }
        : null,
      nextMilestone: { target: nextMilestoneTarget, progress },
      trending: trending.map((t) => ({
        id: String(t._id),
        text: t.text.slice(0, 80),
        score: t.score,
        reactions: t.reactions,
        kind: t.kind,
      })),
    });
  })
);

// ---------- REPORT GLOBAL MESSAGE ----------
const reportSchema = z.object({
  reason: z.string().min(1).max(80),
  details: z.string().max(500).optional(),
});

router.post(
  '/messages/:messageId/report',
  requireAuth,
  validate(reportSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const messageId = req.params.messageId;
    if (!/^[a-f\d]{24}$/i.test(messageId)) throw new ApiError(400, 'Invalid message id');
    const { reason, details } = req.body as z.infer<typeof reportSchema>;

    try {
      await Report.create({
        reporterId: req.userId as never,
        targetType: 'global_message',
        targetId: messageId as never,
        reason: sanitizeText(reason, 80),
        details: sanitizeText(details ?? '', 500),
      });
    } catch {
      throw new ApiError(409, 'You already reported this message');
    }

    await GlobalMessage.updateOne({ _id: messageId }, { $inc: { reportCount: 1 } });
    res.json({ ok: true });
  })
);

export default router;
