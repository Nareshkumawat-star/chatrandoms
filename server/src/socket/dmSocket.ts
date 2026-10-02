import type { Server, Socket } from 'socket.io';
import { Message, type Attachment, type MessageDoc } from '../models/Message.js';
import { Conversation, makeDirectKey } from '../models/Conversation.js';
import { User } from '../models/User.js';
import { sanitizeText } from '../utils/text.js';
import { hit } from '../lib/rateLimiter.js';
import { deleteAsset, uploadAudio, uploadPhoto } from '../lib/cloudinary.js';
import { config } from '../config/env.js';
import { logger } from '../lib/logger.js';

type Ctx = { userId: string; role: 'user' | 'guest' };

function ctxOf(socket: Socket): Ctx {
  return { userId: socket.data.payload.sub, role: socket.data.payload.role };
}

async function loadAuthorizedConversation(userId: string, conversationId: string) {
  if (!conversationId || !/^[a-f\d]{24}$/i.test(conversationId)) return null;
  const conv = await Conversation.findById(conversationId);
  if (!conv) return null;
  // Authorization: current user MUST be a participant.
  const isParticipant = conv.participants.some((p) => String(p) === userId);
  if (!isParticipant) return null;
  return conv;
}

function messagePayload(doc: MessageDoc) {
  const base = doc.toObject();
  return {
    ...base,
    _id: String(base._id),
    conversationId: String(base.conversationId),
    senderId: String(base.senderId),
    receiverId: String(base.receiverId),
    replyTo: base.replyTo ? String(base.replyTo) : null,
  };
}

