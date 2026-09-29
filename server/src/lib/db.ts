import mongoose from 'mongoose';
import { config } from '../config/env.js';
import { logger } from './logger.js';
import { User } from '../models/User.js';
import { hashPassword } from './auth.js';

/**
 * Connect to MongoDB; in development, if the configured MongoDB is unreachable,
 * fall back to an embedded in-memory MongoDB so `npm run dev` works out of the box.
 * (Data in fallback mode is ephemeral — production should always use Atlas/real Mongo.)
 */
export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 3000 });
    logger.info(`MongoDB connected: ${mongoose.connection.host}`);
    return;
  } catch (err) {
    if (config.isProd) {
      logger.error('MongoDB connection failed in production — aborting', err);
      throw err;
    }
    logger.warn(`MongoDB not reachable at ${config.mongoUri} (${(err as Error).message})`);
  }

  logger.warn('⚠ Falling back to in-memory MongoDB (dev only — data will be lost on restart)');
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const mongod = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1', port: 0 } });
  await mongoose.connect(mongod.getUri('pulse-chat'));
  logger.info(`In-memory MongoDB ready: ${mongoose.connection.host}`);
  await seedDemoUsers();
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
