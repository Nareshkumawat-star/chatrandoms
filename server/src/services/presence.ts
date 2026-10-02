import type { Server } from 'socket.io';
import { logger } from '../lib/logger.js';

// userId -> set of active socket ids (multi-tab support)
const online = new Map<string, Set<string>>();
let io: Server | null = null;

export function initPresence(server: Server) {
  io = server;
}

/** Handle for REST routes that need to emit socket events (e.g. mentions). */
export function getIo(): Server | null {
  return io;
}

export function addPresence(userId: string, socketId: string): boolean {
  let set = online.get(userId);
  const wasOnline = Boolean(set && set.size > 0);
  if (!set) {
    set = new Set();
    online.set(userId, set);
  }
  set.add(socketId);
  return !wasOnline; // true if user just came online
}

export function removePresence(userId: string, socketId: string): boolean {
  const set = online.get(userId);
  if (!set) return false;
  set.delete(socketId);
  if (set.size === 0) {
    online.delete(userId);
    return true; // user just went offline
  }
  return false;
}

export function isOnline(userId: string): boolean {
  const set = online.get(userId);
  return Boolean(set && set.size > 0);
}

export function getOnlineCount(): number {
  return online.size;
}

export function getOnlineUserIds(): string[] {
  return [...online.keys()];
}

/** Broadcast presence across both namespaces. */
export function broadcastPresence(userId: string, isOnlineNow: boolean, lastSeen: Date) {
  if (!io) return;
  io.of('/global').emit('global:presence', { onlineCount: getOnlineCount() });
  io.of('/dm').emit('dm:presence', { userId, isOnline: isOnlineNow, lastSeen });
  logger.info(`presence: ${userId} -> ${isOnlineNow ? 'online' : 'offline'} (${getOnlineCount()} online)`);
}
