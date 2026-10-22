import { create } from 'zustand';
import type { ConversationSummary } from '../types';

export type Section = 'global' | 'chats' | 'settings';

interface UiState {
  section: Section;
  activeConversationId: string | null;
  /** bump to signal Chats page to open a conversation */
  openRequest: { id: string; other?: ConversationSummary['other']; nonce: number } | null;
  /** unread @mention count per conversation (conversationId -> count) */
  dmMentions: Record<string, number>;
  setSection: (s: Section) => void;
  setActiveConversation: (id: string | null) => void;
  requestOpenConversation: (id: string, other?: ConversationSummary['other']) => void;
  addDmMention: (conversationId: string) => void;
  clearDmMentions: (conversationId: string) => void;
}

export const useUi = create<UiState>((set) => ({
  section: 'global',
  activeConversationId: null,
  openRequest: null,
  dmMentions: {},
  setSection: (section) => set({ section }),
  setActiveConversation: (activeConversationId) => set({ activeConversationId }),
  requestOpenConversation: (id, other) =>
    set((s) => ({
      openRequest: { id, other, nonce: (s.openRequest?.nonce ?? 0) + 1 },
      section: 'chats',
      // Opening the chat clears its @mention badge.
      dmMentions: s.dmMentions[id]
        ? Object.fromEntries(Object.entries(s.dmMentions).filter(([k]) => k !== id))
        : s.dmMentions,
    })),
  addDmMention: (conversationId) =>
    set((s) => ({ dmMentions: { ...s.dmMentions, [conversationId]: (s.dmMentions[conversationId] ?? 0) + 1 } })),
  clearDmMentions: (conversationId) =>
    set((s) => ({
      dmMentions: Object.fromEntries(Object.entries(s.dmMentions).filter(([k]) => k !== conversationId)),
    })),
}));
