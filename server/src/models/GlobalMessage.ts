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
  expiresAt: Date | null; // expiring messages
  isDeleted: boolean;
  deletedAt: Date | null;
  isEdited: boolean;
  editedAt: Date | null;
  score: number; // trending score
  reportCount: number;
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
      {
        emoji: { type: String, required: true, maxlength: 16 },
        count: { type: Number, default: 0 },
      },
    ],
    reactors: [
      {
        userId: { type: Schema.Types.ObjectId, ref: 'User' },
        emoji: { type: String, maxlength: 16 },
      },
    ],
    replyToId: { type: Schema.Types.ObjectId, ref: 'GlobalMessage', default: null },
    replySnapshot: {
      id: { type: String },
      username: { type: String },
      text: { type: String, default: '' },
    },
    mentions: [
      {
        userId: { type: Schema.Types.ObjectId, ref: 'User' },
        username: { type: String },
      },
    ],
    expiresAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    isEdited: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
    score: { type: Number, default: 0 },
    reportCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Cursor-based pagination: query older than cursor.
GlobalMessageSchema.index({ createdAt: -1 });
GlobalMessageSchema.index({ 'mentions.userId': 1 });
GlobalMessageSchema.index({ kind: 1, createdAt: -1 });
GlobalMessageSchema.index({ score: -1, createdAt: -1 });
// TTL index — expiring messages are removed automatically.
GlobalMessageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const GlobalMessage = mongoose.model<GlobalMessageDoc>('GlobalMessage', GlobalMessageSchema);
