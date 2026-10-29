import mongoose from 'mongoose';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config/env.js';
import { logger } from './logger.js';
import { User } from '../models/User.js';
import { hashPassword } from './auth.js';

let localMongod: ChildProcess | null = null;

export type DatabaseMode = 'configured' | 'dev-disk' | 'memory' | 'unknown';

interface DatabaseState {
  mode: DatabaseMode;
  /** true when data survives a restart of this process */
  durable: boolean;
  detail: string;
  dataPath?: string;
}

let dbState: DatabaseState = {
  mode: 'unknown',
  durable: false,
  detail: 'database connection not established yet',
};

/** Snapshot of how the process is talking to MongoDB, for /api/health. */
export function getDatabaseStatus() {
  return {
    ...dbState,
    connected: mongoose.connection.readyState === 1,
    host: mongoose.connection.host || null,
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Connect to MongoDB. In development, if the configured MongoDB is unreachable,
 * the server boots a bundled mongod against a data directory ON DISK, so
 * accounts and chats survive a restart. Only if that also fails does it fall
 * back to an ephemeral in-memory database (data lost on restart).
 *
 * Production never falls back — it aborts instead.
 */
export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 3000 });
    dbState = {
      mode: 'configured',
      durable: true,
      detail: 'connected to the configured MONGODB_URI — data is persisted by that server',
    };
    logger.info(`MongoDB connected: ${mongoose.connection.host}`);
    return;
  } catch (err) {
    if (config.isProd) {
      logger.error('MongoDB connection failed in production — aborting', err);
      throw err;
    }
    logger.warn(`MongoDB not reachable at ${config.mongoUri} (${(err as Error).message})`);
    await mongoose.disconnect().catch(() => undefined);
  }

  if (!process.env.DEV_MONGO_DISABLE) {
    const started = await startPersistentLocalMongod();
    if (started) {
      dbState = {
        mode: 'dev-disk',
        durable: true,
        detail: `dev-only bundled mongod writing to disk at ${started.dbPath} — data survives restarts`,
        dataPath: started.dbPath,
      };
      logger.info(`Dev MongoDB ready: ${started.uri} (data in ${started.dbPath} — accounts and chats are kept across restarts)`);
      await seedDemoUsers();
      return;
    }
  }

  logger.warn('⚠ Falling back to in-memory MongoDB (dev only — accounts and chats are LOST when the server restarts)');
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const mongod = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1', port: 0 } });
  await mongoose.connect(mongod.getUri('pulse-chat'));
  dbState = {
    mode: 'memory',
    durable: false,
    detail: '⚠ in-memory MongoDB — accounts and chats are LOST when the server restarts',
  };
  logger.info(`In-memory MongoDB ready: ${mongoose.connection.host}`);
  await seedDemoUsers();
}

/**
 * Dev-only: launch the mongod binary that ships with mongodb-memory-server
 * against a fixed, on-disk dbPath. Unlike MongoMemoryServer.create(), this
 * keeps the data between runs.
 */
async function startPersistentLocalMongod(): Promise<{ uri: string; dbPath: string } | null> {
  const dbPath = process.env.DEV_MONGO_DB_PATH || path.resolve(process.cwd(), '.data/mongo');
  const port = Number(process.env.DEV_MONGO_PORT) || 27017;
  const uri = `mongodb://127.0.0.1:${port}/pulse-chat`;

  try {
    const { MongoBinary } = await import('mongodb-memory-server');
    const binaryPath = await MongoBinary.getPath({});
    mkdirSync(dbPath, { recursive: true });

    const child = spawn(
      binaryPath,
      ['--dbpath', dbPath, '--port', String(port), '--bind_ip', '127.0.0.1'],
      { stdio: 'ignore' }
    );
    localMongod = child;
    child.on('exit', (code) => {
      if (code && code !== 0) logger.warn(`Dev mongod exited with code ${code}`);
      if (localMongod === child) localMongod = null;
    });
    child.on('error', (err) => logger.warn(`Dev mongod failed to start: ${err.message}`));

    for (let i = 0; i < 40; i++) {
      try {
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 1000 });
        return { uri, dbPath };
      } catch {
        await mongoose.disconnect().catch(() => undefined);
        await sleep(300);
      }
    }
    logger.warn(`Dev mongod on port ${port} did not become ready`);
  } catch (err) {
    logger.warn('Could not start a bundled mongod for dev persistence', (err as Error).message);
  }

  stopDevDatabase();
  return null;
}

/** Shut the bundled dev mongod down cleanly so WiredTiger flushes to disk. */
export function stopDevDatabase(): void {
  const child = localMongod;
  localMongod = null;
  if (!child || child.killed) return;
  try {
    child.kill('SIGINT');
  } catch {
    /* already gone */
  }
}

/**
 * Dev-only convenience: create a few demo accounts with a known password so
 * you can log in from two browsers and try one-to-one chats immediately.
 */
async function seedDemoUsers(): Promise<void> {
  try {
    const count = await User.countDocuments({ isGuest: false });
    if (count > 0) return;
    const passwordHash = await hashPassword('password123');
    const demo = [
      { username: 'nareshk', displayName: 'Naresh Kumawat', email: 'nareshk@demo.local', bio: 'Building things on the internet 🚀' },
      { username: 'rahulsharma', displayName: 'Rahul Sharma', email: 'rahul@demo.local', bio: 'Coffee. Code. Cricket.' },
      { username: 'priya', displayName: 'Priya Patel', email: 'priya@demo.local', bio: 'Designer. Dreamer.' },
      { username: 'devguy', displayName: 'Dev Guy', email: 'dev@demo.local', bio: 'Node & React' },
    ];
    for (const d of demo) {
      await User.create({ ...d, usernameLower: d.username, passwordHash });
    }
    logger.info(`Seeded ${demo.length} demo users (password: password123) — try @nareshk & @rahulsharma`);
  } catch (err) {
    logger.warn('Demo seed failed', err);
  }
}
