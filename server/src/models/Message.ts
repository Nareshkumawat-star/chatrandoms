import mongoose, { Schema } from 'mongoose';

export type AttachmentKind = 'image' | 'audio';

export type Attachment = {
  kind: AttachmentKind;
  url: string;
  publicId?: string;
  name?: string;
  durationMs?: number;
  mime?: string;
};

export interface MessageDoc extends mongoose.Document {
  conversationId: mongoose.Types.ObjectId;
  senderId: mongoose.Types.ObjectId;
  receiverId: mongoose.Types.ObjectId;
  text: string;
  type: 'text' | 'image' | 'voice' | 'system';
  attachments: Attachment[];
  replyTo: mongoose.Types.ObjectId | null;
  reactions: { userId: mongoose.Types.ObjectId; emoji: string; at: Date }[];
  isEdited: boolean;
  editedAt: Date | null;
  isDeleted: boolean;
  deletedAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema = new Schema<MessageDoc>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receiverId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, default: '', maxlength: 4000 },
    type: { type: String, enum: ['text', 'image', 'voice', 'system'], default: 'text' },
    attachments: [
      {
        kind: { type: String, enum: ['image', 'audio'] },
        url: String,
        publicId: String,
        name: String,
        durationMs: Number,
        mime: String,
      },
    ],
    replyTo: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
    reactions: [
      {
        userId: { type: Schema.Types.ObjectId, ref: 'User' },
        emoji: { type: String, maxlength: 16 },
        at: { type: Date, default: Date.now },
      },
    ],
    isEdited: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

MessageSchema.index({ conversationId: 1, createdAt: -1 });
MessageSchema.index({ receiverId: 1, readAt: 1 });

export const Message = mongoose.model<MessageDoc>('Message', MessageSchema);
