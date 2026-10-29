/**
 * Persistence test (dev only).
 *
 * Proves the thing that used to break: an account created at sign-up, and the
 * chats saved under it, are still there after the SERVER RESTARTS — so signing
 * in with the same email/username works instead of answering "incorrect".
 *
 * It boots a real mongod on disk, runs the real API in a child process,
 * registers two accounts and sends a direct message, kills the server, starts a
 * fresh instance against the same database, then signs in again and re-reads
 * the conversation.
 *
 * Run: cd server && npx tsx src/scripts/restartTest.ts   (or: npm run test:restart)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const PASSWORD_A = 'survive-me-123';
const PASSWORD_B = 'survive-me-456';
const EMAIL_A = 'Restart.A@Example.com'; // mixed case on purpose
const EMAIL_B = 'restart.b@example.com';
const MESSAGE = 'still here after the restart 🚀 #persistence';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function assert(cond: unknown, label: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${label}`);
  console.log(`  ✓ ${label}`);
}

function step(label: string) {
  console.log(`● ${label}`);
}

function ok(label: string) {
  console.log(`  ✓ ${label}`);
}

/** Ask the OS for a free TCP port (bind 0, read it back, release). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

function portOpen(port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    const done = (open: boolean) => {
      sock.destroy();
      resolve(open);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

async function waitForPort(port: number, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(port)) return;
    await sleep(100);
  }
  throw new Error(`${what} did not start listening on 127.0.0.1:${port} within ${timeoutMs}ms`);
}

async function waitForPortClosed(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await portOpen(port))) return;
    await sleep(100);
  }
  throw new Error(`port ${port} stayed open after the server was stopped`);
}

/** Real mongod, on disk, so the database outlives the API process. */
async function startMongod(dbPath: string, port: number): Promise<ChildProcess> {
  const { MongoBinary } = await import('mongodb-memory-server');
  const binaryPath = await MongoBinary.getPath({});
  const child = spawn(
    binaryPath,
    ['--dbpath', dbPath, '--port', String(port), '--bind_ip', '127.0.0.1'],
    { stdio: 'ignore' }
  );
  child.on('error', () => undefined);
  await waitForPort(port, 20_000, 'mongod');
  return child;
}

type Server = { child: ChildProcess; logs: string[] };

