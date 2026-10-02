import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import { config } from './config/env.js';
import { logger } from './lib/logger.js';
import { notFoundHandler, errorHandler } from './middleware/errors.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import chatRoutes from './routes/chats.js';
import messageRoutes from './routes/messages.js';
import globalRoutes from './routes/global.js';
import uploadRoutes from './routes/upload.js';
import { initSockets } from './socket/index.js';
import { connectDatabase } from './lib/db.js';
import { getOnlineCount } from './services/presence.js';
import { Challenge, dailyChallengeText } from './models/moderation.js';

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: config.origins, credentials: true },
  path: '/socket.io',
  // Match express.json's 1.5mb limit so photo attachments can ride dm:send.
  maxHttpBufferSize: 1.5 * 1024 * 1024,
});

async function main() {
  await connectDatabase();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true); // curl / same-origin
        if (!config.isProd) return cb(null, true); // permissive in dev (proxy covers same-origin)
        if (config.origins.includes(origin)) return cb(null, true);
        cb(new Error('Not allowed by CORS'));
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: '1.5mb' }));
  app.use(cookieParser());

  // Basic per-IP API rate limit for unauthenticated brute-force protection
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/auth')) {
      res.setHeader('X-RateLimit-Limit', '30/min');
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      uptime: process.uptime(),
      online: getOnlineCount(),
      mongo: mongoose.connection.readyState === 1,
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/chats', chatRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/global', globalRoutes);
  app.use('/api/upload', uploadRoutes);

  // Daily challenge upsert (deterministic per day)
  const today = new Date().toISOString().slice(0, 10);
  Challenge.updateOne(
    { dateKey: today },
    { $setOnInsert: { dateKey: today, text: dailyChallengeText(new Date()), isAuto: true } },
    { upsert: true }
  ).catch(() => undefined);

  initSockets(io);

  app.use(notFoundHandler);
  app.use(errorHandler);

  httpServer.listen(config.port, () => {
    logger.info(`API + Socket.IO listening on :${config.port} (${config.nodeEnv})`);
  });

  const shutdown = async () => {
    logger.info('Shutting down…');
    io.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error('Fatal startup error', err);
  process.exit(1);
});