export function registerDmHandlers(io: Server, socket: Socket) {
  const nsp = io.of('/dm');

  // ---------- send message ----------
  socket.on('dm:send', async (raw: unknown, ack?: (res: unknown) => void) => {
    const ctx = ctxOf(socket);
    try {
      if (ctx.role === 'guest') {
        return ack?.({ error: 'Create an account to start private chats.' });
      }
      const body = (raw ?? {}) as {
        conversationId?: string;
        text?: string;
        replyTo?: string;
        image?: { dataUrl?: string; name?: string };
        voice?: { dataUrl?: string; name?: string; durationMs?: number; mime?: string };
      };
      const text = sanitizeText(body.text, 4000);

      // Optional attachments — validated here, uploaded server-side, so
      // clients can only ever store URLs that came out of our own pipeline.
      const rawImage = typeof body.image?.dataUrl === 'string' ? body.image.dataUrl : '';
      const rawVoice = typeof body.voice?.dataUrl === 'string' ? body.voice.dataUrl : '';
      if (rawImage && rawVoice) {
        return ack?.({ error: 'Attach a photo or a voice message, not both' });
      }
      if (rawImage) {
        if (!/^data:image\/(jpe?g|png|webp|gif|avif);base64,/i.test(rawImage)) {
          return ack?.({ error: 'Only JPG, PNG, WEBP, GIF or AVIF images are allowed' });
        }
        if (rawImage.length > 700_000) {
          return ack?.({ error: 'Image is too large — pick a smaller photo' });
        }
      }
      if (rawVoice) {
        if (!/^data:audio\/[a-z0-9.+-]+(?:;[a-z0-9=+.-]+)*;base64,/i.test(rawVoice)) {
          return ack?.({ error: 'Unsupported voice recording format' });
        }
        if (rawVoice.length > 1_300_000) {
          return ack?.({ error: 'Voice message is too long — record a shorter clip' });
        }
      }
      if (!text && !rawImage && !rawVoice) return ack?.({ error: 'Message cannot be empty' });

      const conv = await loadAuthorizedConversation(ctx.userId, String(body.conversationId));
      if (!conv) return ack?.({ error: 'Conversation not found' });

      const rl = hit(`dmsg:${ctx.userId}`, 10, 10_000);
      if (!rl.ok) return ack?.({ error: 'You are sending messages too fast' });

      const receiverId = conv.participants.find((p) => String(p) !== ctx.userId);
      if (!receiverId) return ack?.({ error: 'Conversation is invalid' });

      // blocked check (either direction blocks new messages)
      const [me, other] = await Promise.all([
        User.findById(ctx.userId, 'blockedUserIds'),
        User.findById(String(receiverId), 'blockedUserIds isOnline'),
      ]);
      if (!me || !other) return ack?.({ error: 'User not found' });
      const blocked =
        me.blockedUserIds.some((b) => String(b) === String(receiverId)) ||
        other.blockedUserIds.some((b) => String(b) === ctx.userId);
      if (blocked) return ack?.({ error: 'You cannot message this user' });

      let replyTo: string | null = null;
      if (body.replyTo) {
        const parent = await Message.findOne({
          _id: body.replyTo,
          conversationId: conv._id,
          isDeleted: false,
        }).lean();
        replyTo = parent ? String(parent._id) : null;
      }

      let attachments: Attachment[] = [];
      if (rawImage) {
        const imgRl = hit(`dimg:${ctx.userId}`, 20, 60_000);
        if (!imgRl.ok) return ack?.({ error: 'Too many photo uploads — try again shortly' });
        const { url, publicId } = await uploadPhoto(rawImage, 'pulse-chat/dm');
        attachments = [
          {
            kind: 'image',
            url,
            publicId: publicId ?? undefined,
            name: sanitizeText(body.image?.name, 80) || 'photo',
          },
        ];
      } else if (rawVoice) {
        const voiceRl = hit(`dvoice:${ctx.userId}`, 20, 60_000);
        if (!voiceRl.ok) return ack?.({ error: 'Too many voice uploads — try again shortly' });
        const { url, publicId } = await uploadAudio(rawVoice, 'pulse-chat/voice');
        const durationMs = Math.max(0, Math.min(180_000, Math.round(Number(body.voice?.durationMs) || 0)));
        attachments = [
          {
            kind: 'audio',
            url,
            publicId: publicId ?? undefined,
            name: sanitizeText(body.voice?.name, 80) || 'Voice message',
            durationMs,
            mime: sanitizeText(body.voice?.mime, 60) || undefined,
          },
        ];
      }

      const doc = await Message.create({
        conversationId: conv._id,
        senderId: ctx.userId,
        receiverId,
        text,
        type: attachments.length ? (rawVoice ? 'voice' : 'image') : 'text',
        attachments,
        replyTo,
      });

      const payload = messagePayload(doc);

      // Conversation list preview: a media-only message still needs a label.
      conv.lastMessage = {
        text: text || (rawVoice ? '🎤 Voice message' : '📷 Photo'),
        senderId: doc.senderId,
        at: doc.createdAt,
      };
      conv.lastMessageAt = doc.createdAt;
      await conv.save();

      // Deliver only to the two participants' personal rooms — never to global.
      nsp.to(`user:${ctx.userId}`).emit('dm:new', payload);
      nsp.to(`user:${String(receiverId)}`).emit('dm:new', payload);
      nsp.to(`user:${String(receiverId)}`).emit('dm:unread-tick', {
        conversationId: String(conv._id),
      });

      ack?.({ message: payload });
    } catch (err) {
      logger.error('dm:send failed', err);
      ack?.({ error: 'Failed to send message' });
    }
  });

  // ---------- typing ----------
  socket.on('dm:typing', async (raw: unknown) => {
    const ctx = ctxOf(socket);
    const body = (raw ?? {}) as { conversationId?: string };
    const conv = await loadAuthorizedConversation(ctx.userId, String(body.conversationId));
    if (!conv) return;
    const receiverId = conv.participants.find((p) => String(p) !== ctx.userId);
    if (!receiverId) return;
    nsp.to(`user:${String(receiverId)}`).emit('dm:typing', {
      conversationId: String(conv._id),
      userId: ctx.userId,
    });
  });

  socket.on('dm:stopTyping', async (raw: unknown) => {
    const ctx = ctxOf(socket);
    const body = (raw ?? {}) as { conversationId?: string };
    const conv = await loadAuthorizedConversation(ctx.userId, String(body.conversationId));
    if (!conv) return;
    const receiverId = conv.participants.find((p) => String(p) !== ctx.userId);
    if (!receiverId) return;
    nsp.to(`user:${String(receiverId)}`).emit('dm:stopTyping', {
      conversationId: String(conv._id),
      userId: ctx.userId,
    });
  });

  // ---------- read receipts ----------
  socket.on('dm:read', async (raw: unknown, ack?: (res: unknown) => void) => {
    const ctx = ctxOf(socket);
    try {
      const body = (raw ?? {}) as { conversationId?: string };
      const conv = await loadAuthorizedConversation(ctx.userId, String(body.conversationId));
      if (!conv) return ack?.({ error: 'Conversation not found' });

      const now = new Date();
      const res = await Message.updateMany(
        { conversationId: conv._id, receiverId: ctx.userId, readAt: null },
        { $set: { readAt: now } }
      );
      const senderId = conv.participants.find((p) => String(p) !== ctx.userId);
      if (senderId && res.modifiedCount > 0) {
        nsp.to(`user:${String(senderId)}`).emit('dm:read', {
          conversationId: String(conv._id),
          by: ctx.userId,
          at: now,
        });
      }
      ack?.({ ok: true, modified: res.modifiedCount });
    } catch (err) {
      logger.error('dm:read failed', err);
      ack?.({ error: 'Failed to mark read' });
    }
  });

  // ---------- edit ----------
  socket.on('dm:edit', async (raw: unknown, ack?: (res: unknown) => void) => {
    const ctx = ctxOf(socket);
    try {
      const body = (raw ?? {}) as { messageId?: string; text?: string };
      const text = sanitizeText(body.text, 4000);
      if (!body.messageId || !text) return ack?.({ error: 'Invalid edit' });

      const msg = await Message.findOne({ _id: body.messageId, isDeleted: false });
      if (!msg) return ack?.({ error: 'Message not found' });
      // Ownership + participant check
      if (String(msg.senderId) !== ctx.userId) return ack?.({ error: 'You can only edit your own messages' });
      const conv = await loadAuthorizedConversation(ctx.userId, String(msg.conversationId));
      if (!conv) return ack?.({ error: 'Conversation not found' });

      msg.text = text;
      msg.isEdited = true;
      msg.editedAt = new Date();
      await msg.save();

      if (conv.lastMessage && String(conv.lastMessage.senderId) === ctx.userId) {
        conv.lastMessage.text = text;
        await conv.save();
      }

      const payload = messagePayload(msg);
      for (const p of conv.participants) {
        nsp.to(`user:${String(p)}`).emit('dm:edit', payload);
      }
      ack?.({ ok: true });
    } catch (err) {
      logger.error('dm:edit failed', err);
      ack?.({ error: 'Failed to edit' });
    }
  });

  // ---------- delete ----------
  socket.on('dm:delete', async (raw: unknown, ack?: (res: unknown) => void) => {
    const ctx = ctxOf(socket);
    try {
      const body = (raw ?? {}) as { messageId?: string };
      if (!body.messageId) return ack?.({ error: 'Invalid delete' });

      const msg = await Message.findOne({ _id: body.messageId });
      if (!msg || msg.isDeleted) return ack?.({ error: 'Message not found' });
      if (String(msg.senderId) !== ctx.userId) return ack?.({ error: 'You can only delete your own messages' });
      const conv = await loadAuthorizedConversation(ctx.userId, String(msg.conversationId));
      if (!conv) return ack?.({ error: 'Conversation not found' });

      // Purge attachments too — a deleted message must not leave a live media URL.
      const attached = msg.attachments ?? [];
      msg.isDeleted = true;
      msg.deletedAt = new Date();
      msg.text = '';
      msg.attachments = [];
      await msg.save();
      for (const p of attached) {
        if (p.publicId) void deleteAsset(p.publicId, p.kind === 'audio' ? 'audio' : 'image');
      }

      for (const p of conv.participants) {
        nsp.to(`user:${String(p)}`).emit('dm:delete', {
          messageId: String(msg._id),
          conversationId: String(conv._id),
        });
      }
      ack?.({ ok: true });
    } catch (err) {
      logger.error('dm:delete failed', err);
      ack?.({ error: 'Failed to delete' });
    }
  });

  // ---------- reactions ----------
  socket.on('dm:reaction', async (raw: unknown, ack?: (res: unknown) => void) => {
    const ctx = ctxOf(socket);
    try {
      const body = (raw ?? {}) as { messageId?: string; emoji?: string };
      if (!body.messageId || !body.emoji) return ack?.({ error: 'Invalid reaction' });
      const emoji = String(body.emoji).slice(0, 8);

      const msg = await Message.findOne({ _id: body.messageId, isDeleted: false });
      if (!msg) return ack?.({ error: 'Message not found' });
      const conv = await loadAuthorizedConversation(ctx.userId, String(msg.conversationId));
      if (!conv) return ack?.({ error: 'Conversation not found' });

      const uid = new (Message.base.Types.ObjectId)(ctx.userId);
      const existingIdx = msg.reactions.findIndex(
        (r) => String(r.userId) === ctx.userId && r.emoji === emoji
      );
      let removed = false;
      if (existingIdx >= 0) {
        msg.reactions.splice(existingIdx, 1);
        removed = true;
      } else {
        msg.reactions = msg.reactions.filter((r) => String(r.userId) !== ctx.userId);
        msg.reactions.push({ userId: uid, emoji, at: new Date() });
      }
      await msg.save();

      const payload = messagePayload(msg);
      for (const p of conv.participants) {
        nsp.to(`user:${String(p)}`).emit('dm:reaction', payload);
      }
      ack?.({ ok: true });
    } catch (err) {
      logger.error('dm:reaction failed', err);
      ack?.({ error: 'Failed to react' });
    }
  });
}
