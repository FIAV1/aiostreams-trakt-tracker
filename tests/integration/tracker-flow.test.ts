import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseRepository } from '../../src/database/repository.js';
import { apiRoutes } from '../../src/api/health.js';
import { authRoutes } from '../../src/api/auth.js';
import { watchStatePull, watchStatePush } from '../../src/api/watch-state.js';
import { SyncQueue } from '../../src/sync/queue.js';

describe('tracker service flow', () => {
  it('persists an AIOStreams push, processes it through the durable queue, and returns it on pull', async () => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', '0123456789abcdef0123456789abcdef');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: { username: 'test-trakt-user' } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })));
    const db = new DatabaseRepository(':memory:');
    await db.initialize();

    const trakt = {
      markWatched: vi.fn().mockResolvedValue(undefined),
      getActivities: vi.fn().mockResolvedValue({}),
      getPlaybackProgress: vi.fn().mockResolvedValue({ items: [{
        type: 'episode', show: { ids: { imdb: 'tt-show' } }, episode: { season: 3, number: 7, runtime: 42, ids: { trakt: 777 } },
        progress: 25, paused_at: '2026-01-01T00:00:00.000Z',
      }] }),
      getSyncHistory: vi.fn().mockResolvedValue({ items: [{
        show: { ids: { imdb: 'tt-show' } }, episode: { season: 3, number: 6, ids: { trakt: 776 } },
        watched_at: '2026-01-02T00:00:00.000Z',
      }] }),
      getWatchlist: vi.fn().mockResolvedValue({ items: [{
        type: 'season', show: { ids: { imdb: 'tt-show' } }, season: { number: 3 }, listed_at: '2026-01-05T00:00:00.000Z',
      }] }),
      getRatings: vi.fn().mockResolvedValue({ items: [
        { type: 'episode', show: { ids: { imdb: 'tt-show' } }, episode: { season: 3, number: 7, ids: { trakt: 777 } }, rating: 8, rated_at: '2026-01-03T00:00:00.000Z' },
        { type: 'season', show: { ids: { imdb: 'tt-show' } }, season: { number: 3 }, rating: 7, rated_at: '2026-01-04T00:00:00.000Z' },
      ] }),
    };
    const traktAuth = {
      requestDeviceCode: vi.fn().mockResolvedValue({
        deviceCode: 'server-only-device-code', userCode: 'ABCD-1234',
        verificationUrl: 'https://trakt.tv/activate', expiresIn: 600, interval: 0.001,
      }),
      pollDeviceToken: vi.fn().mockResolvedValue({ status: 'authorized', tokens: {
        accessToken: 'access-token', refreshToken: 'refresh-token', expiresAt: Date.now() + 3_600_000,
      } }),
      revokeToken: vi.fn(),
    };
    const queue = new SyncQueue(db, async () => trakt as any, { error: vi.fn() });
    const app = Fastify({ logger: false });
    apiRoutes(app, db);
    authRoutes(app, traktAuth as any, db, { clientId: 'test-client-id', clientSecret: 'test-client-secret' });
    watchStatePush(app, db, queue);
    watchStatePull(app, db, async () => trakt as any);

    await queue.start();
    try {
      const manifest = await app.inject('/manifest.json');
      expect(manifest.statusCode).toBe(200);
      expect(manifest.json().watchState.viewers).toBe(true);

      const login = await app.inject('/auth/login?viewer=viewer-1');
      expect(login.statusCode).toBe(200);
      expect(login.body).toContain('ABCD-1234');
      expect(login.body).not.toContain('server-only-device-code');
      const statusUrl = JSON.parse(login.body.match(/const statusUrl=("[^"]+")/)?.[1] || 'null');
      await new Promise(resolve => setTimeout(resolve, 5));
      const authorization = await app.inject(statusUrl);
      expect(authorization.statusCode).toBe(200);
      expect(authorization.json()).toMatchObject({ status: 'connected', username: 'test-trakt-user' });
      expect(traktAuth.pollDeviceToken).toHaveBeenCalledWith('server-only-device-code');
      expect(await db.getUser('viewer-1')).toMatchObject({ id: 'viewer-1', trakt_username: 'test-trakt-user' });

      const push = await app.inject({
        method: 'POST',
        url: '/watch_state/push/movie/tt1234567.json?viewer=viewer-1',
        payload: {
          id: 'event-played-1', event: 'played', scope: 'movie', videoId: 'tt1234567',
          metaId: 'tt1234567', at: Date.now(), ids: { imdb: 'tt1234567' },
        },
      });
      expect(push.statusCode).toBe(204);

      await vi.waitFor(async () => {
        expect(await db.getSyncQueueStats('viewer-1')).toMatchObject({ complete: 1 });
      }, { timeout: 5000, interval: 25 });
      expect(trakt.markWatched).toHaveBeenCalledOnce();

      const pull = await app.inject('/watch_state/pull.json?viewer=viewer-1');
      expect(pull.statusCode).toBe(200);
      expect(await db.listRatingState('viewer-1')).toEqual(expect.arrayContaining([
        expect.objectContaining({ scope: 'episode', season: 3, episode: 7 }),
        expect.objectContaining({ scope: 'season', season: 3 }),
      ]));
      expect(pull.json().ratings).toHaveLength(2);
      expect(pull.json().ratings).toEqual(expect.arrayContaining([
        expect.objectContaining({ metaId: 'tt-show', videoId: 'tt-show:3:7', rating: 8 }),
        expect.objectContaining({ metaId: 'tt-show', season: 3, rating: 7 }),
      ]));
      expect(pull.json().watchlist).toEqual([]);
      expect(pull.json()).toMatchObject({
        items: expect.arrayContaining([expect.objectContaining({ metaId: 'tt1234567', played: true })]),
        watched: { movies: ['tt1234567'], episodes: ['tt-show:3:6'], dropped: [] },
      });
      expect(pull.json().items).toEqual(expect.arrayContaining([
        expect.objectContaining({ metaId: 'tt-show', videoId: 'tt-show:3:7', played: false, positionMs: 630_000 }),
      ]));

      const repeatedPush = await app.inject({
        method: 'POST',
        url: '/watch_state/push/movie/tt1234567.json?viewer=viewer-1',
        payload: {
          id: 'event-played-1', event: 'played', scope: 'movie', videoId: 'tt1234567',
          metaId: 'tt1234567', at: Date.now(), ids: { imdb: 'tt1234567' },
        },
      });
      expect(repeatedPush.statusCode).toBe(204);
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(trakt.markWatched).toHaveBeenCalledOnce();
    } finally {
      await queue.stop();
      await app.close();
      await db.close();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
