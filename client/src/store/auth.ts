import { create } from 'zustand';
import type { Me, Role } from '../types';

interface AuthState {
  me: Me | null;
  role: Role | null;
  setMe: (me: Me | null) => void;
}

export const useAuth = create<AuthState>((set) => ({
  me: null,
  role: null,
  setMe: (me) => set({ me, role: me ? (me.isGuest ? 'guest' : 'user') : null }),
}));
