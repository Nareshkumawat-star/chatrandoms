import mongoose, { Schema } from 'mongoose';

export interface GlobalMessageDoc extends mongoose.Document {
  senderId: mongoose.Types.ObjectId;
  senderUsername: string;
  senderDisplayName: string;
  senderAvatar: string;
  isAnonymous: boolean;
  text: string;
  kind: 'message' | 'question' | 'challenge';
  reactions: { emoji: string; count: number }[];
  reactors: { userId: mongoose.Types.ObjectId; emoji: string }[];
  replyToId: mongoose.Types.ObjectId | null;
  replySnapshot: { id: string; username: string; text: string } | null;
  mentions: { userId: mongoose.Types.ObjectId; username: string }[];
  expiresAt: Date | null;
  isDeleted: boolean;
  deletedAt: Date | null;
  isEdited: boolean;
  editedAt: Date | null;
  score: number;
  reportCount: number;
  // moderation — set by a report; dismissed by an admin or the reported user's
  // account owner. Public feed is hidden while OPEN.
  moderationStatus: 'none' | 'open' | 'resolved';
  moderationResolvedAt: Date | null;
  // interest tags — route the message into a per-tag lane in the global chat
  tag: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const GlobalMessageSchema = new Schema<GlobalMessageDoc>(
  {
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    senderUsername: { type: String, required: true },
    senderDisplayName: { type: String, required: true },
    senderAvatar: { type: String, default: '' },
    isAnonymous: { type: Boolean, default: false },
    text: { type: String, required: true, maxlength: 1000 },
    kind: { type: String, enum: ['message', 'question', 'challenge'], default: 'message' },
    reactions: [
      { emoji: { type: String, required: true, maxlength: 16 }, count: { type: Number, default: 0 } },
    ],
    reactors: [
      { userId: { type: Schema.Types.ObjectId, ref: 'User' }, emoji: { type: String, maxlength: 16 } },
    ],
    replyToId: { type: Schema.Types.ObjectId, ref: 'GlobalMessage', default: null },
    replySnapshot: {
      id: { type: String },
      username: { type: String },
      text: { type: String, default: '' },
    },
    mentions: [
      { userId: { type: Schema.Types.ObjectId, ref: 'User' }, username: { type: String } },
    ],
    expiresAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    isEdited: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
    score: { type: Number, default: 0 },
    reportCount: { type: Number, default: 0 },
    moderationStatus: { type: String, enum: ['none', 'open', 'resolved'], default: 'none' },
    moderationResolvedAt: { type: Date, default: null },
    tag: { type: String, default: null },
  },
  { timestamps: true, minimize: false }
);

GlobalMessageSchema.index({ createdAt: -1 });
GlobalMessageSchema.index({ 'mentions.userId': 1 });
GlobalMessageSchema.index({ kind: 1, createdAt: -1 });
GlobalMessageSchema.index({ score: -1, createdAt: -1 });
GlobalMessageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// moderation — open messages are excluded from the public feed
GlobalMessageSchema.index({ moderationStatus: 1, createdAt: -1 });

export const GlobalMessage = mongoose.model<GlobalMessageDoc>('GlobalMessage', GlobalMessageSchema);
