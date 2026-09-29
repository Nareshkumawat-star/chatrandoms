import mongoose from 'mongoose';
import { Message } from '../models/Message.js';

/** unread counts per conversation for a user */
export async function getUnreadCounts(userId: string): Promise<Record<string, number>> {
  const rows = await Message.aggregate([
    { $match: { receiverId: new mongoose.Types.ObjectId(userId), readAt: null, isDeleted: false } },
    { $group: { _id: '$conversationId', count: { $sum: 1 } } },
  ]);
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r._id)] = r.count;
  return out;
}

export async function totalUnread(userId: string): Promise<number> {
  return Message.countDocuments({
    receiverId: userId,
    readAt: null,
    isDeleted: false,
  });
}
