import { io, type Socket } from 'socket.io-client';

// Same-origin sockets (Vite dev proxy handles /socket.io in development).
let globalSocket: Socket | null = null;
let dmSocket: Socket | null = null;

export function getGlobalSocket(): Socket {
  const token = localStorage.getItem('pulsechat_token');
  if (!globalSocket) {
    globalSocket = io('/global', {
      withCredentials: true,
      autoConnect: false,
      auth: token ? { token } : undefined,
      transports: ['websocket', 'polling'],
    });
  } else if (token) {
    globalSocket.auth = { token };
  }
  return globalSocket;
}

export function getDmSocket(): Socket {
  const token = localStorage.getItem('pulsechat_token');
  if (!dmSocket) {
    dmSocket = io('/dm', {
      withCredentials: true,
      autoConnect: false,
      auth: token ? { token } : undefined,
      transports: ['websocket', 'polling'],
    });
  } else if (token) {
    dmSocket.auth = { token };
  }
  return dmSocket;
}

// Keep live connections' handshake auth in sync after a token refresh, so
// the next reconnect uses the current session instead of a stale one.
export function setSocketToken(token: string) {
  if (globalSocket) globalSocket.auth = { token };
  if (dmSocket) dmSocket.auth = { token };
}

export function disconnectAll() {
  globalSocket?.disconnect();
  globalSocket = null;
  dmSocket?.disconnect();
  dmSocket = null;
}
