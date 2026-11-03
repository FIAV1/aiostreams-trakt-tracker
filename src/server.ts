import fastify from 'fastify';
import cookie from '@fastify/cookie';
import type { TraktConfig } from './trakt/config.js';
import { TraktAuth } from './trakt/auth.js';
import { TraktClient } from './trakt/client.js';
import { DatabaseRepository } from './database/repository.js';
import { authRoutes } from './api/auth.js';
import { apiRoutes } from './api/health.js';
import { watchStatePush, watchStatePull } from './api/watch-state.js';

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || 'data';
const TRAKT_CLIENT_ID = process.env.TRAKT_CLIENT_ID || 'your-client-id';
const TRAKT_CLIENT_SECRET = process.env.TRAKT_CLIENT_SECRET || 'your-client-secret';
const TRAKT_REDIRECT_URI = process.env.TRAKT_REDIRECT_URI || 'http://localhost:3000/auth/callback';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';

const app = fastify({ logger: { level: 'info' } });
await app.register(cookie);

const config: TraktConfig = {
  clientId: TRAKT_CLIENT_ID,
  clientSecret: TRAKT_CLIENT_SECRET,
  redirectUri: TRAKT_REDIRECT_URI,
  publicBaseUrl: PUBLIC_BASE_URL,
};

const traktAuth = new TraktAuth(config);
const db = new DatabaseRepository(DATA_DIR);

let traktClient: TraktClient | null = null;

async function initializeTraktClient(): Promise<TraktClient> {
  const user = await db.getUser('default-user');
  let client: TraktClient;
  if (user) {
    const tokens = {
      accessToken: user.trakt_access_token,
      refreshToken: user.trakt_refresh_token,
      expiresAt: user.token_expires_at,
    };
    client = new TraktClient(config, tokens);
  } else {
    client = new TraktClient(config, {
      accessToken: '',
      refreshToken: '',
      expiresAt: 0,
    });
  }
  traktClient = client;
  return client;
}

app.addHook('onReady', async () => {
  const client = await initializeTraktClient();
  authRoutes(app, traktAuth, db, config);
  apiRoutes(app);
  watchStatePush(app, db, client, config);
  watchStatePull(app, db, client, config);
});

app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`Trakt Sync server running on ${address}`);
});