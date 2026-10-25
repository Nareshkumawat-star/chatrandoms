import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Conversation, makeDirectKey } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { validate, asyncHandler } from '../middleware/validate.js';
import { ApiError } from '../middleware/errors.js';
import { sanitizeText } from '../utils/text.js';
import { resolveMentions } from '../utils/mentions.js';
import { hit } from '../lib/rateLimiter.js';
import { getIo, isOnline } from '../services/presence.js';
import type { Request, Response } from 'express';

const router = Router();

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function otherParticipant(conv: { participants: { toString(): string }[] }, userId: string): string {
  return conv.participants.map(String).find((p) => p !== userId) ?? '';
}

// ---------- LIST MY CONVERSATIONS ----------
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const convs = await Conversation.find({ participants: req.userId })
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .limit(100)
      .lean();

    const otherIds = convs.map((c) => otherParticipant(c, req.userId!)).filter(Boolean);
    const others = await User.find({ _id: { $in: otherIds } })
      .select('username displayName avatar isOnline lastSeen isGuest')
      .lean();
    const byId = new Map(others.map((u) => [String(u._id), u]));

    const unread = await Message.aggregate([
      {
        $match: {
          receiverId: new mongoose.Types.ObjectId(req.userId),
          readAt: null,
          isDeleted: false,
        },
      },
      { $group: { _id: '$conversationId', count: { $sum: 1 } } },
    ]);
    const unreadByConv = new Map(unread.map((r) => [String(r._id), r.count]));

    const items = convs.map((c) => {
      const otherId = otherParticipant(c, req.userId!);
      const other = byId.get(otherId);
      const pinnedAt = c.pinnedBy?.find((f) => String(f.user) === req.userId)?.at ?? null;
      const archivedAt = c.archivedBy?.find((f) => String(f.user) === req.userId)?.at ?? null;
      return {
        id: String(c._id),
        other: other
          ? {
              id: String(other._id),
              username: other.username,
              displayName: other.displayName,
              avatar: other.avatar,
              online: isOnline(String(other._id)),
              lastSeen: other.lastSeen,
              isGuest: other.isGuest,
            }
          : null,
        lastMessage: c.lastMessage
          ? {
              text: c.lastMessage.text,
              mine: String(c.lastMessage.senderId) === req.userId,
              at: c.lastMessage.at,
            }
          : null,
        lastMessageAt: c.lastMessageAt,
        unread: unreadByConv.get(String(c._id)) ?? 0,
        pinned: Boolean(pinnedAt),
        archived: Boolean(archivedAt),
        pinnedAt,
      };
    });

    // Pinned chats float to the top (newest pin first), everything else keeps
    // the lastMessageAt order. Archived chats stay in place — the client
    // groups them separately.
    items.sort((x, y) => {
      if (x.pinned !== y.pinned) return x.pinned ? -1 : 1;
      if (x.pinned && y.pinned) {
        return new Date(y.pinnedAt as Date).getTime() - new Date(x.pinnedAt as Date).getTime();
      }
      return 0;
    });

    res.json({ items });
  })
);

