import { create } from 'zustand';

export type Section = 'global' | 'chats' | 'settings';

interface UiState {
  section: Section;
  activeConversationId: string | null;
  /** bump to signal Chats page to open a conversation */
  openRequest: { id: string; nonce: number } | null;
  setSection: (s: Section) => void;
  setActiveConversation: (id: string | null) => void;
  requestOpenConversation: (id: string) => void;
}

export const useUi = create<UiState>((set) => ({
  section: 'global',
  activeConversationId: null,
  openRequest: null,
  setSection: (section) => set({ section }),
  setActiveConversation: (activeConversationId) => set({ activeConversationId }),
  requestOpenConversation: (id) =>
    set((s) => ({ openRequest: { id, nonce: (s.openRequest?.nonce ?? 0) + 1 }, section: 'chats' })),
}));
