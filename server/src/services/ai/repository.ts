import mongoose from "mongoose";
import { AIUserMessages, type AIUserMessagesDoc, type AIUserMessagesInput } from './model.js';

const Collection = mongoose.model<AIUserMessagesDoc>('AIUserMessages') as mongoose.Model<AIUserMessagesDoc>;

export async function upsertUserMessages(input: AIUserMessagesInput): Promise<AIUserMessagesDoc> {
  const doc = new Collection(input);
  return doc.save();
}

export async function getLatestFor(
  conversationId: string,
  userId: string,
  limit = 40,
): Promise<AIUserMessagesDoc | null> {
  return Collection
    .findOne({ conversationId, userId })
    .sort({ updatedAt: -1 })
    .lean<AIUserMessagesDoc | null>()
    .exec();
}

export async function clearForConversation(conversationId: string): Promise<void> {
  await Collection.deleteMany({ conversationId }).exec();
}