// ---------- PIN / ARCHIVE A CONVERSATION (per user) ----------
const stateSchema = z
  .object({
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine((d) => d.pinned !== undefined || d.archived !== undefined, {
    message: 'pinned or archived is required',
  });

router.patch(
  '/:conversationId/state',
  requireAuth,
  validate(stateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const conversationId = req.params.conversationId;
    if (!/^[a-f\d]{24}$/i.test(conversationId)) throw new ApiError(400, 'Invalid conversation id');

    const conv = await Conversation.findById(conversationId).lean();
    if (!conv) throw new ApiError(404, 'Conversation not found');
    if (!conv.participants.some((p) => String(p) === req.userId)) {
      throw new ApiError(403, 'You are not a participant of this conversation');
    }

    const { pinned, archived } = req.body as { pinned?: boolean; archived?: boolean };
    const user = new mongoose.Types.ObjectId(req.userId);
    const pull: Record<string, unknown> = {};
    const push: Record<string, unknown> = {};

    if (pinned === true) {
      pull.pinnedBy = { user };
      push.pinnedBy = { user, at: new Date() };
    } else if (pinned === false) {
      pull.pinnedBy = { user };
    }

    if (archived === true) {
      pull.archivedBy = { user };
      push.archivedBy = { user, at: new Date() };
      // An archived chat leaves the pinned group — two homes would be ambiguous.
      pull.pinnedBy = { user };
      delete push.pinnedBy;
    } else if (archived === false) {
      pull.archivedBy = { user };
    }

    // Mongo rejects $pull + $push on the same path in one update, so the
    // remove-then-add pair runs as two steps (pin re-ordering needs both).
    if (Object.keys(pull).length) {
      await Conversation.updateOne({ _id: conversationId }, { $pull: pull });
    }
    if (Object.keys(push).length) {
      await Conversation.updateOne({ _id: conversationId }, { $push: push });
    }

    const after = Object.keys(pull).length || Object.keys(push).length
      ? await Conversation.findById(conversationId).lean()
      : conv;

    const nowPinned = Boolean(after?.pinnedBy?.some((f) => String(f.user) === req.userId));
    const nowArchived = Boolean(after?.archivedBy?.some((f) => String(f.user) === req.userId));
    res.json({ id: conversationId, pinned: nowPinned, archived: nowArchived });
  })
);

// ---------- CREATE OR GET DIRECT CONVERSATION ----------
const directSchema = z
  .object({
    username: z.string().min(1).max(30).optional(),
    userId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  })
  .refine((d) => Boolean(d.username || d.userId), { message: 'username or userId is required' });

router.post(
  '/direct',
  requireAuth,
  validate(directSchema),
  asyncHandler(async (req: Request, res: Response) => {
    if (req.role === 'guest') {
      throw new ApiError(403, 'Create an account to start private chats.');
    }
    const rl = hit(`direct:${req.userId}`, 20, 60_000);
    if (!rl.ok) throw new ApiError(429, 'Too many requests');

    const body = req.body as { username?: string; userId?: string };

    // Resolve target by userId (spec) or username (convenience).
    const other = body.userId
      ? await User.findById(body.userId)
      : await User.findOne({
          usernameLower: String(body.username).replace(/^@/, '').trim().toLowerCase(),
        });
    if (!other) throw new ApiError(404, 'User not found');
    if (String(other._id) === req.userId) throw new ApiError(400, 'This is your own account.');

    // Block checks in both directions.
    const me = await User.findById(req.userId, 'blockedUserIds');
    if (me?.blockedUserIds.some((b) => String(b) === String(other._id))) {
      throw new ApiError(403, 'You have blocked this user');
    }
    if (other.blockedUserIds.some((b) => String(b) === String(req.userId))) {
      throw new ApiError(403, 'This user is not accepting private messages');
    }

    const directKey = makeDirectKey(req.userId!, other._id);
    const conv = await Conversation.findOneAndUpdate(
      { directKey },
      {
        $setOnInsert: {
          type: 'direct',
          participants: [req.userId, other._id],
          directKey,
        },
      },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({
      conversation: {
        id: String(conv._id),
        directKey: conv.directKey,
        other: {
          id: String(other._id),
          username: other.username,
          displayName: other.displayName,
          avatar: other.avatar,
          online: isOnline(String(other._id)),
          lastSeen: other.lastSeen,
          isGuest: other.isGuest,
        },
        created: Boolean((conv as unknown as { createdAt: Date }).createdAt &&
          Date.now() - new Date((conv as unknown as { createdAt: Date }).createdAt).getTime() < 2000),
      },
    });
  })
);

// ---------- MESSAGES OF A CONVERSATION ----------
const messagesQuerySchema = z.object({
  // Cursor is a millisecond timestamp (matches the nextBefore we return below).
  before: z.string().regex(/^\d{1,15}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

router.get(
  '/:conversationId/messages',
  requireAuth,
  validate(messagesQuerySchema, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const conversationId = req.params.conversationId;
    if (!/^[a-f\d]{24}$/i.test(conversationId)) throw new ApiError(400, 'Invalid conversation id');

    // Authorization: requester must be a participant.
    const conv = await Conversation.findById(conversationId).lean();
    if (!conv) throw new ApiError(404, 'Conversation not found');
    const isParticipant = conv.participants.some((p) => String(p) === req.userId);
    if (!isParticipant) throw new ApiError(403, 'You are not a participant of this conversation');

    const limit = Number((req.query.limit as string) ?? 50);
    const before = (req.query.before as string) || null;

    const filter: Record<string, unknown> = { conversationId: conv._id };
    if (before) {
      const ts = Number(before);
      if (!Number.isFinite(ts)) throw new ApiError(400, 'Invalid cursor');
      filter.createdAt = { $lt: new Date(ts) };
    }

    const messages = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const nextBefore =
      messages.length === limit && messages.length > 0
        ? String(new Date(messages[messages.length - 1].createdAt).getTime())
        : null;

    res.json({
      messages: messages.reverse(), // oldest → newest for rendering
      nextBefore,
      hasMore: messages.length === limit,
    });
  })
);

// ---------- SEND MESSAGE (REST fallback; sockets preferred) ----------
const sendSchema = z.object({
  text: z.string().min(1).max(4000),
  replyTo: z.string().regex(/^[a-f\d]{24}$/i).optional(),
});

router.post(
  '/:conversationId/messages',
  requireAuth,
  validate(sendSchema),
  asyncHandler(async (req: Request, res: Response) => {
    if (req.role === 'guest') throw new ApiError(403, 'Create an account to start private chats.');
    const conversationId = req.params.conversationId;
    if (!/^[a-f\d]{24}$/i.test(conversationId)) throw new ApiError(400, 'Invalid conversation id');

    const rl = hit(`dmsg:${req.userId}`, 10, 10_000);
    if (!rl.ok) throw new ApiError(429, 'You are sending messages too fast');

    const conv = await Conversation.findById(conversationId);
    if (!conv) throw new ApiError(404, 'Conversation not found');
    const isParticipant = conv.participants.some((p) => String(p) === req.userId);
    if (!isParticipant) throw new ApiError(403, 'You are not a participant');

    const receiverId = conv.participants.map(String).find((p) => p !== req.userId);
    if (!receiverId) throw new ApiError(400, 'Conversation is invalid');

    // Block checks both directions
    const [me, other] = await Promise.all([
      User.findById(req.userId, 'blockedUserIds username'),
      User.findById(receiverId, 'blockedUserIds'),
    ]);
    if (me?.blockedUserIds.some((b) => String(b) === receiverId)) {
      throw new ApiError(403, 'You have blocked this user');
    }
    if (other?.blockedUserIds.some((b) => String(b) === req.userId)) {
      throw new ApiError(403, 'You cannot message this user');
    }

    const text = sanitizeText(String(req.body.text), 4000);
    // Resolve @handles for highlighting; ping only fellow participants below.
    const mentions = await resolveMentions(text, req.userId!);
    const doc = await Message.create({
      conversationId: conv._id,
      senderId: req.userId,
      receiverId,
      text,
      replyTo: (req.body.replyTo as string) || null,
      mentions,
    });

    conv.lastMessage = { text, senderId: doc.senderId, at: doc.createdAt };
    conv.lastMessageAt = doc.createdAt;
    await conv.save();

    // Targeted @mention ping over the dm namespace's personal rooms.
    // Only participants — a private chat must never leak to outsiders.
    const dmNsp = getIo()?.of('/dm');
    const participantIds = conv.participants.map(String);
    if (dmNsp) {
      for (const mt of mentions) {
        if (!participantIds.includes(mt.userId)) continue;
        dmNsp.to(`user:${mt.userId}`).emit('dm:mention', {
          conversationId: String(conv._id),
          messageId: String(doc._id),
          text: text.slice(0, 200),
          from: { id: req.userId, username: me?.username },
        });
      }
    }

    res.status(201).json({ message: doc });
  })
);

export default router;
