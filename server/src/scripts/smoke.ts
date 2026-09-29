/**
 * End-to-end smoke test (dev only).
 * Boots an in-memory MongoDB + the real app, then exercises the core flows:
 * auth → search → directKey conversation → DMs → global chat → security checks.
 *
 * Run: cd server && npx tsx src/scripts/smoke.ts
 */
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

async function main() {
  console.log('● starting in-memory mongodb…');
  const mongod = await MongoMemoryServer.create({ instance: { port: 0, ip: '127.0.0.1' } });
  const uri = mongod.getUri('pulse-chat');

  process.env.MONGODB_URI = uri;
  process.env.PORT = '4399';
  process.env.NODE_ENV = 'development';
  process.env.CLIENT_ORIGIN = 'http://localhost:5173';

  // connect mongoose first (app connects too; both fine on same instance)
  const mongoose = (await import('mongoose')).default;

  // import app AFTER env vars set
  await import('../index.js');

  // wait for server listen
  await new Promise((r) => setTimeout(r, 1500));

  const base = 'http://127.0.0.1:4399/api';

  const jar = () => {
    let cookie = '';
    return {
      async call(method: string, path: string, body?: unknown) {
        const res = await fetch(base + path, {
          method,
          headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
        const setCookie = res.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        let json: any = null;
        try {
          json = await res.json();
        } catch {
          /* no body */
        }
        return { status: res.status, json };
      },
    };
  };

  const assert = (cond: boolean, label: string) => {
    if (!cond) throw new Error(`FAIL: ${label}`);
    console.log(`  ✓ ${label}`);
  };

  // ---------- health ----------
  {
    const res = await fetch('http://127.0.0.1:4399/api/health');
    const j = await res.json();
    assert(res.status === 200 && j.ok, 'health endpoint');
  }

  // ---------- register two users ----------
  const a = jar();
  const b = jar();
  const regA = await a.call('POST', '/auth/register', {
    username: 'nareshk',
    displayName: 'Naresh Kumawat',
    email: 'naresh@mail.com',
    password: 'password123',
  });
  assert(regA.status === 201 && regA.json.me.username === 'nareshk', 'register user A (@nareshk)');

  const regB = await b.call('POST', '/auth/register', {
    username: 'rahulsharma',
    displayName: 'Rahul Sharma',
    email: 'rahul@mail.com',
    password: 'password123',
  });
  assert(regB.status === 201, 'register user B (@rahulsharma)');

  // duplicate username rejected
  const dup = await jar().call('POST', '/auth/register', {
    username: 'nareshk',
    displayName: 'Impostor',
    email: 'x@mail.com',
    password: 'password123',
  });
  assert(dup.status === 409, 'duplicate username rejected (409)');

  // ---------- user search ----------
  const searchExact = await a.call('GET', '/users/search?q=nareshk');
  assert(searchExact.status === 200 && searchExact.json.results[0]?.username === 'nareshk', 'exact username search first');
  assert(searchExact.json.meta.exactMatch === true, 'exactMatch flag');

  const search = await a.call('GET', '/users/search?q=naresh');
  assert(search.status === 200 && search.json.results[0]?.username === 'nareshk', 'partial username search finds nareshk');

  const partial = await a.call('GET', '/users/search?q=rahul');
  assert(partial.json.results.some((u: any) => u.username === 'rahulsharma'), 'partial username search');
  assert(!('email' in search.json.results[0]) && !('passwordHash' in search.json.results[0]), 'search leaks no email/password');

  // ---------- directKey flow ----------
  const d1 = await a.call('POST', '/chats/direct', { username: 'rahulsharma' });
  assert(d1.status === 200 && d1.json.conversation.id, 'A starts direct chat with B');
  const convId = d1.json.conversation.id;

  const d2 = await b.call('POST', '/chats/direct', { username: 'nareshk' });
  assert(d2.json.conversation.id === convId, 'B opens SAME conversation (directKey dedupe)');

  const d3 = await a.call('POST', '/chats/direct', { username: 'rahulsharma' });
  assert(d3.json.conversation.id === convId, 'A re-opens next day → same conversation');

  // ---------- send DM via REST ----------
  const dm1 = await a.call('POST', `/chats/${convId}/messages`, { text: 'Hey Rahul! Are you coming?' });
  assert(dm1.status === 201 && dm1.json.message.text === 'Hey Rahul! Are you coming?', 'A sends DM');

  const dm2 = await b.call('POST', `/chats/${convId}/messages`, { text: 'Okay bro' });
  assert(dm2.status === 201, 'B replies');

  // ---------- security: C cannot access A/B conversation ----------
  const regC = await jar().call('POST', '/auth/register', {
    username: 'eve',
    displayName: 'Eve Dropper',
    email: 'eve@mail.com',
    password: 'password123',
  });
  assert(regC.status === 201, 'register user C (attacker)');
  const c = jar();
  await c.call('POST', '/auth/login', { identifier: 'eve', password: 'password123' });

  const sneak = await c.call('GET', `/chats/${convId}/messages`);
  assert(sneak.status === 403, 'C cannot read A/B conversation by ID tampering (403)');

  const forge = await c.call('POST', `/chats/${convId}/messages`, { text: 'injected' });
  assert(forge.status === 403, 'C cannot post into A/B conversation (403)');

  // ---------- unread counts ----------
  const chatsA = await a.call('GET', '/chats');
  const convA = chatsA.json.items.find((i: any) => i.id === convId);
  assert(chatsA.json.items.length === 1, 'chat list has exactly 1 conversation');
  assert(convA.unread >= 1, `unread count present (${convA.unread})`);

  // ---------- global chat ----------
  const g1 = await a.call('POST', '/global/messages', { text: 'Hello everyone! 🌍' });
  assert(g1.status === 201, 'A posts to global chat');

  const g2 = await b.call('POST', '/global/messages', { text: 'Anyone here from Delhi?', kind: 'question' });
  assert(g2.status === 201 && g2.json.message.kind === 'question', 'B posts question-mode message');

  const feed = await c.call('GET', '/global/messages');
  assert(feed.status === 200 && feed.json.messages.length === 2, 'global feed returns 2 messages');
  assert(
    feed.json.messages.every((m: any) => m.conversationId === undefined),
    'global messages carry no conversationId (data separation)'
  );

  const meta = await a.call('GET', '/global/meta');
  assert(meta.status === 200 && meta.json.onlineCount >= 0 && meta.json.challenge.text, 'global meta (challenge, online count)');

  // reaction on global message
  const react = await b.call('POST', `/global/messages/${g1.json.message._id}/report`, { reason: 'test' });
  void react;
  const edit = await a.call('PATCH', `/api/messages/invalidid`.replace('/api', ''), { text: 'x' });
  void edit;

  // message ownership: B cannot edit A's message
  const msgId = dm1.json.message._id ?? dm1.json.message._id;
  const editAttempt = await b.call('PATCH', `/messages/${msgId}`, { text: 'hacked' });
  assert(editAttempt.status === 403, 'B cannot edit A\'s private message (403)');

  // guest flow
  const gJ = jar();
  const guest = await gJ.call('POST', '/auth/guest');
  assert(guest.status === 201 && guest.json.me.isGuest, 'guest session created');
  const guestDm = await gJ.call('POST', '/chats/direct', { username: 'nareshk' });
  assert(guestDm.status === 403, 'guest blocked from starting private chats (403)');
  const guestGlobal = await gJ.call('POST', '/global/messages', { text: 'guest hello' });
  assert(guestGlobal.status === 201, 'guest can post in global chat');

  // block flow: A blocks C, C cannot DM A
  const meC = await c.call('GET', '/auth/me');
  await a.call('POST', `/users/${meC.json.me.id}/block`);
  const dC = await c.call('POST', '/chats/direct', { username: 'nareshk' });
  assert(dC.status === 403, 'blocked user cannot start conversation with A');

  console.log('\n✅ ALL SMOKE TESTS PASSED');

  await mongoose.disconnect();
  await mongod.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ SMOKE TEST FAILED:', err.message);
  process.exit(1);
});
