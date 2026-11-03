import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseRepository } from '../../src/database/repository.js';

describe('DatabaseRepository', () => {
  let db: DatabaseRepository;

  beforeEach(async () => {
    db = new DatabaseRepository(':memory:');
    await db.initialize();
    for (const id of ['viewer-a', 'viewer-b']) {
      await db.createUser({
        id, username: id, traktUsername: id === 'viewer-b' ? 'viewer-a' : id, traktAccessToken: 'encrypted-access',
        traktRefreshToken: 'encrypted-refresh', tokenExpiresAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
      });
    }
    await db.upsertMediaItem({
      id: 'movie-1', mediaType: 'movie', canonicalMetaId: 'imdb:tt1234567',
      traktId: 42, imdbId: 'tt1234567', createdAt: new Date(), updatedAt: new Date(),
    });
  });

  afterEach(async () => db.close());

  it('applies migrations and scopes the same event ID to separate viewers', async () => {
    for (const viewer of ['viewer-a', 'viewer-b']) {
      await db.upsertSyncEvent({
        id: `${viewer}:same-event`, userId: viewer, eventId: 'same-event', mediaItemId: 'movie-1',
        eventType: 'played', source: 'jellyfin', eventTimestamp: new Date(1000), status: 'processed',
        createdAt: new Date(1000), processedAt: new Date(1000),
      });
    }

    expect(await db.getSyncEvent('viewer-a', 'same-event')).toMatchObject({ user_id: 'viewer-a', event_id: 'same-event' });
    expect(await db.getSyncEvent('viewer-b', 'same-event')).toMatchObject({ user_id: 'viewer-b', event_id: 'same-event' });
  });

  it('upgrades version 2 databases and recovers legacy scoped ratings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'trakt-tracker-migration-'));
    const filename = join(directory, 'tracker.db');
    const legacy = new BetterSqlite3(filename);
    legacy.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);
      INSERT INTO schema_migrations VALUES (1, 'initial-schema', 1), (2, 'viewer-scoped-event-ids', 2);
      CREATE TABLE media_items (id TEXT PRIMARY KEY, media_type TEXT NOT NULL, canonical_meta_id TEXT NOT NULL);
      CREATE TABLE ratings_state (user_id TEXT NOT NULL, media_item_id TEXT NOT NULL, rating REAL NOT NULL, at INTEGER NOT NULL,
        PRIMARY KEY(user_id, media_item_id));
      INSERT INTO media_items VALUES ('show:season:3', 'series', 'imdb:ttshow'),
        ('show:episode:3:7', 'series', 'imdb:ttshow'), ('imdb:ttmovie', 'movie', 'imdb:ttmovie');
      INSERT INTO ratings_state VALUES ('viewer-a', 'show:season:3', 7, 1000),
        ('viewer-a', 'show:episode:3:7', 8, 2000), ('viewer-a', 'imdb:ttmovie', 9, 3000);`);
    legacy.close();

    const upgraded = new DatabaseRepository(filename);
    try {
      await upgraded.initialize();
      const ratings = await upgraded.listRatingState('viewer-a');
      expect(ratings).toEqual(expect.arrayContaining([
        expect.objectContaining({ scope: 'season', season: 3, episode: null, rating: 7 }),
        expect.objectContaining({ scope: 'episode', season: 3, episode: 7, rating: 8 }),
        expect.objectContaining({ scope: 'movie', season: null, episode: null, rating: 9 }),
      ]));
    } finally {
      await upgraded.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('deduplicates durable jobs per viewer and allows the same event for another viewer', async () => {
    await db.enqueueSyncJob('viewer-a', 'event-1', { event: 'played' });
    await db.enqueueSyncJob('viewer-a', 'event-1', { event: 'played' });
    await db.enqueueSyncJob('viewer-b', 'event-1', { event: 'played' });

    const claimed = await db.claimDueSyncJobs();
    expect(claimed).toHaveLength(2);
    expect(claimed.map(job => job.user_id).sort()).toEqual(['viewer-a', 'viewer-b']);
    expect(await db.getSyncQueueStats('viewer-a')).toMatchObject({ processing: 1 });
  });

  it('returns newest resume and watched items while omitting active starts', async () => {
    for (const id of ['movie-2', 'movie-3']) {
      await db.upsertMediaItem({ id, mediaType: 'movie', canonicalMetaId: id, createdAt: new Date(), updatedAt: new Date() });
    }
    for (const [id, videoId, eventType, at, watched] of [
      ['movie-1', 'movie-1', 'pause', 1000, false],
      ['movie-2', 'movie-2', 'start', 3000, false],
      ['movie-3', 'movie-3', 'played', 2000, true],
    ] as const) {
      await db.upsertPlaybackState({
        id: `viewer-a:${videoId}`, userId: 'viewer-a', mediaItemId: id, videoId,
        positionMs: 120_000, durationMs: 600_000, progressPercent: 20, watched,
        source: 'jellyfin', sourceTimestamp: new Date(at), updatedAt: new Date(at),
      });
      await db.upsertSyncEvent({
        id: `viewer-a:${eventType}:${id}`, userId: 'viewer-a', eventId: `${eventType}:${id}`,
        mediaItemId: id, eventType, source: 'jellyfin', eventTimestamp: new Date(at),
        status: 'processed', createdAt: new Date(at), processedAt: new Date(at),
      });
    }

    const rows = await db.listPlaybackItems('viewer-a');
    expect(rows.map(row => row.videoId)).toEqual(['movie-3', 'movie-1']);
  });

  it('rotates credentials for viewers sharing a Trakt account without reconnecting a disconnected viewer', async () => {
    await db.disconnectUser('viewer-b');
    await db.updateTraktCredentials('viewer-a', 'new-access', 'new-refresh', new Date(5000));

    expect(await db.getUser('viewer-a')).toMatchObject({ trakt_access_token: 'new-access', trakt_refresh_token: 'new-refresh' });
    expect(await db.getUser('viewer-b')).toMatchObject({ trakt_access_token: '', trakt_refresh_token: '' });
  });
});
