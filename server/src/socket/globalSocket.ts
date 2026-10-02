import type { Server, Socket } from 'socket.io';
import { GlobalMessage } from '../models/GlobalMessage.js';
import { User } from '../models/User.js';
import { sanitizeText } from '../utils/text.js';
import { resolveMentions } from '../utils/mentions.js';
import { hit, penalize } from '../lib/rateLimiter.js';
import { config } from '../config/env.js';
import { logger } from '../lib/logger.js';

type Ctx = { userId: string; username: string; role: 'user' | 'guest' };

function ctxOf(socket: Socket): Ctx {
  return {
    userId: socket.data.payload.sub,
    username: socket.data.payload.username,
    role: socket.data.payload.role,
  };
}

export function registerGlobalHandlers(io: Server, socket: Socket) {
  const nsp = io.of('/global');

  // ---------- send message ----------
  socket.on('global:send', async (raw: unknown, ack?: (res: unknown) => void) => {
    const ctx = ctxOf(socket);
    try {
      const body = (raw ?? {}) as { text?: string; kind?: string; replyToId?: string; ttlMinutes?: number; anonymous?: boolean };
      const text = sanitizeText(body.text, 1000);
      if (!text) return ack?.({ error: 'Message cannot be empty' });

      // rate limiting / anti-spam
      const cooldown = ctx.role === 'guest' ? config.limits.guestMessageCooldownMs : config.limits.globalMessageCooldownMs;
      const rl = hit(`gmsg:${ctx.userId}`, 5, 10_000);
      if (!rl.ok) {
        penalize(`gmsg:${ctx.userId}`, rl.retryAfterMs);
        return ack?.({ error: 'Slow down a moment — too many messages.' });
      }
      const cd = hit(`gcool:${ctx.userId}`, 1, cooldown);
      if (!cd.ok) return ack?.({ error: `Please wait before sending again.` });

      const user = await User.findById(ctx.userId);
      if (!user) return ack?.({ error: 'Account not found' });

      // blocked/muted filtering: if the author blocked the reply target, still fine;
      // noise filtering happens on read side. Guests cannot send questions.
      const kind = body.kind === 'question' && ctx.role !== 'guest' ? 'question' : 'message';

      let replySnapshot = null;
      if (body.replyToId) {
        const parent = await GlobalMessage.findOne({ _id: body.replyToId, isDeleted: false }).lean();
        if (parent) {
          replySnapshot = {
            id: String(parent._id),
            username: parent.isAnonymous ? 'anonymous' : parent.senderUsername,
            text: parent.text.slice(0, 140),
          };
        }
      }

      const expiresAt =
        typeof body.ttlMinutes === 'number' && body.ttlMinutes > 0
          ? new Date(Date.now() + Math.min(body.ttlMinutes, 1440) * 60_000)
          : null;

      const anonymous = Boolean(body.anonymous) && user.anonymousMode;

      const mentions = await resolveMentions(text, ctx.userId);

      const doc = await GlobalMessage.create({
        senderId: user._id,
        senderUsername: user.username,
        senderDisplayName: user.displayName,
        senderAvatar: user.avatar,
        isAnonymous: anonymous,
        text,
        kind,
        replyToId: body.replyToId && replySnapshot ? body.replyToId : null,
        replySnapshot,
        mentions,
        expiresAt,
      });

      const payload = {
        ...doc.toObject(),
        replySnapshot,
      };

      nsp.emit('global:message', payload);
      // milestone/trending bookkeeping is periodic; emit pulse tick
      nsp.emit('global:pulse', { at: Date.now() });

      // Targeted @mention ping — only the mentioned users' personal rooms.
      for (const mt of mentions) {
        nsp.to(`user:${mt.userId}`).emit('global:mention', {
          messageId: String(doc._id),
          text: text.slice(0, 200),
          from: anonymous
            ? null
            : { id: ctx.userId, username: ctx.username, displayName: user.displayName, avatar: user.avatar },
        });
      }
      ack?.({ message: payload });
    } catch (err) {
      logger.error('global:send failed', err);
      ack?.({ error: 'Failed to send message' });
    }
  });

  // ---------- typing ----------
  const typingUsers = new Map<string, NodeJS.Timeout>();
  socket.on('global:typing', () => {
    const ctx = ctxOf(socket);
    nsp.emit('global:typing', { userId: ctx.userId, username: ctx.username });
    const key = ctx.userId;
    const existing = typingUsers.get(key);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      nsp.emit('global:stopTyping', { userId: key });
      typingUsers.delete(key);
    }, 2500);
    typingUsers.set(key, t);
  });

  // ---------- reactions (Live Reaction Storm) ----------
  socket.on('global:reaction', async (raw: unknown, ack?: (res: unknown) => void) => {
    const ctx = ctxOf(socket);
    try {
      const body = (raw ?? {}) as { messageId?: string; emoji?: string };
      if (!body.messageId || !body.emoji) return ack?.({ error: 'Invalid reaction' });
      const emoji = String(body.emoji).slice(0, 16);
      if (emoji.length > 8) return ack?.({ error: 'Invalid emoji' });

      const rl = hit(`greact:${ctx.userId}`, 30, 10_000);
      if (!rl.ok) return ack?.({ error: 'Too many reactions' });

      const msg = await GlobalMessage.findOne({ _id: body.messageId, isDeleted: false });
      if (!msg) return ack?.({ error: 'Message not found' });

      const uid = new (GlobalMessage.base.Types.ObjectId)(ctx.userId);
      const existingIdx = msg.reactors.findIndex(
        (r) => String(r.userId) === ctx.userId && r.emoji === emoji
      );
      let removed = false;
      if (existingIdx >= 0) {
        msg.reactors.splice(existingIdx, 1);
        removed = true;
      } else {
        // one reaction per user per message: remove other emoji from this user
        msg.reactors = msg.reactors.filter((r) => String(r.userId) !== ctx.userId);
        msg.reactors.push({ userId: uid, emoji });
      }

      // recount
      const counts = new Map<string, number>();
      for (const r of msg.reactors) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
      msg.reactions = [...counts.entries()].map(([e, count]) => ({ emoji: e, count }));
      msg.score = msg.reactions.reduce((acc, r) => acc + r.count, 0) * 2 + (msg.kind === 'question' ? 3 : 0);
      await msg.save();

      nsp.emit('global:reaction', {
        messageId: String(msg._id),
        reactions: msg.reactions,
        reactors: msg.reactors.map((r) => ({ userId: String(r.userId), emoji: r.emoji })),
        score: msg.score,
        by: ctx.userId,
        emoji,
        removed,
      });
      ack?.({ ok: true });
    } catch (err) {
      logger.error('global:reaction failed', err);
      ack?.({ error: 'Failed to react' });
    }
  });

  // ---------- edit ----------
  socket.on('global:edit', async (raw: unknown, ack?: (res: unknown) => void) => {
    const ctx = ctxOf(socket);
    try {
      const body = (raw ?? {}) as { messageId?: string; text?: string };
      const text = sanitizeText(body.text, 1000);
      if (!body.messageId || !text) return ack?.({ error: 'Invalid edit' });

      const msg = await GlobalMessage.findOne({ _id: body.messageId, isDeleted: false });
      if (!msg) return ack?.({ error: 'Message not found' });
      if (String(msg.senderId) !== ctx.userId) return ack?.({ error: 'You can only edit your own messages' });

      // Re-resolve mentions on edit; only newly added people get pinged.
      const previous = (msg.mentions ?? []).map((x) => String(x.userId));
      const mentions = await resolveMentions(text, ctx.userId);

      msg.text = text;
      msg.mentions = mentions.map((m) => ({ userId: m.userId as never, username: m.username }));
      msg.isEdited = true;
      msg.editedAt = new Date();
      await msg.save();

      nsp.emit('global:messageUpdated', {
        messageId: String(msg._id),
        text: msg.text,
        mentions: msg.mentions.map((x) => ({ userId: String(x.userId), username: x.username })),
        isEdited: true,
        editedAt: msg.editedAt,
      });

      const added = mentions.filter((mt) => !previous.includes(mt.userId));
      if (added.length) {
        const sender = await User.findById(ctx.userId, 'username displayName avatar');
        for (const mt of added) {
          nsp.to(`user:${mt.userId}`).emit('global:mention', {
            messageId: String(msg._id),
            text: text.slice(0, 200),
            from: sender
              ? { id: ctx.userId, username: sender.username, displayName: sender.displayName, avatar: sender.avatar }
              : { id: ctx.userId, username: ctx.username, displayName: ctx.username, avatar: '' },
          });
        }
      }
      ack?.({ ok: true });
    } catch (err) {
      logger.error('global:edit failed', err);
      ack?.({ error: 'Failed to edit' });
    }
  });

  // ---------- delete ----------
  socket.on('global:delete', async (raw: unknown, ack?: (res: unknown) => void) => {
    const ctx = ctxOf(socket);
    try {
      const body = (raw ?? {}) as { messageId?: string };
      if (!body.messageId) return ack?.({ error: 'Invalid delete' });

      const msg = await GlobalMessage.findOne({ _id: body.messageId });
      if (!msg || msg.isDeleted) return ack?.({ error: 'Message not found' });
      if (String(msg.senderId) !== ctx.userId) return ack?.({ error: 'You can only delete your own messages' });

      msg.isDeleted = true;
      msg.deletedAt = new Date();
      msg.text = '';
      msg.reactions = [];
      msg.reactors = [];
      await msg.save();

      nsp.emit('global:messageDeleted', { messageId: String(msg._id) });
      ack?.({ ok: true });
    } catch (err) {
      logger.error('global:delete failed', err);
      ack?.({ error: 'Failed to delete' });
    }
  });
}
