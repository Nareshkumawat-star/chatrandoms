import { create } from 'zustand';
import { api } from '../lib/api';
import { disconnectAll, setSocketToken } from '../lib/socket';
import type { Me, Role } from '../types';

interface AuthState {
  me: Me | null;
  role: Role | null;
  token: string | null;
  initialized: boolean;
  setMe: (me: Me | null, token?: string | null, refreshToken?: string | null) => void;
  initialize: () => Promise<Me | null>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  me: null,
  role: null,
  token: localStorage.getItem('pulsechat_token'),
  initialized: false,

  setMe: (me, token, refreshToken) => {
    // Sockets authenticate once, at handshake time. If the account changed
    // (guest → registered, or a different user), any live connection still
    // carries the OLD identity and the server will reject its sends — drop
    // them so AppLayout reconnects with the fresh credentials.
    const prev = get().me;
    const identityChanged = Boolean(prev && me && (prev.id !== me.id || prev.isGuest !== me.isGuest));
    if (token) {
      localStorage.setItem('pulsechat_token', token);
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
    if (refreshToken) {
      localStorage.setItem('pulsechat_refresh', refreshToken);
    }
    if (me === null) {
      localStorage.removeItem('pulsechat_token');
      localStorage.removeItem('pulsechat_refresh');
      delete api.defaults.headers.common['Authorization'];
    }
    set({
      me,
      role: me ? (me.isGuest ? 'guest' : 'user') : null,
      token: token !== undefined ? token : get().token,
      initialized: true,
    });
    if (me === null || identityChanged) disconnectAll();
    else if (token) setSocketToken(token);
  },

  initialize: async () => {
    try {
      const storedToken = localStorage.getItem('pulsechat_token');
      if (storedToken) {
        api.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
      }
      const { data } = await api.get('/auth/me');
      const me = (data as { me: Me }).me;
      set({
        me,
        role: me.isGuest ? 'guest' : 'user',
        token: storedToken,
        initialized: true,
      });
      return me;
    } catch {
      // If /auth/me failed with stored access token or cookie, attempt refresh
      const refreshToken = localStorage.getItem('pulsechat_refresh');
      if (refreshToken) {
        try {
          const { data } = await api.post('/auth/refresh', { refreshToken });
          const newAccess = data.accessToken;
          const newRefresh = data.refreshToken;
          if (newAccess) {
            localStorage.setItem('pulsechat_token', newAccess);
            if (newRefresh) localStorage.setItem('pulsechat_refresh', newRefresh);
            api.defaults.headers.common['Authorization'] = `Bearer ${newAccess}`;
            const meRes = await api.get('/auth/me');
            const me = (meRes.data as { me: Me }).me;
            set({
              me,
              role: me.isGuest ? 'guest' : 'user',
              token: newAccess,
              initialized: true,
            });
            return me;
          }
        } catch {
          // refresh failed
        }
      }
      localStorage.removeItem('pulsechat_token');
      localStorage.removeItem('pulsechat_refresh');
      delete api.defaults.headers.common['Authorization'];
      set({ me: null, role: null, token: null, initialized: true });
      return null;
    }
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore
    } finally {
      localStorage.removeItem('pulsechat_token');
      localStorage.removeItem('pulsechat_refresh');
      delete api.defaults.headers.common['Authorization'];
      disconnectAll();
      set({ me: null, role: null, token: null, initialized: true });
    }
  },
}));
