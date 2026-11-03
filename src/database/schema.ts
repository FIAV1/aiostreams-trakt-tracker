import { sqliteTable, text, integer, real, primaryKey, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

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
}, table => [uniqueIndex('sync_events_user_event_id').on(table.userId, table.eventId), index('sync_events_pending').on(table.status, table.createdAt)]);

export const syncState = sqliteTable('sync_state', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id).notNull(),
  watchedVersion: text('watched_version').notNull(),
  lastTraktActivity: integer('last_trakt_activity', { mode: 'timestamp' }).notNull(),
  lastFullSync: integer('last_full_sync', { mode: 'timestamp' }).notNull(),
  lastIncrementalSync: integer('last_incremental_sync', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, table => [uniqueIndex('sync_state_user_id').on(table.userId)]);

export const watchlistState = sqliteTable('watchlist_state', {
  userId: text('user_id').references(() => users.id).notNull(),
  mediaItemId: text('media_item_id').references(() => mediaItems.id).notNull(),
  at: integer('at', { mode: 'timestamp' }).notNull(),
}, table => [primaryKey({ columns: [table.userId, table.mediaItemId] })]);

export const ratingsState = sqliteTable('ratings_state', {
  userId: text('user_id').references(() => users.id).notNull(),
  mediaItemId: text('media_item_id').references(() => mediaItems.id).notNull(),
  rating: real('rating').notNull(),
  at: integer('at', { mode: 'timestamp' }).notNull(),
}, table => [primaryKey({ columns: [table.userId, table.mediaItemId] })]);

export const droppedState = sqliteTable('dropped_state', {
  userId: text('user_id').references(() => users.id).notNull(),
  mediaItemId: text('media_item_id').references(() => mediaItems.id).notNull(),
  at: integer('at', { mode: 'timestamp' }).notNull(),
}, table => [primaryKey({ columns: [table.userId, table.mediaItemId] })]);

export const syncJobs = sqliteTable('sync_jobs', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id).notNull(),
  eventId: text('event_id').notNull(),
  payload: text('payload').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp' }).notNull(),
  lastError: text('last_error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, table => [uniqueIndex('sync_jobs_user_event').on(table.userId, table.eventId), index('sync_jobs_due').on(table.status, table.nextAttemptAt, table.createdAt)]);
