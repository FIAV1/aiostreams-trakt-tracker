import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { createHash } from 'node:crypto';
import { watchStatePull, watchStatePush } from '../../src/api/watch-state.js';

describe('Watch State routes', () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => Promise.all(apps.splice(0).map(app => app.close())));

  it('accepts both standard JSON and extensionless push URLs', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const db = { getUser: vi.fn().mockResolvedValue({ id: 'default-user', trakt_access_token: 'encrypted', trakt_refresh_token: 'encrypted' }) } as any;
    const queue = { enqueue: vi.fn().mockResolvedValue(undefined) } as any;
    watchStatePush(app, db, queue);

    for (const [id, suffix] of [['event-a', '.json'], ['event-b', '']]) {
      const response = await app.inject({
        method: 'POST',
        url: `/watch_state/push/movie/tt1234567${suffix}`,
        payload: { id, event: 'played', videoId: 'tt1234567', metaId: 'tt1234567', at: 1_800_000_000 },
      });
      expect(response.statusCode).toBe(204);
    }
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
  });

  it('always returns playback items but omits unchanged version-gated blocks', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const activity = {};
    const fingerprint = createHash('sha256').update('{}').digest('hex').slice(0, 20);
    const version = `v0--0-${fingerprint}`;
    const db = {
      getUser: vi.fn().mockResolvedValue({ id: 'default-user', trakt_access_token: 'ciphertext', trakt_refresh_token: 'ciphertext' }),
      getSyncState: vi.fn().mockResolvedValue({ watched_version: fingerprint, last_trakt_activity: 0 }),
      getLatestSyncEvent: vi.fn().mockResolvedValue(undefined),
      listPlaybackItems: vi.fn().mockResolvedValue([{
        type: 'movie', metaId: 'tt1234567', videoId: 'tt1234567', season: null, episode: null,
        positionMs: 120_000, durationMs: 0, progressPercent: 0, watched: 0, at: 1_800_000_000,
      }]),
      listPlaybackStates: vi.fn().mockResolvedValue([{
        type: 'movie', metaId: 'tt1234567', videoId: 'tt1234567', season: null, episode: null,
        positionMs: 120_000, durationMs: 600_000, progressPercent: 20, watched: 0, at: 1_800_000_000,
      }]),
      listWatchlistState: vi.fn().mockResolvedValue([]),
      listRatingState: vi.fn().mockResolvedValue([]),
      listDroppedState: vi.fn().mockResolvedValue([]),
    } as any;
    const trakt = { getActivities: vi.fn().mockResolvedValue(activity) } as any;
    watchStatePull(app, db, vi.fn().mockResolvedValue(trakt));

    const response = await app.inject({ method: 'GET', url: `/watch_state/pull?since=${encodeURIComponent(version)}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      version,
      items: [expect.objectContaining({ metaId: 'tt1234567', positionMs: 120_000, played: false })],
    });
    expect(response.json().items[0]).not.toHaveProperty('durationMs');
    expect(response.json().items[0]).not.toHaveProperty('progressPercent');
    expect(trakt.getActivities).toHaveBeenCalledOnce();
  });

  it('returns 404 for an unknown viewer and 401 for a disconnected viewer', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const db = { getUser: vi.fn() } as any;
    const queue = { enqueue: vi.fn() } as any;
    watchStatePush(app, db, queue);

    db.getUser.mockResolvedValueOnce(undefined);
    const unknown = await app.inject({
      method: 'POST', url: '/watch_state/push/movie/tt1234567.json?viewer=unknown',
      payload: { id: 'event-1', event: 'played', videoId: 'tt1234567', metaId: 'tt1234567', at: 1_800_000_000 },
    });
    expect(unknown.statusCode).toBe(404);

    db.getUser.mockResolvedValueOnce({ id: 'disconnected', trakt_access_token: '', trakt_refresh_token: '' });
    const disconnected = await app.inject({
      method: 'POST', url: '/watch_state/push/movie/tt1234567.json?viewer=disconnected',
      payload: { id: 'event-2', event: 'played', videoId: 'tt1234567', metaId: 'tt1234567', at: 1_800_000_000 },
    });
    expect(disconnected.statusCode).toBe(401);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
