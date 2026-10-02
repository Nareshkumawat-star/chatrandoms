import { create } from 'zustand';
import type { ConversationSummary } from '../types';

export type Section = 'global' | 'chats' | 'settings';

interface UiState {
  section: Section;
  activeConversationId: string | null;
  /** bump to signal Chats page to open a conversation */
  openRequest: { id: string; other?: ConversationSummary['other']; nonce: number } | null;
  setSection: (s: Section) => void;
  setActiveConversation: (id: string | null) => void;
  requestOpenConversation: (id: string, other?: ConversationSummary['other']) => void;
}

export const useUi = create<UiState>((set) => ({
  section: 'global',
  activeConversationId: null,
  openRequest: null,
  setSection: (section) => set({ section }),
  setActiveConversation: (activeConversationId) => set({ activeConversationId }),
  requestOpenConversation: (id, other) =>
    set((s) => ({ openRequest: { id, other, nonce: (s.openRequest?.nonce ?? 0) + 1 }, section: 'chats' })),
}));
