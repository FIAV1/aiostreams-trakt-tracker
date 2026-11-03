import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import type { TraktAuth, TraktDevicePollResult } from '../trakt/auth.js';
import { TraktClient } from '../trakt/client.js';
import type { DatabaseRepository } from '../database/repository.js';
import type { TraktConfig } from '../trakt/config.js';
import { decryptToken, encryptToken } from '../trakt/token-crypto.js';

type LoginState = {
  viewer: string;
  deviceCode: string;
  expiresAt: number;
  intervalMs: number;
  nextPollAt: number;
  status: 'pending' | 'connected' | 'denied' | 'expired' | 'failed';
  username?: string;
  message?: string;
  poll?: Promise<void>;
  createdAt: number;
};

const sessions = new Map<string, LoginState>();
const MAX_SESSIONS = 500;
const SESSION_TTL_MS = 15 * 60_000;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]!));

function applyPollResult(state: LoginState, result: TraktDevicePollResult) {
  if (result.status === 'pending') return;
  if (result.status === 'slow_down') {
    state.intervalMs += 1000;
    return;
  }
  if (result.status === 'authorized') return result;
  state.status = result.status === 'denied' ? 'denied' : 'expired';
  state.message = result.status === 'denied' ? 'Authorization was denied.' : 'This device code is no longer valid. Start again.';
}

export function authRoutes(fastify: FastifyInstance, traktAuth: TraktAuth, db: DatabaseRepository, config: TraktConfig) {
  fastify.get<{ Querystring: { viewer?: string } }>('/auth/login', async (request, reply) => {
    const viewer = request.query.viewer?.trim() || 'default-user';
    if (viewer.length > 200) return reply.status(400).send({ error: 'Viewer ID is too long' });
    try {
      const device = await traktAuth.requestDeviceCode();
      const id = randomBytes(32).toString('base64url');
      const now = Date.now();
      for (const [key, value] of sessions) if (now - value.createdAt > SESSION_TTL_MS) sessions.delete(key);
      while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
      sessions.set(id, {
        viewer, deviceCode: device.deviceCode, expiresAt: now + device.expiresIn * 1000,
        intervalMs: device.interval * 1000, nextPollAt: now + device.interval * 1000,
        status: 'pending', createdAt: now,
      });
      const sessionUrl = `/auth/login/status/${id}`;
      reply.header('Cache-Control', 'no-store');
      reply.header('Referrer-Policy', 'no-referrer');
      return reply.type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Trakt</title><style>body{font:16px system-ui;max-width:38rem;margin:10vh auto;padding:0 1rem;color:#222}code{font-size:1.6rem;font-weight:700;background:#eee;padding:.35rem .6rem}a,button{color:#b31b26}button{padding:.6rem 1rem}</style>
<h1>Connect Trakt</h1><p>Connecting the Trakt account to AIOStreams viewer <strong>${escapeHtml(viewer)}</strong>.</p>
<p>Open <a href="${escapeHtml(device.verificationUrl)}" target="_blank" rel="noopener noreferrer">Trakt device activation</a> and enter this code:</p>
<p><code>${escapeHtml(device.userCode)}</code></p><p id="status">Waiting for authorization…</p>
<script>
const statusUrl=${JSON.stringify(sessionUrl)};
const statusNode=document.getElementById('status');
async function poll(){try{const response=await fetch(statusUrl,{cache:'no-store'});if(!response.ok)throw new Error();const result=await response.json();if(result.status==='connected'){statusNode.textContent='Connected to Trakt as @'+result.username+'. You can close this page.';return}if(result.status==='pending'){setTimeout(poll,1000);return}statusNode.textContent=result.message||'Could not connect to Trakt.'}catch{statusNode.textContent='Connection check failed. Reload this page to try again.'}}
setTimeout(poll,1000);
</script></html>`);
    } catch (error) {
      fastify.log.error({ err: error }, 'Could not start Trakt device authorization');
      return reply.status(502).send({ error: 'Could not start Trakt authentication' });
    }
  });

  fastify.get<{ Params: { sessionId: string } }>('/auth/login/status/:sessionId', async (request, reply) => {
    const state = sessions.get(request.params.sessionId);
    reply.header('Cache-Control', 'no-store');
    if (!state) return reply.status(404).send({ error: 'Login session not found or expired' });
    if (state.status === 'pending' && Date.now() >= state.expiresAt) {
      state.status = 'expired';
      state.message = 'The device code expired. Start again.';
      state.deviceCode = '';
    }
    if (state.status === 'pending' && Date.now() >= state.nextPollAt) {
      if (!state.poll) {
        state.poll = (async () => {
          try {
            const result = applyPollResult(state, await traktAuth.pollDeviceToken(state.deviceCode));
            if (result && result.status === 'authorized') {
              const profileClient = new TraktClient(config, result.tokens, traktAuth);
              const settings = await profileClient.getUserSettings();
              const username = settings?.user?.username;
              if (typeof username !== 'string' || !username) throw new Error('Trakt did not return a user profile');
              const now = new Date();
              await db.createUser({
                id: state.viewer, username: state.viewer, traktUsername: username,
                traktAccessToken: encryptToken(result.tokens.accessToken),
                traktRefreshToken: encryptToken(result.tokens.refreshToken),
                tokenExpiresAt: result.tokens.expiresAt, createdAt: now, updatedAt: now,
              });
              state.status = 'connected';
              state.username = username;
              state.deviceCode = '';
            }
            if (state.status === 'pending') state.nextPollAt = Date.now() + state.intervalMs;
          } catch (error) {
            fastify.log.error({ err: error, viewer: state.viewer }, 'Trakt device authorization polling failed');
            state.status = 'failed';
            state.message = 'Trakt authentication failed. Check the tracker logs and start again.';
            state.deviceCode = '';
          } finally { state.poll = undefined; }
        })();
      }
      await state.poll;
    }
    return reply.send({ status: state.status, ...(state.username ? { username: state.username } : {}), ...(state.message ? { message: state.message } : {}) });
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
