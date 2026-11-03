import fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authRoutes } from '../../src/api/auth.js';

describe('Trakt device login routes', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('shows the user code without exposing the device code, then links Trakt to the AIOStreams viewer', async () => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', '0123456789abcdef0123456789abcdef');
    const traktAuth = {
      requestDeviceCode: vi.fn().mockResolvedValue({
        deviceCode: 'secret-device-code', userCode: 'ABCD-1234',
        verificationUrl: 'https://trakt.tv/activate', expiresIn: 600, interval: 0.001,
      }),
      pollDeviceToken: vi.fn().mockResolvedValue({ status: 'authorized', tokens: {
        accessToken: 'access-token', refreshToken: 'refresh-token', expiresAt: Date.now() + 3600000,
      } }),
      revokeToken: vi.fn(),
    };
    const db = { createUser: vi.fn(), getUser: vi.fn(), disconnectUser: vi.fn() };
    const app = fastify();
    authRoutes(app, traktAuth as any, db as any, { clientId: 'cid', clientSecret: 'secret' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: { username: 'trakt-user' } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })));

    try {
      const login = await app.inject('/auth/login?viewer=home-viewer');
      expect(login.statusCode).toBe(200);
      expect(login.body).toContain('ABCD-1234');
      expect(login.body).toContain('https://trakt.tv/activate');
      expect(login.body).toContain('home-viewer');
      expect(login.body).not.toContain('secret-device-code');
      const path = login.body.match(/const statusUrl=("[^"]+")/)?.[1];
      const statusUrl = JSON.parse(path!);
      await new Promise(resolve => setTimeout(resolve, 5));

      await expect(app.inject(statusUrl).then(response => response.json())).resolves.toMatchObject({ status: 'connected', username: 'trakt-user' });
      expect(db.createUser).toHaveBeenCalledOnce();
      expect(db.createUser.mock.calls[0][0]).toMatchObject({ id: 'home-viewer', traktUsername: 'trakt-user' });
      expect(db.createUser.mock.calls[0][0].traktAccessToken).not.toBe('access-token');
      expect(traktAuth.pollDeviceToken).toHaveBeenCalledWith('secret-device-code');
    } finally { await app.close(); }
  });

  it('returns 404 for an unknown login session', async () => {
    const app = fastify();
    authRoutes(app, {} as any, {} as any, { clientId: 'cid', clientSecret: 'secret' });
    try { expect((await app.inject('/auth/login/status/unknown')).statusCode).toBe(404); }
    finally { await app.close(); }
  });
});
