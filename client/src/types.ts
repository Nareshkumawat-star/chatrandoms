// Shared client-side types matching the API contracts.

export type Role = 'user' | 'guest';

export interface Me {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bio: string;
  isGuest: boolean;
  reputation: number;
  anonymousMode: boolean;
  noiseFilterLevel: number;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bio: string;
  isGuest: boolean;
  reputation: number;
  online: boolean;
  lastSeen: string;
}

export interface SearchResult extends PublicUser {}

export interface ConversationSummary {
  id: string;
  other: {
    id: string;
    username: string;
    displayName: string;
    avatar: string;
    online: boolean;
    lastSeen: string;
    isGuest: boolean;
  } | null;
  lastMessage: { text: string; mine: boolean; at: string } | null;
  lastMessageAt: string | null;
  unread: number;
}

export interface ChatMessage {
  _id: string;
  conversationId: string;
  senderId: string;
  receiverId: string;
  text: string;
  type: 'text' | 'image' | 'system';
  replyTo: string | null;
  reactions: { userId: string; emoji: string; at: string }[];
  isEdited: boolean;
  editedAt: string | null;
  isDeleted: boolean;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GlobalMessage {
  _id: string;
  senderId: string;
  senderUsername: string;
  senderDisplayName: string;
  senderAvatar: string;
  isAnonymous: boolean;
  text: string;
  kind: 'message' | 'question' | 'challenge';
  reactions: { emoji: string; count: number }[];
  reactors: { userId: string; emoji: string }[];
  replyToId: string | null;
  replySnapshot: { id: string; username: string; text: string } | null;
  expiresAt: string | null;
  isEdited: boolean;
  isDeleted: boolean;
  score: number;
  createdAt: string;
}

export interface GlobalMeta {
  onlineCount: number;
  challenge: { dateKey: string; text: string; isAuto: boolean };
  totals: { messages: number; users: number };
  milestone: { label: string; value: number; celebratedAt: string } | null;
  nextMilestone: { target: number; progress: number };
  trending: { id: string; text: string; score: number; kind: string; reactions: { emoji: string; count: number }[] }[];
}

export interface Relationship {
  blockedMe: boolean;
  iBlocked: boolean;
  iMuted: boolean;
}
