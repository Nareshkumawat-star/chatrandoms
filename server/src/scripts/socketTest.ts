/**
 * Live realtime test against the RUNNING dev server (:4000).
 * Verifies: REST auth via cookies on sockets, /global broadcast,
 * /dm delivery only to the recipient, typing + read receipts.
 *
 * Run: cd server && npx tsx src/scripts/socketTest.ts
 */
import { io, type Socket } from 'socket.io-client';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4000';

// 1×1 PNG — valid, tiny, and shaped exactly like what the composer uploads.
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// 0.1s of 8kHz mono silence as a real WAV — shaped like a voice note payload.
function tinyWav(): string {
  const sampleRate = 8000;
  const samples = 800;
  const dataBytes = samples * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  return 'data:audio/wav;base64,' + buf.toString('base64');
}

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

  // --- photo attachment: sent without text, typed as image, preview labeled ---
  const photoPromise = waitEvent<any>(db_, 'dm:new');
  da.emit(
    'dm:send',
    { conversationId: convId, text: '', image: { dataUrl: TINY_PNG, name: 'sunset.png' } },
    (res: any) => {
      if (res?.error) throw new Error('dm:send image error: ' + res.error);
    }
  );
  const photoMsg = await photoPromise;
  assert(photoMsg.type === 'image', 'image-only message is typed as image');
  assert(Boolean(photoMsg.attachments?.[0]?.url), 'photo attachment survives the round trip');
  assert(photoMsg.text === '', 'image-only message carries no text');

  const list = await a.call('GET', '/chats');
  const preview = (list.json.items ?? []).find((i: any) => i.id === convId);
  assert(preview?.lastMessage?.text === '📷 Photo', 'conversation list previews photos as 📷 Photo');

  const history = await a.call('GET', `/chats/${convId}/messages?limit=50`);
  const fromHistory = (history.json.messages ?? []).find((m: any) => String(m._id) === String(photoMsg._id));
  assert(Boolean(fromHistory?.attachments?.[0]?.url), 'photo attachment served by message history');

  // --- image payload validation ---
  const bad = await new Promise<any>((resolve) => {
    da.emit('dm:send', { conversationId: convId, image: { dataUrl: 'https://evil.example/x.png' } }, resolve);
  });
  assert(Boolean(bad?.error), 'rejects image payloads that are not data URLs');

  // --- deleting a photo clears the attachment ---
  const delPromise = waitEvent<any>(db_, 'dm:delete');
  da.emit('dm:delete', { messageId: photoMsg._id });
  await delPromise;
  const afterDel = await a.call('GET', `/chats/${convId}/messages?limit=50`);
  const deleted = (afterDel.json.messages ?? []).find((m: any) => String(m._id) === String(photoMsg._id));
  assert(
    Boolean(deleted?.isDeleted) && (deleted?.attachments ?? []).length === 0,
    'deleted photo clears its attachment'
  );

  // --- voice message: typed as voice, carries duration, labeled in previews ---
  const TINY_WAV = tinyWav();
  const voicePromise = waitEvent<any>(db_, 'dm:new');
  da.emit(
    'dm:send',
    {
      conversationId: convId,
      text: '',
      voice: { dataUrl: TINY_WAV, name: 'Voice message', durationMs: 4200, mime: 'audio/wav' },
    },
    (res: any) => {
      if (res?.error) throw new Error('dm:send voice error: ' + res.error);
    }
  );
  const voiceMsg = await voicePromise;
  assert(voiceMsg.type === 'voice', 'voice-only message is typed as voice');
  assert(voiceMsg.attachments?.[0]?.kind === 'audio', 'voice attachment kind is audio');
  assert(voiceMsg.attachments?.[0]?.durationMs === 4200, 'voice duration is stored');
  assert(Boolean(voiceMsg.attachments?.[0]?.url), 'voice attachment survives the round trip');

  const voiceList = await a.call('GET', '/chats');
  const voicePreview = (voiceList.json.items ?? []).find((i: any) => i.id === convId);
  assert(
    voicePreview?.lastMessage?.text === '🎤 Voice message',
    'conversation list previews voice notes as 🎤 Voice message'
  );

  const voiceHistory = await a.call('GET', `/chats/${convId}/messages?limit=50`);
  const fromVoiceHistory = (voiceHistory.json.messages ?? []).find(
    (m: any) => String(m._id) === String(voiceMsg._id)
  );
  assert(
    fromVoiceHistory?.attachments?.[0]?.kind === 'audio',
    'voice attachment served by message history'
  );

  // --- payload validation ---
  const both = await new Promise<any>((resolve) => {
    da.emit(
      'dm:send',
      {
        conversationId: convId,
        image: { dataUrl: TINY_PNG },
        voice: { dataUrl: TINY_WAV },
      },
      resolve
    );
  });
  assert(Boolean(both?.error), 'rejects photo + voice in the same message');

  const badVoice = await new Promise<any>((resolve) => {
    da.emit('dm:send', { conversationId: convId, voice: { dataUrl: 'data:text/plain;base64,aGk=' } }, resolve);
  });
  assert(Boolean(badVoice?.error), 'rejects voice payloads that are not audio');

  // --- deleting a voice note clears the attachment ---
  const voiceDelPromise = waitEvent<any>(db_, 'dm:delete');
  da.emit('dm:delete', { messageId: voiceMsg._id });
  await voiceDelPromise;
  const afterVoiceDel = await a.call('GET', `/chats/${convId}/messages?limit=50`);
  const deletedVoice = (afterVoiceDel.json.messages ?? []).find(
    (m: any) => String(m._id) === String(voiceMsg._id)
  );
  assert(
    Boolean(deletedVoice?.isDeleted) && (deletedVoice?.attachments ?? []).length === 0,
    'deleted voice note clears its attachment'
  );

  console.log(results.join('\n'));
  console.log('\n✅ LIVE SOCKET TESTS PASSED');
  [ga, gb, da, db_].forEach((s) => s.disconnect());
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ SOCKET TEST FAILED:', err.message);
  process.exit(1);
});
