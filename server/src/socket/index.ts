import { Server, type Socket } from 'socket.io';
import { verifyAccessToken } from '../lib/auth.js';
import { config } from '../config/env.js';
import { initPresence, addPresence, removePresence, broadcastPresence } from '../services/presence.js';
import { User } from '../models/User.js';
import { logger } from '../lib/logger.js';
import { registerGlobalHandlers } from './globalSocket.js';
import { registerDmHandlers } from './dmSocket.js';

type TokenPayload = { sub: string; username: string; role: 'user' | 'guest' };

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const parts = header.split(';');
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(p.slice(idx + 1).trim());
  }
  return null;
}

export function authenticateSocket(socket: Socket): TokenPayload | null {
  const auth = socket.handshake.auth as { token?: string } | undefined;
  const cookieToken = parseCookie(socket.handshake.headers.cookie, config.jwt.cookieName);
  const token = auth?.token || cookieToken;
  if (!token) return null;
  return verifyAccessToken(token);
}

export async function attachUser(socket: Socket, payload: TokenPayload) {
  socket.data.userId = payload.sub;
  socket.data.username = payload.username;
  socket.data.role = payload.role;
  if (payload.role !== 'guest') {
    await User.updateOne({ _id: payload.sub }, { $set: { isOnline: true } });
  }
}

export function initSockets(io: Server) {
  initPresence(io);

  const globalNsp = io.of('/global');
  const dmNsp = io.of('/dm');

  // ---------------- GLOBAL NAMESPACE ----------------
  globalNsp.use((socket, next) => {
    const payload = authenticateSocket(socket);
    if (!payload) return next(new Error('Authentication required'));
    (socket as Socket & { data: Record<string, unknown> }).data.payload = payload;
    next();
  });

  globalNsp.on('connection', async (socket) => {
    const payload = (socket.data as { payload: TokenPayload }).payload;
    await attachUser(socket, payload);
    const becameOnline = addPresence(payload.sub, socket.id);
    if (becameOnline) {
      broadcastPresence(payload.sub, true, new Date());
    }

    socket.join('global-chat'); // the ONE worldwide room
    socket.join(`user:${payload.sub}`); // personal room (mentions / targeted events)

    registerGlobalHandlers(io, socket);

    socket.on('disconnect', async () => {
      const wentOffline = removePresence(payload.sub, socket.id);
      if (wentOffline) {
        if (payload.role !== 'guest') {
          await User.updateOne(
            { _id: payload.sub },
            { $set: { isOnline: false, lastSeen: new Date() } }
          );
        }
        broadcastPresence(payload.sub, false, new Date());
      }
    });
  });

  // ---------------- DM NAMESPACE ----------------
  dmNsp.use((socket, next) => {
    const payload = authenticateSocket(socket);
    if (!payload) return next(new Error('Authentication required'));
    (socket as Socket & { data: Record<string, unknown> }).data.payload = payload;
    next();
  });

  dmNsp.on('connection', async (socket) => {
    const payload = (socket.data as { payload: TokenPayload }).payload;
    await attachUser(socket, payload);
    const becameOnline = addPresence(payload.sub, socket.id);
    if (becameOnline) {
      broadcastPresence(payload.sub, true, new Date());
      // Deliver pending unread summary when coming online
      try {
        const unread = await (await import('../services/unread.js')).getUnreadCounts(payload.sub);
        socket.emit('dm:unread', unread);
      } catch (err) {
        logger.warn('unread bootstrap failed', err);
      }
    }

    socket.join(`user:${payload.sub}`); // personal delivery room

    registerDmHandlers(io, socket);

    socket.on('disconnect', async () => {
      const wentOffline = removePresence(payload.sub, socket.id);
      if (wentOffline) {
        if (payload.role !== 'guest') {
          await User.updateOne(
            { _id: payload.sub },
            { $set: { isOnline: false, lastSeen: new Date() } }
          );
        }
        broadcastPresence(payload.sub, false, new Date());
      }
    });
  });

  logger.info('Socket.IO namespaces ready: /global, /dm');
}
