import mongoose, { Schema } from 'mongoose';

export interface UserDoc extends mongoose.Document {
  username: string;
  usernameLower: string;
  displayName: string;
  email: string;
  passwordHash: string | null;
  avatar: string;
  bio: string;
  isGuest: boolean;
  isOnline: boolean;
  lastSeen: Date;
  reputation: number;
  anonymousMode: boolean;
  blockedUserIds: mongoose.Types.ObjectId[];
  mutedUserIds: mongoose.Types.ObjectId[];
  noiseFilterLevel: number; // 0..3 — hides messages from low-reputation users
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<UserDoc>(
  {
    username: { type: String, required: true, trim: true },
    usernameLower: { type: String, required: true },
    displayName: { type: String, required: true, trim: true, maxlength: 50 },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: null },
    avatar: { type: String, default: '' },
    bio: { type: String, default: '', maxlength: 200 },
    isGuest: { type: Boolean, default: false },
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    reputation: { type: Number, default: 0 },
    anonymousMode: { type: Boolean, default: false },
    blockedUserIds: { type: [Schema.Types.ObjectId], default: [], ref: 'User' },
    mutedUserIds: { type: [Schema.Types.ObjectId], default: [], ref: 'User' },
    noiseFilterLevel: { type: Number, default: 0, min: 0, max: 3 },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret.passwordHash;
        delete ret.email;
        delete ret.__v;
        return ret;
      },
    },
  }
);

UserSchema.index({ usernameLower: 1 }, { unique: true });
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ isOnline: 1, reputation: -1 });

export const User = mongoose.model<UserDoc>('User', UserSchema);
