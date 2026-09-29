import mongoose, { Schema } from 'mongoose';

// ---------- Reports ----------
export interface ReportDoc extends mongoose.Document {
  reporterId: mongoose.Types.ObjectId;
  targetType: 'message' | 'user' | 'global_message';
  targetId: mongoose.Types.ObjectId;
  reason: string;
  details: string;
  status: 'open' | 'resolved';
  createdAt: Date;
  updatedAt: Date;
}

const ReportSchema = new Schema<ReportDoc>(
  {
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    targetType: { type: String, enum: ['message', 'user', 'global_message'], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    reason: { type: String, required: true, maxlength: 80 },
    details: { type: String, default: '', maxlength: 500 },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
  },
  { timestamps: true }
);

ReportSchema.index({ targetType: 1, targetId: 1, reporterId: 1 }, { unique: true });

export const Report = mongoose.model<ReportDoc>('Report', ReportSchema);

// ---------- Daily Challenge ----------
export interface ChallengeDoc extends mongoose.Document {
  dateKey: string; // YYYY-MM-DD (UTC)
  text: string;
  createdBy: mongoose.Types.ObjectId | null;
  isAuto: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ChallengeSchema = new Schema<ChallengeDoc>(
  {
    dateKey: { type: String, required: true },
    text: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isAuto: { type: Boolean, default: false },
  },
  { timestamps: true }
);

ChallengeSchema.index({ dateKey: 1 }, { unique: true });

export const Challenge = mongoose.model<ChallengeDoc>('Challenge', ChallengeSchema);

const DAILY_CHALLENGES = [
  'Say hi to someone new today 👋',
  'Use only emojis for your next 3 messages 😄',
  'Ask the room an interesting question ❓',
  'Reply to a message you find inspiring 💬',
  'Make someone smile today 😊',
  'Share which country you are from 🌍',
  'Recommend a song to the world 🎵',
  'Teach everyone one small fact today 🧠',
];

export function dailyChallengeText(date = new Date()): string {
  const key = date.toISOString().slice(0, 10);
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 100000;
  return DAILY_CHALLENGES[hash % DAILY_CHALLENGES.length];
}

// ---------- Global Milestones ----------
export interface MilestoneDoc extends mongoose.Document {
  type: 'messages_100' | 'messages_1000' | 'messages_10000' | 'users_100' | 'users_1000' | 'custom';
  value: number;
  label: string;
  celebratedAt: Date;
}

const MilestoneSchema = new Schema<MilestoneDoc>({
  type: { type: String, required: true },
  value: { type: Number, required: true },
  label: { type: String, required: true },
  celebratedAt: { type: Date, default: Date.now },
});

export const Milestone = mongoose.model<MilestoneDoc>('Milestone', MilestoneSchema);
