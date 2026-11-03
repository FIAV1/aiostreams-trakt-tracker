import { afterEach, describe, expect, it, vi } from 'vitest';
import { TraktClient } from '../../src/trakt/client.js';

describe('TraktClient ratings', () => {
  afterEach(() => vi.unstubAllGlobals());

  function client(key: string) {
    return new TraktClient(
      { clientId: 'test-client', redirectUri: 'https://example.test/callback', publicBaseUrl: 'https://example.test' },
      { accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 60 * 60 * 1000 },
      {} as any,
      undefined,
      key,
    );
  }

  it('rounds fractional AIOStreams ratings to Trakt’s integer scale', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await client('rating-rounding').updateRating({ kind: 'movie', ids: { imdb: 'tt1234567' } }, 8.5);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toContain('/sync/ratings');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      movies: [{ ids: { imdb: 'tt1234567' }, rating: 9 }],
    });
  });

  it('maps a zero rating to removal because Trakt ratings start at one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await client('rating-zero').updateRating({ kind: 'movie', ids: { imdb: 'tt1234567' } }, 0);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toContain('/sync/ratings/remove');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ movies: [{ ids: { imdb: 'tt1234567' } }] });
  });

  it('rejects ratings outside the AIOStreams 0–10 range without making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(client('rating-invalid').updateRating({ kind: 'movie', ids: { imdb: 'tt1234567' } }, 11)).rejects.toThrow(/0 to 10/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('groups watched episodes by season in a single history write', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const at = new Date('2026-11-03T12:00:00.000Z');

    await client('bulk-history').markWatchedBulk(
      { imdb: 'tt1234567' },
      [{ season: 1, episode: 1 }, { season: 1, episode: 2 }, { season: 2, episode: 1 }],
      at,
      true,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toContain('/sync/history');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      shows: [{
        ids: { imdb: 'tt1234567' },
        seasons: [
          { number: 1, episodes: [
            { number: 1, watched_at: at.toISOString() },
            { number: 2, watched_at: at.toISOString() },
          ] },
          { number: 2, episodes: [{ number: 1, watched_at: at.toISOString() }] },
        ],
      }],
    });
  });

  it('coalesces refresh-token rotations across concurrent clients for one Trakt account', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', {
      status: 200, headers: { 'content-type': 'application/json' },
    })));
    vi.stubGlobal('fetch', fetchMock);
    const auth = {
      refreshTokens: vi.fn().mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: Date.now() + 3600000 }),
    };
    const persist = vi.fn().mockResolvedValue(undefined);
    const expired = { accessToken: 'old-access', refreshToken: 'single-use-refresh', expiresAt: 0 };
    const first = new TraktClient(
      { clientId: 'test-client', redirectUri: 'https://example.test/callback', publicBaseUrl: 'https://example.test' },
      expired, auth as any, persist, 'shared-trakt-account',
    );
    const second = new TraktClient(
      { clientId: 'test-client', redirectUri: 'https://example.test/callback', publicBaseUrl: 'https://example.test' },
      expired, auth as any, persist, 'shared-trakt-account',
    );

    await Promise.all([first.getUserSettings(), second.getUserSettings()]);

    expect(auth.refreshTokens).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
