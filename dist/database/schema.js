import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
export const users = sqliteTable('users', {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    traktUsername: text('trakt_username').notNull(),
    traktAccessToken: text('trakt_access_token').notNull(),
    traktRefreshToken: text('trakt_refresh_token').notNull(),
    tokenExpiresAt: integer('token_expires_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});
export const mediaItems = sqliteTable('media_items', {
    id: text('id').primaryKey(),
    mediaType: text('media_type').notNull(), // 'movie' | 'series'
    traktId: text('trakt_id'),
    imdbId: text('imdb_id'),
    tmdbId: text('tmdb_id'),
    tvdbId: text('tvdb_id'),
    canonicalMetaId: text('canonical_meta_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});
export const playbackState = sqliteTable('playback_state', {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id).notNull(),
    mediaItemId: text('media_item_id').references(() => mediaItems.id).notNull(),
    videoId: text('video_id').notNull(),
    season: integer('season'),
    episode: integer('episode'),
    positionMs: integer('position_ms').notNull(),
    durationMs: integer('duration_ms').notNull(),
    progressPercent: real('progress_percent').notNull(),
    watched: integer('watched', { mode: 'boolean' }).notNull(),
    source: text('source').notNull(), // 'jellyfin' | 'trakt' | 'system'
    sourceTimestamp: integer('source_timestamp', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});
export const syncEvents = sqliteTable('sync_events', {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id).notNull(),
    eventId: text('event_id').notNull(),
    mediaItemId: text('media_item_id').references(() => mediaItems.id).notNull(),
    eventType: text('event_type').notNull(),
    source: text('source').notNull(),
    eventTimestamp: integer('event_timestamp', { mode: 'timestamp' }).notNull(),
    status: text('status').notNull(), // 'pending' | 'processed' | 'failed'
    retryCount: integer('retry_count').default(0).notNull(),
    lastError: text('last_error'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    processedAt: integer('processed_at', { mode: 'timestamp' }),
});
export const syncState = sqliteTable('sync_state', {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id).notNull(),
    watchedVersion: text('watched_version').notNull(),
    lastTraktActivity: integer('last_trakt_activity', { mode: 'timestamp' }).notNull(),
    lastFullSync: integer('last_full_sync', { mode: 'timestamp' }).notNull(),
    lastIncrementalSync: integer('last_incremental_sync', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});
