import mongoose, { Schema, model } from "mongoose";

export interface AIUserMessagesInput {
  conversationId: string;
  userId: string;
  summaries?: Array<{ text: string; model: string; createdAt: Date }>;
  smartReplies?: Array<{ text: string; model: string; createdAt: Date }>;
  actions?: Array<{ task: string; dueAt: Date | null; model: string; createdAt: Date }>;
}

export interface AIUserMessagesDoc extends mongoose.Document {
  conversationId: string;
  userId: string;
  summaries: Array<{ text: string; model: string; createdAt: Date }>;
  smartReplies: Array<{ text: string; model: string; createdAt: Date }>;
  actions: Array<{ task: string; dueAt: Date | null; model: string; createdAt: Date }>;
  updatedAt: Date;
}

const AIUserMessagesSchema = new Schema<AIUserMessagesDoc>(
  {
    conversationId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    summaries: [
      { text: String, model: String, createdAt: { type: Date, default: Date.now } },
    ],
    smartReplies: [
      { text: String, model: String, createdAt: { type: Date, default: Date.now } },
    ],
    actions: [
      { task: String, dueAt: Date, model: String, createdAt: { type: Date, default: Date.now } },
    ],
  },
  { timestamps: true, minimize: false },
);

AIUserMessagesSchema.index({ conversationId: 1, userId: 1 }, { unique: true });

export const AIUserMessages = model(
  'AIUserMessages',
  AIUserMessagesSchema,
);