function startServer(port: number, mongoUri: string): Server {
  const child = spawn(process.execPath, [require.resolve('tsx/cli'), 'src/index.ts'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      PORT: String(port),
      MONGODB_URI: mongoUri,
      NODE_ENV: 'development',
      // No bundled/fallback database: the test's on-disk mongod must be used,
      // otherwise this test could pass against an in-memory DB and prove nothing.
      DEV_MONGO_DISABLE: '1',
      JWT_ACCESS_SECRET: 'restart-test-access-secret',
      JWT_REFRESH_SECRET: 'restart-test-refresh-secret',
      CLIENT_ORIGIN: 'http://localhost:5173',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs: string[] = [];
  const capture = (buf: Buffer) => {
    for (const line of buf.toString().split(/\r?\n/)) {
      if (line.trim()) logs.push(line.trim());
    }
    if (logs.length > 80) logs.splice(0, logs.length - 80);
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  return { child, logs };
}

async function stopServer(server: Server, port: number): Promise<void> {
  if (server.child.exitCode === null) {
    server.child.kill('SIGTERM');
    await Promise.race([once(server.child, 'exit'), sleep(5000)]);
  }
  if (server.child.exitCode === null) server.child.kill('SIGKILL');
  await waitForPortClosed(port, 8000);
}

type Jar = { call: (method: string, path: string, body?: unknown) => Promise<{ status: number; json: any }> };

function jar(base: string): Jar {
  let cookie = '';
  return {
    async call(method: string, pathname: string, body?: unknown) {
      const res = await fetch(base + pathname, {
        method,
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const json = await res.json().catch(() => null);
      return { status: res.status, json };
    },
  };
}

async function waitForHealth(base: string, server: Server, timeoutMs = 25_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(`server exited with code ${server.child.exitCode}\n${server.logs.join('\n')}`);
    }
    try {
      const res = await fetch(`${base}/health`);
      const json = (await res.json()) as { ok?: boolean; mongo?: boolean };
      if (res.status === 200 && json.ok) return;
      lastError = `health returned ${res.status}`;
    } catch (err) {
      lastError = (err as Error).message;
    }
    await sleep(200);
  }
  throw new Error(`server never became healthy: ${lastError}\n${server.logs.join('\n')}`);
}

async function main() {
  const dbPath = mkdtempSync(path.join(os.tmpdir(), 'pulse-restart-'));
  const mongoPort = await freePort();
  const appPort = await freePort();
  const mongoUri = `mongodb://127.0.0.1:${mongoPort}/pulse-chat`;
  const base = `http://127.0.0.1:${appPort}/api`;

  let mongod: ChildProcess | null = null;
  const servers: { server: Server; port: number }[] = [];

  try {
    step(`starting mongod on :${mongoPort} (data: ${dbPath})`);
    mongod = await startMongod(dbPath, mongoPort);

    // ---------- run 1: sign up, save a chat ----------
    step(`starting server #1 on :${appPort}`);
    const first = startServer(appPort, mongoUri);
    servers.push({ server: first, port: appPort });
    await waitForHealth(base, first);
    ok('server #1 is healthy');

    const a = jar(base);
    const b = jar(base);

    const regA = await a.call('POST', '/auth/register', {
      username: 'restart_a',
      displayName: 'Restart Alice',
      email: EMAIL_A,
      password: PASSWORD_A,
    });
    assert(regA.status === 201 && regA.json?.me?.username === 'restart_a', 'sign-up saved account A');
    const aId = regA.json.me.id as string;

    const regB = await b.call('POST', '/auth/register', {
      username: 'restart_b',
      displayName: 'Restart Bob',
      email: EMAIL_B,
      password: PASSWORD_B,
    });
    assert(regB.status === 201 && regB.json?.me?.username === 'restart_b', 'sign-up saved account B');
    const bId = regB.json.me.id as string;

    const direct = await a.call('POST', '/chats/direct', { username: 'restart_b' });
    assert(direct.status === 200, 'conversation opened between A and B');
    const conversationId = direct.json.conversation.id as string;

    const sent = await a.call('POST', `/chats/${conversationId}/messages`, { text: MESSAGE });
    assert(sent.status === 201, 'message saved under the conversation');
    const messageId = sent.json.message._id as string;

    // ---------- restart ----------
    step('stopping server #1');
    await stopServer(first, appPort);
    ok('server #1 stopped (database left running, as in production)');

    step(`starting server #2 on :${appPort} against the same database`);
    const second = startServer(appPort, mongoUri);
    servers.push({ server: second, port: appPort });
    await waitForHealth(base, second);
    ok('server #2 is healthy');


    // ---------- the account still signs in ----------
    const a2 = jar(base);
    const reloginEmail = await a2.call('POST', '/auth/login', {
      identifier: EMAIL_A.toUpperCase(), // the exact email from sign-up, any casing
      password: PASSWORD_A,
    });
    assert(reloginEmail.status === 200, 'sign-in with the sign-up email works after restart');
    assert(reloginEmail.json?.me?.id === aId, 'signed in as the SAME account that was created');
    assert(reloginEmail.json?.me?.displayName === 'Restart Alice', 'profile details came back from the database');

    const reloginUsername = await jar(base).call('POST', '/auth/login', {
      identifier: 'RESTART_A',
      password: PASSWORD_A,
    });
    assert(
      reloginUsername.status === 200 && reloginUsername.json?.me?.id === aId,
      'sign-in with the username works after restart'
    );

    const wrong = await jar(base).call('POST', '/auth/login', { identifier: EMAIL_A, password: 'not-the-password' });
    assert(wrong.status === 401, 'a wrong password is still rejected');

    // ---------- the chat is still under that account ----------
    const chats = await a2.call('GET', '/chats');
    const conv = (chats.json?.items ?? []).find(
      (c: any) => c.id === conversationId || c.other?.username === 'restart_b'
    );
    assert(Boolean(conv), 'conversation is listed for account A after restart');
    assert(conv.id === conversationId, 'conversation kept its id');
    assert(conv.other?.id === bId && conv.other?.username === 'restart_b', 'conversation is with the right account');
    assert(conv.lastMessage?.text === MESSAGE, 'last message preview survived');

    const thread = await a2.call('GET', `/chats/${conversationId}/messages`);
    const msgs = (thread.json?.messages ?? []) as any[];
    const found = msgs.find((m) => m._id === messageId);
    assert(Boolean(found), 'message history survived the restart');
    assert(found.text === MESSAGE, 'message text is byte-for-byte intact (emoji included)');
    assert(String(found.senderId) === aId, 'message is still attributed to account A');

    const b2 = jar(base);
    const blogin = await b2.call('POST', '/auth/login', { identifier: EMAIL_B, password: PASSWORD_B });
    assert(blogin.status === 200 && blogin.json?.me?.id === bId, 'account B can sign in after restart');
    const bThread = await b2.call('GET', `/chats/${conversationId}/messages`);
    assert(
      (bThread.json?.messages ?? []).some((m: any) => m._id === messageId),
      'the same message is visible to the other participant'
    );

    console.log('\n✅ PASS — sign-up, sign-in and chat history all survive a server restart');
  } catch (err) {
    console.error(`\n❌ ${(err as Error).message}`);
    for (const [i, s] of servers.entries()) {
      console.error(`\n--- server #${i + 1} output ---\n${s.server.logs.join('\n') || '(none)'}`);
    }
    process.exitCode = 1;
  } finally {
    for (const s of servers) {
      if (s.server.child.exitCode === null) s.server.child.kill('SIGKILL');
    }
    if (mongod) {
      mongod.kill('SIGINT');
      await Promise.race([once(mongod, 'exit'), sleep(3000)]);
      if (mongod.exitCode === null) mongod.kill('SIGKILL');
    }
    await sleep(300);
    try {
      rmSync(dbPath, { recursive: true, force: true });
    } catch {
      console.log(`(temp database kept at ${dbPath})`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
