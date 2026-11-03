import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

type DateLike = Date | number | string | null | undefined;
const timestamp = (value: DateLike): number | null => {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid timestamp: ${value}`);
  return parsed;
};

/** SQLite persistence. All public methods wait for schema initialization. */
export class DatabaseRepository {
  private readonly ready: Promise<Database>;

  constructor(databasePath: string) {
    const filename = databasePath === ':memory:' ? databasePath : resolve(databasePath);
    this.ready = (async () => {
      if (filename !== ':memory:') await mkdir(dirname(filename), { recursive: true });
      const db = await open({ filename, driver: sqlite3.Database });
      await db.exec('PRAGMA foreign_keys = ON;');
      const schemaSql = `
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY, username TEXT NOT NULL, trakt_username TEXT NOT NULL,
          trakt_access_token TEXT NOT NULL, trakt_refresh_token TEXT NOT NULL,
          token_expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS media_items (
          id TEXT PRIMARY KEY, media_type TEXT NOT NULL, trakt_id TEXT, imdb_id TEXT,
          tmdb_id TEXT, tvdb_id TEXT, canonical_meta_id TEXT NOT NULL,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS playback_state (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, media_item_id TEXT NOT NULL,
          video_id TEXT NOT NULL, season INTEGER, episode INTEGER, position_ms INTEGER NOT NULL,
          duration_ms INTEGER NOT NULL, progress_percent REAL NOT NULL, watched INTEGER NOT NULL,
          source TEXT NOT NULL, source_timestamp INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(media_item_id) REFERENCES media_items(id)
        );
        CREATE INDEX IF NOT EXISTS playback_state_user_updated ON playback_state(user_id, updated_at);
        CREATE TABLE IF NOT EXISTS sync_events (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, event_id TEXT NOT NULL,
          media_item_id TEXT NOT NULL, event_type TEXT NOT NULL, source TEXT NOT NULL,
          event_timestamp INTEGER NOT NULL, status TEXT NOT NULL,
          retry_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at INTEGER NOT NULL,
          processed_at INTEGER, FOREIGN KEY(user_id) REFERENCES users(id),
          FOREIGN KEY(media_item_id) REFERENCES media_items(id)
        );
        CREATE INDEX IF NOT EXISTS sync_events_pending ON sync_events(status, created_at);
        CREATE UNIQUE INDEX IF NOT EXISTS sync_events_user_event_id ON sync_events(user_id, event_id);
        CREATE TABLE IF NOT EXISTS sync_state (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, watched_version TEXT NOT NULL,
          last_trakt_activity INTEGER NOT NULL, last_full_sync INTEGER NOT NULL,
          last_incremental_sync INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sync_state_user_id ON sync_state(user_id);
        CREATE TABLE IF NOT EXISTS watchlist_state (
          user_id TEXT NOT NULL, media_item_id TEXT NOT NULL, at INTEGER NOT NULL,
          PRIMARY KEY(user_id, media_item_id), FOREIGN KEY(user_id) REFERENCES users(id),
          FOREIGN KEY(media_item_id) REFERENCES media_items(id)
        );
        CREATE TABLE IF NOT EXISTS ratings_state (
          user_id TEXT NOT NULL, media_item_id TEXT NOT NULL, rating REAL NOT NULL, at INTEGER NOT NULL,
          PRIMARY KEY(user_id, media_item_id), FOREIGN KEY(user_id) REFERENCES users(id),
          FOREIGN KEY(media_item_id) REFERENCES media_items(id)
        );
        CREATE TABLE IF NOT EXISTS dropped_state (
          user_id TEXT NOT NULL, media_item_id TEXT NOT NULL, at INTEGER NOT NULL,
          PRIMARY KEY(user_id, media_item_id), FOREIGN KEY(user_id) REFERENCES users(id),
          FOREIGN KEY(media_item_id) REFERENCES media_items(id)
        );
        CREATE TABLE IF NOT EXISTS sync_jobs (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, event_id TEXT NOT NULL, payload TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          UNIQUE(user_id, event_id), FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS sync_jobs_due ON sync_jobs(status, next_attempt_at, created_at);
      `;
      await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL
      )`);
      const migration = await db.get('SELECT MAX(version) AS version FROM schema_migrations');
      if ((migration?.version ?? 0) < 1) {
        await db.exec('BEGIN IMMEDIATE');
        try {
          await db.exec(schemaSql);
          await db.run('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)', 1, 'initial-schema', Date.now());
          await db.exec('PRAGMA user_version = 1');
          await db.exec('COMMIT');
        } catch (error) {
          await db.exec('ROLLBACK');
          throw error;
        }
      }
      const currentMigration = await db.get('SELECT MAX(version) AS version FROM schema_migrations');
      if ((currentMigration?.version ?? 0) < 2) {
        await db.exec('BEGIN IMMEDIATE');
        try {
          // Rebuild sync_events to make event IDs unique within a viewer rather than globally.
          await db.exec(`DROP INDEX IF EXISTS sync_events_event_id;
            DROP INDEX IF EXISTS sync_events_user_event_id;
            ALTER TABLE sync_events RENAME TO sync_events_v1;
            CREATE TABLE sync_events (
              id TEXT PRIMARY KEY, user_id TEXT NOT NULL, event_id TEXT NOT NULL,
              media_item_id TEXT NOT NULL, event_type TEXT NOT NULL, source TEXT NOT NULL,
              event_timestamp INTEGER NOT NULL, status TEXT NOT NULL,
              retry_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at INTEGER NOT NULL,
              processed_at INTEGER, FOREIGN KEY(user_id) REFERENCES users(id),
              FOREIGN KEY(media_item_id) REFERENCES media_items(id)
            );
            INSERT INTO sync_events SELECT * FROM sync_events_v1;
            DROP TABLE sync_events_v1;
            CREATE UNIQUE INDEX sync_events_user_event_id ON sync_events(user_id, event_id);
            CREATE INDEX sync_events_pending ON sync_events(status, created_at);`);
          await db.run('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)', 2, 'viewer-scoped-event-ids', Date.now());
          await db.exec('PRAGMA user_version = 2');
          await db.exec('COMMIT');
        } catch (error) {
          await db.exec('ROLLBACK');
          throw error;
        }
      }
      return db;
    })();
  }

  async close() { (await this.ready).close(); }
  async initialize() { await this.ready; }
  private async db() { return this.ready; }

  async getUser(id: string) { return (await this.db()).get('SELECT * FROM users WHERE id = ?', id); }
  async listUsers() { return (await this.db()).all('SELECT * FROM users ORDER BY created_at'); }
  async disconnectUser(id: string) {
    await (await this.db()).run(`UPDATE users SET trakt_access_token='', trakt_refresh_token='',
      token_expires_at=0, updated_at=? WHERE id=?`, Date.now(), id);
  }

  async updateTraktCredentials(traktUsername: string, accessToken: string, refreshToken: string, expiresAt: DateLike) {
    const result = await (await this.db()).run(`UPDATE users SET trakt_access_token=?, trakt_refresh_token=?,
      token_expires_at=?, updated_at=? WHERE LOWER(trakt_username)=LOWER(?) AND trakt_refresh_token <> ''`,
    accessToken, refreshToken, timestamp(expiresAt), Date.now(), traktUsername);
    if (!result.changes) throw new Error(`No connected Trakt account found for ${traktUsername}`);
  }

  async createUser(user: any) {
    await (await this.db()).run(`INSERT INTO users
      (id, username, trakt_username, trakt_access_token, trakt_refresh_token, token_expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET username=excluded.username, trakt_username=excluded.trakt_username,
      trakt_access_token=excluded.trakt_access_token, trakt_refresh_token=excluded.trakt_refresh_token,
      token_expires_at=excluded.token_expires_at, updated_at=excluded.updated_at`,
    [user.id, user.username, user.traktUsername, user.traktAccessToken, user.traktRefreshToken,
      timestamp(user.tokenExpiresAt), timestamp(user.createdAt), timestamp(user.updatedAt)]);
    return user;
  }

  async getMediaItem(id: string) {
    return (await this.db()).get(`SELECT id, media_type AS mediaType, trakt_id AS traktId,
      imdb_id AS imdbId, tmdb_id AS tmdbId, tvdb_id AS tvdbId, canonical_meta_id AS canonicalMetaId,
      created_at AS createdAt, updated_at AS updatedAt FROM media_items WHERE id = ?`, id);
  }

  async getMediaItemByIdentifiers(ids: Record<string, unknown>, canonicalMetaId?: string, includeCanonical = true) {
    const db = await this.db();
    const clauses: string[] = [];
    const values: unknown[] = [];
    for (const key of ['trakt', 'imdb', 'tmdb', 'tvdb'] as const) {
      const value = ids[key];
      if (value == null) continue;
      const column = `${key}_id`;
      clauses.push(`${column} = ?`);
      values.push(String(value));
    }
    if (includeCanonical && canonicalMetaId) { clauses.push('canonical_meta_id = ?'); values.push(canonicalMetaId); }
    if (!clauses.length) return undefined;
    return db.get(`SELECT id, media_type AS mediaType, trakt_id AS traktId, imdb_id AS imdbId,
      tmdb_id AS tmdbId, tvdb_id AS tvdbId, canonical_meta_id AS canonicalMetaId,
      created_at AS createdAt, updated_at AS updatedAt FROM media_items WHERE ${clauses.join(' OR ')} LIMIT 1`, ...values);
  }

  async upsertMediaItem(item: any) {
    await (await this.db()).run(`INSERT INTO media_items
      (id, media_type, trakt_id, imdb_id, tmdb_id, tvdb_id, canonical_meta_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET media_type=excluded.media_type,
      trakt_id=COALESCE(excluded.trakt_id, media_items.trakt_id),
      imdb_id=COALESCE(excluded.imdb_id, media_items.imdb_id),
      tmdb_id=COALESCE(excluded.tmdb_id, media_items.tmdb_id),
      tvdb_id=COALESCE(excluded.tvdb_id, media_items.tvdb_id),
      canonical_meta_id=excluded.canonical_meta_id, updated_at=excluded.updated_at`,
    [item.id, item.mediaType, item.traktId ?? null, item.imdbId ?? null, item.tmdbId ?? null,
      item.tvdbId ?? null, item.canonicalMetaId, timestamp(item.createdAt), timestamp(item.updatedAt)]);
    return item;
  }

  async getPlaybackState(userId: string, mediaItemId: string) {
    return (await this.db()).get(`SELECT id, user_id AS userId, media_item_id AS mediaItemId,
      video_id AS videoId, season, episode, position_ms AS positionMs, duration_ms AS durationMs,
      progress_percent AS progressPercent, watched, source, source_timestamp AS sourceTimestamp,
      updated_at AS updatedAt FROM playback_state WHERE user_id = ? AND media_item_id = ?`, userId, mediaItemId);
  }

  async listPlaybackStates(userId: string) {
    return (await this.db()).all(`SELECT p.video_id AS videoId, p.season, p.episode,
      p.position_ms AS positionMs, p.duration_ms AS durationMs, p.progress_percent AS progressPercent,
      p.watched, p.source, p.source_timestamp AS at, m.canonical_meta_id AS metaId, m.media_type AS type
      FROM playback_state p JOIN media_items m ON m.id=p.media_item_id WHERE p.user_id=?`, userId);
  }

  /** Return current resume points and watched item rows, newest first, excluding active playback starts. */
  async listPlaybackItems(userId: string) {
    return (await this.db()).all(`SELECT p.video_id AS videoId, p.season, p.episode,
      p.position_ms AS positionMs, p.duration_ms AS durationMs, p.progress_percent AS progressPercent,
      p.watched, p.source_timestamp AS at, m.canonical_meta_id AS metaId, m.media_type AS type
      FROM playback_state p JOIN media_items m ON m.id=p.media_item_id
      WHERE p.user_id=?
        AND (p.position_ms > 0 OR p.watched=1 OR EXISTS (
          SELECT 1 FROM sync_events e WHERE e.user_id=p.user_id AND e.media_item_id=p.media_item_id
            AND e.event_timestamp=p.source_timestamp AND e.status='processed'
            AND e.event_type IN ('pause', 'stop', 'trakt_playback')
        ))
        AND NOT EXISTS (
          SELECT 1 FROM sync_events e WHERE e.user_id=p.user_id AND e.media_item_id=p.media_item_id
            AND e.event_timestamp=p.source_timestamp AND e.source='jellyfin'
            AND e.event_type='start' AND e.status='processed'
        )
      ORDER BY p.source_timestamp DESC LIMIT 1000`, userId);
  }

  async upsertPlaybackState(state: any) {
    await (await this.db()).run(`INSERT INTO playback_state
      (id, user_id, media_item_id, video_id, season, episode, position_ms, duration_ms,
       progress_percent, watched, source, source_timestamp, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET position_ms=excluded.position_ms, duration_ms=excluded.duration_ms,
      progress_percent=excluded.progress_percent, watched=excluded.watched, source=excluded.source,
      source_timestamp=excluded.source_timestamp, updated_at=excluded.updated_at`,
    [state.id, state.userId, state.mediaItemId, state.videoId, state.season ?? null, state.episode ?? null,
      state.positionMs ?? 0, state.durationMs ?? 0, state.progressPercent ?? 0, state.watched ? 1 : 0,
      state.source, timestamp(state.sourceTimestamp), timestamp(state.updatedAt)]);
    return state;
  }

  async upsertSyncEvent(event: any) {
    const eventId = event.eventId ?? event.id;
    await (await this.db()).run(`INSERT INTO sync_events
      (id, user_id, event_id, media_item_id, event_type, source, event_timestamp, status,
       retry_count, last_error, created_at, processed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, event_id) DO UPDATE SET status=excluded.status, retry_count=excluded.retry_count,
      last_error=excluded.last_error, processed_at=excluded.processed_at`,
    [event.id, event.userId, eventId, event.mediaItemId, event.eventType, event.source,
      timestamp(event.eventTimestamp), event.status, event.retryCount ?? 0, event.lastError ?? null,
      timestamp(event.createdAt), timestamp(event.processedAt)]);
    return event;
  }

  async getSyncEvent(userId: string, eventId: string) { return (await this.db()).get('SELECT * FROM sync_events WHERE user_id = ? AND event_id = ?', userId, eventId); }
  async getLatestMediaEvent(userId: string, mediaItemId: string) {
    return (await this.db()).get(`SELECT * FROM sync_events WHERE user_id=? AND media_item_id=? AND status='processed'
      ORDER BY event_timestamp DESC, CASE source WHEN 'jellyfin' THEN 0 ELSE 1 END, created_at DESC LIMIT 1`, userId, mediaItemId);
  }
  async getLatestSyncEvent(userId: string) { return (await this.db()).get('SELECT * FROM sync_events WHERE user_id = ? ORDER BY created_at DESC, event_id DESC LIMIT 1', userId); }
  async getPendingSyncEvents(userId: string) { return (await this.db()).all("SELECT * FROM sync_events WHERE user_id = ? AND status IN ('pending','failed') ORDER BY created_at", userId); }

  async updateSyncEvent(id: string, updates: Record<string, unknown>) {
    const columns: Record<string, string> = { status: 'status', retryCount: 'retry_count', lastError: 'last_error', processedAt: 'processed_at' };
    const entries = Object.entries(updates).filter(([key]) => columns[key]);
    if (!entries.length) return { id };
    const assignments = entries.map(([key]) => `${columns[key]} = ?`).join(', ');
    const values = entries.map(([key, value]) => key === 'processedAt' ? timestamp(value as DateLike) : value);
    await (await this.db()).run(`UPDATE sync_events SET ${assignments} WHERE id = ?`, ...values, id);
    return { ...updates, id };
  }

  async getSyncState(userId: string) { return (await this.db()).get('SELECT * FROM sync_state WHERE user_id = ?', userId); }
  async upsertSyncState(state: any) {
    await (await this.db()).run(`INSERT INTO sync_state
      (id, user_id, watched_version, last_trakt_activity, last_full_sync, last_incremental_sync, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET
      watched_version=excluded.watched_version, last_trakt_activity=excluded.last_trakt_activity,
      last_full_sync=excluded.last_full_sync, last_incremental_sync=excluded.last_incremental_sync,
      updated_at=excluded.updated_at`,
    [state.id, state.userId, state.watchedVersion, timestamp(state.lastTraktActivity),
      timestamp(state.lastFullSync), timestamp(state.lastIncrementalSync), timestamp(state.updatedAt)]);
    return state;
  }

  async recordTraktActivity(userId: string, activityAt: number, fingerprint: string) {
    const now = Date.now();
    const id = `sync-state:${userId}`;
    await (await this.db()).run(`INSERT INTO sync_state
      (id, user_id, watched_version, last_trakt_activity, last_full_sync, last_incremental_sync, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET watched_version=excluded.watched_version,
      last_trakt_activity=excluded.last_trakt_activity, last_incremental_sync=excluded.last_incremental_sync,
      updated_at=excluded.updated_at`, id, userId, fingerprint, activityAt, now, now, now);
  }

  async setWatchlistState(userId: string, mediaItemId: string, at: DateLike, present: boolean) {
    const db = await this.db();
    if (present) await db.run(`INSERT INTO watchlist_state(user_id, media_item_id, at) VALUES (?, ?, ?)
      ON CONFLICT(user_id, media_item_id) DO UPDATE SET at=excluded.at`, userId, mediaItemId, timestamp(at));
    else await db.run('DELETE FROM watchlist_state WHERE user_id=? AND media_item_id=?', userId, mediaItemId);
  }
  async listWatchlistState(userId: string) {
    return (await this.db()).all(`SELECT m.media_type AS type, m.canonical_meta_id AS metaId, w.media_item_id AS mediaItemId, w.at
      FROM watchlist_state w JOIN media_items m ON m.id=w.media_item_id WHERE w.user_id=?`, userId);
  }

  async setRatingState(userId: string, mediaItemId: string, rating: number | null, at: DateLike) {
    const db = await this.db();
    if (rating == null) await db.run('DELETE FROM ratings_state WHERE user_id=? AND media_item_id=?', userId, mediaItemId);
    else await db.run(`INSERT INTO ratings_state(user_id, media_item_id, rating, at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, media_item_id) DO UPDATE SET rating=excluded.rating, at=excluded.at`, userId, mediaItemId, rating, timestamp(at));
  }
  async listRatingState(userId: string) {
    return (await this.db()).all(`SELECT m.media_type AS type, m.canonical_meta_id AS metaId,
      r.media_item_id AS mediaItemId, r.rating, r.at FROM ratings_state r JOIN media_items m ON m.id=r.media_item_id WHERE r.user_id=?`, userId);
  }

  async setDroppedState(userId: string, mediaItemId: string, at: DateLike, present: boolean) {
    const db = await this.db();
    if (present) await db.run(`INSERT INTO dropped_state(user_id, media_item_id, at) VALUES (?, ?, ?)
      ON CONFLICT(user_id, media_item_id) DO UPDATE SET at=excluded.at`, userId, mediaItemId, timestamp(at));
    else await db.run('DELETE FROM dropped_state WHERE user_id=? AND media_item_id=?', userId, mediaItemId);
  }
  async listDroppedState(userId: string) {
    return (await this.db()).all(`SELECT m.canonical_meta_id AS metaId, d.at FROM dropped_state d
      JOIN media_items m ON m.id=d.media_item_id WHERE d.user_id=?`, userId);
  }

  async enqueueSyncJob(userId: string, eventId: string, payload: unknown) {
    const now = Date.now();
    const id = `${userId}:${eventId}`;
    await (await this.db()).run(`INSERT OR IGNORE INTO sync_jobs
      (id, user_id, event_id, payload, status, attempts, next_attempt_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)`, id, userId, eventId, JSON.stringify(payload), now, now, now);
  }

  async claimDueSyncJobs(limit = 10) {
    const db = await this.db();
    await db.exec('BEGIN IMMEDIATE');
    try {
      const jobs = await db.all(`SELECT * FROM sync_jobs WHERE status='pending' AND next_attempt_at <= ?
        ORDER BY created_at LIMIT ?`, Date.now(), limit);
      for (const job of jobs) await db.run("UPDATE sync_jobs SET status='processing', updated_at=? WHERE id=? AND status='pending'", Date.now(), job.id);
      await db.exec('COMMIT');
      return jobs;
    } catch (error) { await db.exec('ROLLBACK'); throw error; }
  }

  async requeueInterruptedSyncJobs() {
    await (await this.db()).run("UPDATE sync_jobs SET status='pending', next_attempt_at=?, updated_at=? WHERE status='processing'", Date.now(), Date.now());
  }

  async completeSyncJob(id: string) {
    await (await this.db()).run("UPDATE sync_jobs SET status='complete', last_error=NULL, updated_at=? WHERE id=?", Date.now(), id);
  }

  async failSyncJob(id: string, attempts: number, error: string) {
    const nextAttempts = attempts + 1;
    const terminal = nextAttempts >= 10;
    const delayMs = Math.min(1000 * (2 ** Math.min(nextAttempts, 10)), 60 * 60 * 1000);
    await (await this.db()).run(`UPDATE sync_jobs SET attempts=?, status=?, next_attempt_at=?, last_error=?, updated_at=? WHERE id=?`,
      nextAttempts, terminal ? 'dead' : 'pending', Date.now() + delayMs, error.slice(0, 2000), Date.now(), id);
  }

  async getSyncQueueStats(userId: string) {
    const rows = await (await this.db()).all('SELECT status, COUNT(*) AS count FROM sync_jobs WHERE user_id=? GROUP BY status', userId);
    return Object.fromEntries(rows.map((row: { status: string; count: number }) => [row.status, row.count]));
  }
}
