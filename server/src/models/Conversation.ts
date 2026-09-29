import mongoose, { Schema } from 'mongoose';

export interface ConversationDoc extends mongoose.Document {
  type: 'direct';
  participants: mongoose.Types.ObjectId[];
  directKey: string;
  lastMessage: {
    text: string;
    senderId: mongoose.Types.ObjectId;
    at: Date;
  } | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ConversationSchema = new Schema<ConversationDoc>(
  {
    type: { type: String, enum: ['direct'], default: 'direct' },
    participants: { type: [Schema.Types.ObjectId], required: true, ref: 'User' },
    directKey: { type: String, required: true },
    lastMessage: {
      text: { type: String, default: '' },
      senderId: { type: Schema.Types.ObjectId, ref: 'User' },
      at: { type: Date },
    },
    lastMessageAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One conversation per pair of users — the core of the directKey flow.
ConversationSchema.index({ directKey: 1 }, { unique: true });
ConversationSchema.index({ participants: 1, lastMessageAt: -1 });

export function makeDirectKey(a: mongoose.Types.ObjectId | string, b: mongoose.Types.ObjectId | string): string {
  const as = a.toString();
  const bs = b.toString();
  const [smaller, larger] = as < bs ? [as, bs] : [bs, as];
  return `${smaller}:${larger}`;
}

export const Conversation = mongoose.model<ConversationDoc>('Conversation', ConversationSchema);
