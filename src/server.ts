import fastify from 'fastify';
import type { TraktConfig } from './trakt/config.js';
import { TraktAuth } from './trakt/auth.js';
import { TraktClient } from './trakt/client.js';
import { DatabaseRepository } from './database/repository.js';
import { authRoutes } from './api/auth.js';
import { apiRoutes } from './api/health.js';
import { watchStatePush, watchStatePull } from './api/watch-state.js';
import { decryptToken, encryptToken } from './trakt/token-crypto.js';
import { SyncQueue } from './sync/queue.js';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const config: TraktConfig = {
  clientId: requiredEnv('TRAKT_CLIENT_ID'),
  clientSecret: requiredEnv('TRAKT_CLIENT_SECRET'),
};
// Validate early so token encryption cannot silently fall back to plaintext.
if (requiredEnv('TOKEN_ENCRYPTION_KEY').length < 32) {
  throw new Error('TOKEN_ENCRYPTION_KEY must contain at least 32 characters');
}

const databasePath = process.env.DATABASE_URL || `${process.env.DATA_DIR || 'data'}/trakt-sync.db`;
const app = fastify({ logger: { level: process.env.LOG_LEVEL || 'info' } });

const traktAuth = new TraktAuth(config);
const db = new DatabaseRepository(databasePath);
await db.initialize();

async function getTraktClient(viewer: string): Promise<TraktClient> {
  const user = await db.getUser(viewer);
  const tokens = user ? {
    accessToken: user.trakt_access_token ? decryptToken(user.trakt_access_token) : '',
    refreshToken: user.trakt_refresh_token ? decryptToken(user.trakt_refresh_token) : '',
    expiresAt: user.token_expires_at,
  } : { accessToken: '', refreshToken: '', expiresAt: 0 };

  return new TraktClient(config, tokens, traktAuth, async (updated) => {
    if (!user?.trakt_username) throw new Error(`Viewer ${viewer} is no longer connected`);
    await db.updateTraktCredentials(user.trakt_username,
      encryptToken(updated.accessToken), encryptToken(updated.refreshToken), updated.expiresAt);
  }, user?.trakt_username?.toLowerCase() || viewer);
}

authRoutes(app, traktAuth, db, config);
apiRoutes(app, db);
const queue = new SyncQueue(db, getTraktClient, app.log);
watchStatePush(app, db, queue);
watchStatePull(app, db, getTraktClient);
await queue.start();

app.addHook('onClose', async () => {
  await queue.stop();
  await db.close();
});

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
try {
  const address = await app.listen({ port, host });
  app.log.info(`Trakt Sync server running on ${address}`);
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
  });
}
