import { io, type Socket } from 'socket.io-client';

// Same-origin sockets (Vite dev proxy handles /socket.io in development).
let globalSocket: Socket | null = null;
let dmSocket: Socket | null = null;

export function getGlobalSocket(): Socket {
  if (!globalSocket) {
    globalSocket = io('/global', {
      withCredentials: true,
      autoConnect: false,
      transports: ['websocket', 'polling'],
    });
  }
  return globalSocket;
}

export function getDmSocket(): Socket {
  if (!dmSocket) {
    dmSocket = io('/dm', {
      withCredentials: true,
      autoConnect: false,
      transports: ['websocket', 'polling'],
    });
  }
  return dmSocket;
}

export function disconnectAll() {
  globalSocket?.disconnect();
  globalSocket = null;
  dmSocket?.disconnect();
  dmSocket = null;
}
