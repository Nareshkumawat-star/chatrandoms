import 'dotenv/config';

function num(v: string | undefined, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

export const config = {
  port: num(process.env.PORT, 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  origins: (process.env.CLIENT_ORIGINS ?? process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/pulse-chat',
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret',
    accessTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
    refreshTtl: process.env.REFRESH_TOKEN_TTL ?? '30d',
    cookieName: process.env.COOKIE_NAME ?? 'accessToken',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: process.env.CLOUDINARY_API_KEY ?? '',
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
  },
  adminKey: process.env.ADMIN_KEY ?? '',
  limits: {
    globalMessageCooldownMs: num(process.env.GLOBAL_MESSAGE_COOLDOWN_MS, 1500),
    guestMessageCooldownMs: num(process.env.GUEST_MESSAGE_COOLDOWN_MS, 5000),
    dmMessageCooldownMs: num(process.env.DM_MESSAGE_COOLDOWN_MS, 600),
  },
} as const;
