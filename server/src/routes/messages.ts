import { Router } from 'express';
import { z } from 'zod';
import { Message } from '../models/Message.js';
import { Conversation } from '../models/Conversation.js';
import { requireAuth } from '../middleware/auth.js';
import { validate, asyncHandler } from '../middleware/validate.js';
import { ApiError } from '../middleware/errors.js';
import { sanitizeText } from '../utils/text.js';
import { deleteAsset } from '../lib/cloudinary.js';
import type { Request, Response } from 'express';

const router = Router();

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function loadParticipantMessage(userId: string, messageId: string) {
  if (!/^[a-f\d]{24}$/i.test(messageId)) throw new ApiError(400, 'Invalid message id');
  const msg = await Message.findById(messageId);
  if (!msg || msg.isDeleted) throw new ApiError(404, 'Message not found');
  // Participant authorization — prevents access by tampering with IDs.
  const conv = await Conversation.findById(msg.conversationId).lean();
  if (!conv) throw new ApiError(404, 'Conversation not found');
  const isParticipant = conv.participants.some((p) => String(p) === userId);
  if (!isParticipant) throw new ApiError(403, 'Not allowed');
  return { msg, conv };
}

// ---------- SEARCH MESSAGES IN A CONVERSATION ----------
const searchQuery = z.object({
  conversationId: z.string().regex(/^[a-f\d]{24}$/i),
  q: z.string().min(1).max(100),
});

router.get(
  '/search',
  requireAuth,
  validate(searchQuery, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const conversationId = String(req.query.conversationId);
    const conv = await Conversation.findById(conversationId).lean();
    if (!conv) throw new ApiError(404, 'Conversation not found');
    const isParticipant = conv.participants.some((p) => String(p) === req.userId);
    if (!isParticipant) throw new ApiError(403, 'You are not a participant of this conversation');

    const rx = new RegExp(escapeRegex(String(req.query.q).trim()), 'i');
    const messages = await Message.find({ conversationId: conv._id, isDeleted: false, text: rx })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();
    res.json({ messages });
  })
);

// ---------- EDIT (owner only) ----------
const editSchema = z.object({ text: z.string().min(1).max(4000) });

router.patch(
  '/:messageId',
  requireAuth,
  validate(editSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { msg, conv } = await loadParticipantMessage(req.userId!, String(req.params.messageId));
    if (String(msg.senderId) !== req.userId) {
      throw new ApiError(403, 'You can only edit your own messages');
    }

    msg.text = sanitizeText(String(req.body.text), 4000);
    msg.isEdited = true;
    msg.editedAt = new Date();
    await msg.save();

    if (conv.lastMessage && String(conv.lastMessage.senderId) === req.userId) {
      await Conversation.updateOne({ _id: conv._id }, { $set: { 'lastMessage.text': msg.text } });
    }

    res.json({ message: msg });
  })
);

// ---------- DELETE (owner only) ----------
router.delete(
  '/:messageId',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { msg } = await loadParticipantMessage(req.userId!, String(req.params.messageId));
    if (String(msg.senderId) !== req.userId) {
      throw new ApiError(403, 'You can only delete your own messages');
    }

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
    res.json({ ok: true });
  })
);

// ---------- REACTION (either participant) ----------
const reactionSchema = z.object({ emoji: z.string().min(1).max(8) });

router.post(
  '/:messageId/reaction',
  requireAuth,
  validate(reactionSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { msg } = await loadParticipantMessage(req.userId!, String(req.params.messageId));
    const emoji = sanitizeText(String(req.body.emoji), 8);

    const existingIdx = msg.reactions.findIndex(
      (r) => String(r.userId) === req.userId && r.emoji === emoji
    );
    let removed = false;
    if (existingIdx >= 0) {
      msg.reactions.splice(existingIdx, 1);
      removed = true;
    } else {
      msg.reactions = msg.reactions.filter((r) => String(r.userId) !== req.userId);
      msg.reactions.push({ userId: req.userId as never, emoji, at: new Date() });
    }
    await msg.save();
    res.json({ reactions: msg.reactions, removed });
  })
);

export default router;
