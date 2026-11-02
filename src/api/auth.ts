import type { FastifyInstance } from 'fastify';
import { TraktAuth } from '../trakt/auth.js';
import { DatabaseRepository } from '../database/repository.js';
import { generateCodeVerifier } from '../trakt/auth-utils.js';
import crypto from 'node:crypto';

export function authRoutes(fastify: FastifyInstance, traktAuth: TraktAuth, db: DatabaseRepository, config: any) {
  fastify.get('/auth/login', async (request, reply) => {
    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifier = generateCodeVerifier();
    
    // In a real app, we would store state and codeVerifier in a session or cookie
    // For now, we'll use a simple cookie
    reply.setCookie('trakt_auth_state', state, { httpOnly: true, secure: false });
    reply.setCookie('trakt_auth_verifier', codeVerifier, { httpOnly: true, secure: false });

    const url = await traktAuth.getAuthorizationUrl(state, codeVerifier);
    return reply.redirect(url);
  });

  fastify.get('/auth/callback', async (request, reply) => {
    const { code, state } = request.query as any;
    const storedState = request.cookies.trakt_auth_state;
    const codeVerifier = request.cookies.trakt_auth_verifier;

    if (!state || state !== storedState) {
      return reply.status(400).send('Invalid state');
    }

    if (!codeVerifier) {
      return reply.status(400).send('Missing code verifier');
    }

    const tokens = await traktAuth.exchangeCodeForTokens(code, codeVerifier);
    
    // Create or update user in database
    // For now, we'll use a dummy user ID
    const userId = 'default-user';
    await db.createUser({
      id: userId,
      username: 'default-user',
      traktUsername: 'default-trakt-user',
      traktAccessToken: tokens.accessToken,
      traktRefreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return reply.send('Authentication successful! You can now close this window.');
  });
}