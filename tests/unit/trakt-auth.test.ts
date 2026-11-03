import { afterEach, describe, expect, it, vi } from 'vitest';
import { TraktAuth } from '../../src/trakt/auth.js';

describe('Trakt device authorization', () => {
  afterEach(() => vi.unstubAllGlobals());
  const auth = () => new TraktAuth({ clientId: 'client-id', clientSecret: 'client-secret' });

  it('requests a device code with the app client ID and validates the returned URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      device_code: 'private-device-code', user_code: 'ABCD-1234',
      verification_url: 'https://trakt.tv/activate', expires_in: 600, interval: 5,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(auth().requestDeviceCode()).resolves.toEqual({
      deviceCode: 'private-device-code', userCode: 'ABCD-1234',
      verificationUrl: 'https://trakt.tv/activate', expiresIn: 600, interval: 5,
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.trakt.tv/oauth/device/code');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ client_id: 'client-id' });
  });

  it('exchanges an approved device code using the server-side client secret', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access', refresh_token: 'refresh', expires_in: 3600, created_at: 100,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(auth().pollDeviceToken('device-code')).resolves.toEqual({
      status: 'authorized', tokens: { accessToken: 'access', refreshToken: 'refresh', expiresAt: 100000 + 3600000 },
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.trakt.tv/oauth/device/token');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      code: 'device-code', client_id: 'client-id', client_secret: 'client-secret',
    });
  });

  it('rotates refresh tokens using the registered app credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(auth().refreshTokens('old-refresh')).resolves.toMatchObject({
      accessToken: 'rotated-access', refreshToken: 'rotated-refresh',
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      grant_type: 'refresh_token', refresh_token: 'old-refresh',
      client_id: 'client-id', client_secret: 'client-secret',
    });
  });

  it.each([[400, 'pending'], [429, 'slow_down'], [404, 'invalid'], [409, 'already_used'], [410, 'expired'], [418, 'denied']] as const)(
    'maps Trakt device polling HTTP %i to %s', async (status, expected) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));
      await expect(auth().pollDeviceToken('device-code')).resolves.toEqual({ status: expected });
    },
  );

  it('rejects non-Trakt verification URLs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      device_code: 'x', user_code: 'y', verification_url: 'https://attacker.example', expires_in: 60, interval: 5,
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    await expect(auth().requestDeviceCode()).rejects.toThrow(/invalid device verification URL/);
  });
});
