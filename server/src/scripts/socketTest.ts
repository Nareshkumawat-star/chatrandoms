/**
 * Live realtime test against the RUNNING dev server (:4000).
 * Verifies: REST auth via cookies on sockets, /global broadcast,
 * /dm delivery only to the recipient, typing + read receipts.
 *
 * Run: cd server && npx tsx src/scripts/socketTest.ts
 */
import { io, type Socket } from 'socket.io-client';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4000';

function cookieJar() {
  let cookie = '';
  return {
    async call(method: string, path: string, body?: unknown) {
      const res = await fetch(BASE + '/api' + path, {
        method,
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      const json = await res.json().catch(() => null);
      return { status: res.status, json };
    },
    get cookie() {
      return cookie;
    },
  };
}

function waitEvent<T = unknown>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

function connect(url: string, cookie: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(url, {
      extraHeaders: { cookie }, // pass auth cookie to socket handshake
      transports: ['websocket', 'polling'],
    });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(e));
  });
}

async function main() {
  const results: string[] = [];
  const assert = (cond: boolean, label: string) => {
    if (!cond) throw new Error(`FAIL: ${label}`);
    results.push(`  ✓ ${label}`);
  };

  // --- register two users over REST (cookies kept per-jar) ---
  const a = cookieJar();
  const b = cookieJar();
  await a.call('POST', '/auth/register', { username: 'socka', displayName: 'Sock A', email: 'a@sock.test', password: 'password123' });
  await b.call('POST', '/auth/register', { username: 'sockb', displayName: 'Sock B', email: 'b@sock.test', password: 'password123' });

  // --- create direct conversation A <-> B ---
  const conv = await a.call('POST', '/chats/direct', { username: 'sockb' });
  const convId = conv.json.conversation.id;

  // --- connect sockets with their auth cookies ---
  const ga = await connect(`${BASE}/global`, a.cookie);
  const gb = await connect(`${BASE}/global`, b.cookie);
  const da = await connect(`${BASE}/dm`, a.cookie);
  const db_ = await connect(`${BASE}/dm`, b.cookie);
  assert(ga.connected && gb.connected && da.connected && db_.connected, 'sockets connect with cookie auth');

  // --- GLOBAL: A sends, both receive on /global ---
  const gPromise = waitEvent<any>(gb, 'global:message');
  ga.emit('global:send', { text: 'Hello world from A! 🌍' }, (res: any) => {
    if (res?.error) throw new Error('global:send error: ' + res.error);
  });
  const gmsg = await gPromise;
  assert(gmsg.text === 'Hello world from A! 🌍' && gmsg.senderUsername === 'socka', 'global message broadcast to /global');

  // --- DM: A sends; only B receives dm:new, nothing on /global ---
  let leaked = false;
  gb.on('global:message', (m: any) => {
    if (m.text === 'SECRET-DM-PING') leaked = true;
  });
  const dmPromise = waitEvent<any>(db_, 'dm:new');
  da.emit('dm:send', { conversationId: convId, text: 'SECRET-DM-PING' }, (res: any) => {
    if (res?.error) throw new Error('dm:send error: ' + res.error);
  });
  const dm = await dmPromise;
  assert(dm.text === 'SECRET-DM-PING' && String(dm.conversationId) === convId, 'private message delivered to recipient via /dm');
  await new Promise((r) => setTimeout(r, 400));
  assert(!leaked, 'private message NEVER appeared on /global namespace');

  // --- typing indicator ---
  const typingPromise = waitEvent<any>(db_, 'dm:typing');
  da.emit('dm:typing', { conversationId: convId });
  const tp = await typingPromise;
  assert(tp.conversationId === convId, 'dm:typing reaches the other participant');

  // --- read receipt ---
  const readPromise = waitEvent<any>(da, 'dm:read');
  db_.emit('dm:read', { conversationId: convId });
  const rd = await readPromise;
  assert(rd.conversationId === convId, 'dm:read receipt reaches sender');

  // --- reaction ---
  const reactPromise = waitEvent<any>(db_, 'dm:reaction');
  da.emit('dm:reaction', { messageId: dm._id ?? dm.id, emoji: '❤️' });
  const rc = await reactPromise;
  assert((rc.reactions ?? []).some((r: any) => r.emoji === '❤️'), 'dm:reaction updates recipient');

  console.log(results.join('\n'));
  console.log('\n✅ LIVE SOCKET TESTS PASSED');
  [ga, gb, da, db_].forEach((s) => s.disconnect());
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ SOCKET TEST FAILED:', err.message);
  process.exit(1);
});
