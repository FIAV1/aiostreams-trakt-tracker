import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
export class DatabaseRepository {
    storagePath;
    db;
    constructor(storagePath) {
        this.storagePath = storagePath;
        this.init();
    }
    async init() {
        this.db = await open({
            filename: `${this.storagePath}/trakt-sync.db`,
            driver: sqlite3.Database,
        });
        await this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        trakt_username TEXT NOT NULL,
        trakt_access_token TEXT NOT NULL,
        trakt_refresh_token TEXT NOT NULL,
        token_expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS media_items (
        id TEXT PRIMARY KEY,
        media_type TEXT NOT NULL,
        trakt_id TEXT,
        imdb_id TEXT,
        tmdb_id TEXT,
        tvdb_id TEXT,
        canonical_meta_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS playback_state (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        media_item_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        season INTEGER,
        episode INTEGER,
        position_ms INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        progress_percent REAL NOT NULL,
        watched INTEGER NOT NULL,
        source TEXT NOT NULL,
        source_timestamp INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(media_item_id) REFERENCES media_items(id)
      );
      CREATE TABLE IF NOT EXISTS sync_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        media_item_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        source TEXT NOT NULL,
        event_timestamp INTEGER NOT NULL,
        status TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        processed_at INTEGER,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(media_item_id) REFERENCES media_items(id)
      );
      CREATE TABLE IF NOT EXISTS sync_state (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        watched_version TEXT NOT NULL,
        last_trakt_activity INTEGER NOT NULL,
        last_full_sync INTEGER NOT NULL,
        last_incremental_sync INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
    `);
    }
    async getUser(id) {
        return this.db.get('SELECT * FROM users WHERE id = ?', [id]);
    }
    async createUser(user) {
        await this.db.run('INSERT OR REPLACE INTO users (id, username, trakt_username, trakt_access_token, trakt_refresh_token, token_expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [user.id, user.username, user.traktUsername, user.traktAccessToken, user.traktRefreshToken, user.tokenExpiresAt instanceof Date ? user.tokenExpiresAt.getTime() : user.tokenExpiresAt, user.createdAt instanceof Date ? user.createdAt.getTime() : user.createdAt, user.updatedAt instanceof Date ? user.updatedAt.getTime() : user.updatedAt]);
        return user;
    }
    async getMediaItem(id) {
        return this.db.get('SELECT * FROM media_items WHERE id = ?', [id]);
    }
    async upsertMediaItem(item) {
        await this.db.run('INSERT OR REPLACE INTO media_items (id, media_type, trakt_id, imdb_id, tmdb_id, tvdb_id, canonical_meta_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [item.id, item.mediaType, item.traktId, item.imdbId, item.tmdbId, item.tvdbId, item.canonicalMetaId, item.createdAt instanceof Date ? item.createdAt.getTime() : item.createdAt, item.updatedAt instanceof Date ? item.updatedAt.getTime() : item.updatedAt]);
        return item;
    }
    async getPlaybackState(userId, mediaItemId) {
        return this.db.get('SELECT * FROM playback_state WHERE user_id = ? AND media_item_id = ?', [userId, mediaItemId]);
    }
    async upsertPlaybackState(state) {
        await this.db.run('INSERT OR REPLACE INTO playback_state (id, user_id, media_item_id, video_id, season, episode, position_ms, duration_ms, progress_percent, watched, source, source_timestamp, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [state.id, state.userId, state.mediaItemId, state.videoId, state.season, state.episode, state.positionMs, state.durationMs, state.progressPercent, state.watched ? 1 : 0, state.source, state.sourceTimestamp instanceof Date ? state.sourceTimestamp.getTime() : state.sourceTimestamp, state.updatedAt instanceof Date ? state.updatedAt.getTime() : state.updatedAt]);
        return state;
    }
    async upsertSyncEvent(event) {
        await this.db.run('INSERT OR REPLACE INTO sync_events (id, user_id, event_id, media_item_id, event_type, source, event_timestamp, status, retry_count, last_error, created_at, processed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [event.id, event.userId, event.eventId, event.mediaItemId, event.eventType, event.source, event.eventTimestamp instanceof Date ? event.eventTimestamp.getTime() : event.eventTimestamp, event.status, event.retryCount || 0, event.lastError, event.createdAt instanceof Date ? event.createdAt.getTime() : event.createdAt, event.processedAt instanceof Date ? event.processedAt.getTime() : event.processedAt]);
        return event;
    }
    async getSyncEvent(eventId) {
        return this.db.get('SELECT * FROM sync_events WHERE event_id = ?', [eventId]);
    }
    async getLatestSyncEvent(userId) {
        return this.db.get('SELECT * FROM sync_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [userId]);
    }
    async getPendingSyncEvents(userId) {
        return this.db.all('SELECT * FROM sync_events WHERE user_id = ? AND status = ?', [userId, 'pending']);
    }
    async updateSyncEvent(id, updates) {
        const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
        const values = [...Object.values(updates), id];
        await this.db.run(`UPDATE sync_events SET ${fields} WHERE id = ?`, values);
        return { ...updates, id };
    }
    async getSyncState(userId) {
        return this.db.get('SELECT * FROM sync_state WHERE user_id = ?', [userId]);
    }
    async upsertSyncState(state) {
        await this.db.run('INSERT OR REPLACE INTO sync_state (id, user_id, watched_version, last_trakt_activity, last_full_sync, last_incremental_sync, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [state.id, state.userId, state.watchedVersion, state.lastTraktActivity instanceof Date ? state.lastTraktActivity.getTime() : state.lastTraktActivity, state.lastFullSync instanceof Date ? state.lastFullSync.getTime() : state.lastFullSync, state.lastIncrementalSync instanceof Date ? state.lastIncrementalSync.getTime() : state.lastIncrementalSync, state.updatedAt instanceof Date ? state.updatedAt.getTime() : state.updatedAt]);
        return state;
    }
}
