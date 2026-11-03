import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import type { TraktAuth } from '../trakt/auth.js';
import { TraktClient } from '../trakt/client.js';
import type { DatabaseRepository } from '../database/repository.js';
import type { TraktConfig } from '../trakt/config.js';
import { decryptToken, encryptToken } from '../trakt/token-crypto.js';
import { generateCodeVerifier } from '../trakt/auth-utils.js';

interface AuthQuery { code?: string; state?: string; viewer?: string; }
const secureCookie = process.env.NODE_ENV === 'production';

export function authRoutes(fastify: FastifyInstance, traktAuth: TraktAuth, db: DatabaseRepository, config: TraktConfig) {
  fastify.get<{ Querystring: AuthQuery }>('/auth/login', async (request, reply) => {
    const state = randomBytes(24).toString('base64url');
    const codeVerifier = generateCodeVerifier();
    const viewer = request.query.viewer?.trim() || 'default-user';
    const cookieOptions = { httpOnly: true, secure: secureCookie, sameSite: 'lax' as const, path: '/', maxAge: 600 };
    reply.setCookie('trakt_auth_state', state, cookieOptions);
    reply.setCookie('trakt_auth_verifier', codeVerifier, cookieOptions);
    reply.setCookie('trakt_auth_viewer', viewer, cookieOptions);
    return reply.redirect(await traktAuth.getAuthorizationUrl(state, codeVerifier));
  });

  fastify.get<{ Querystring: AuthQuery }>('/auth/callback', async (request, reply) => {
    const { code, state } = request.query;
    const { trakt_auth_state: storedState, trakt_auth_verifier: codeVerifier, trakt_auth_viewer: viewer } = request.cookies;
    reply.clearCookie('trakt_auth_state', { path: '/' });
    reply.clearCookie('trakt_auth_verifier', { path: '/' });
    reply.clearCookie('trakt_auth_viewer', { path: '/' });

    if (!code || !state || state !== storedState) return reply.status(400).send({ error: 'Invalid OAuth state or missing authorization code' });
    if (!codeVerifier) return reply.status(400).send({ error: 'Missing PKCE verifier; restart authentication' });

    try {
      const tokens = await traktAuth.exchangeCodeForTokens(code, codeVerifier);
      const profileClient = new TraktClient(config, tokens, traktAuth);
      const settings = await profileClient.getUserSettings();
      const profile = settings?.user;
      if (!profile?.username) throw new Error('Trakt did not return a user profile');

      const userId = viewer || 'default-user';
      const now = new Date();
      await db.createUser({
        id: userId,
        username: userId,
        traktUsername: profile.username,
        traktAccessToken: encryptToken(tokens.accessToken),
        traktRefreshToken: encryptToken(tokens.refreshToken),
        tokenExpiresAt: tokens.expiresAt,
        createdAt: now,
        updatedAt: now,
      });
      return reply.type('text/plain').send(`Trakt account @${profile.username} connected for viewer "${userId}". You can close this window.`);
    } catch (error) {
      fastify.log.error({ err: error }, 'Trakt OAuth callback failed');
      return reply.status(502).send({ error: 'Trakt authentication could not be completed' });
    }
  });

  fastify.delete<{ Querystring: { viewer?: string } }>('/auth/disconnect', async (request, reply) => {
    const viewer = request.query.viewer || 'default-user';
    const user = await db.getUser(viewer);
    if (!user) return reply.status(404).send({ error: 'Viewer is not connected' });
    try {
      const tokens = { accessToken: decryptToken(user.trakt_access_token), refreshToken: decryptToken(user.trakt_refresh_token), expiresAt: user.token_expires_at };
      await traktAuth.revokeToken(tokens.accessToken);
    } catch (error) {
      fastify.log.warn({ err: error, viewer }, 'Could not revoke Trakt token; removing local connection');
    }
    await db.disconnectUser(viewer);
    return reply.status(204).send();
  });
}
