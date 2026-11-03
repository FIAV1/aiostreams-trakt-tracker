# Database Schema

The database is implemented with SQLite through `better-sqlite3` and parameterized SQL in `DatabaseRepository`. Table creation and versioned migrations are defined in the repository initializer.

## Tables

### `users`
Stores connected Trakt accounts.
- `id`: UUID (PK)
- `username`: String (Unique)
- `trakt_username`: String
- `trakt_access_token`: Text (Encrypted)
- `trakt_refresh_token`: Text (Encrypted)
- `token_expires_at`: Integer (Timestamp)
- `created_at`: Integer (Timestamp)
- `updated_at`: Integer (Timestamp)

### `media_items`
Caches resolved identifiers.
- `id`: UUID (PK)
- `media_type`: Enum ('movie', 'series')
- `trakt_id`: Integer (Indexed)
- `imdb_id`: String (Indexed)
- `tmdb_id`: String (Indexed)
- `tvdb_id`: String (Indexed)
- `canonical_meta_id`: String (Indexed)
- `created_at`: Integer (Timestamp)
- `updated_at`: Integer (Timestamp)

### `playback_state`
Current playback progress.
- `id`: UUID (PK)
- `user_id`: UUID (FK -> users.id)
- `media_item_id`: UUID (FK -> media_items.id)
- `video_id`: String
- `season`: Integer (Nullable)
- `episode`: Integer (Nullable)
- `position_ms`: Integer
- `duration_ms`: Integer
- `progress_percent`: Float
- `watched`: Boolean
- `source`: Enum ('jellyfin', 'trakt', 'system')
- `source_timestamp`: Integer (Timestamp)
- `updated_at`: Integer (Timestamp)

### `sync_events`
Audit log and idempotency store.
- `id`: UUID (PK)
- `user_id`: UUID (FK -> users.id)
- `event_id`: String (AIOStreams event ID)
- `media_item_id`: UUID (FK -> media_items.id)
- `event_type`: String
- `source`: Enum ('jellyfin', 'trakt', 'system')
- `event_timestamp`: Integer (Timestamp)
- `status`: Enum ('pending', 'processed', 'failed')
- `retry_count`: Integer
- `last_error`: Text
- `created_at`: Integer (Timestamp)
- `processed_at`: Integer (Timestamp, Nullable)

### `sync_state`
Synchronization checkpoints.
- `id`: UUID (PK)
- `user_id`: UUID (FK -> users.id)
- `watched_version`: String
- `last_trakt_activity`: Integer (Timestamp)
- `last_full_sync`: Integer (Timestamp)
- `last_incremental_sync`: Integer (Timestamp)
- `updated_at`: Integer (Timestamp)

### `watchlist_state`
- `user_id`: UUID (FK -> users.id)
- `media_item_id`: UUID (FK -> media_items.id)
- `at`: Integer (Timestamp)

### `ratings_state`
- `user_id`: UUID (FK -> users.id)
- `media_item_id`: UUID (FK -> media_items.id)
- `rating`: Float
- `at`: Integer (Timestamp)
- `scope`: Enum (`movie`, `series`, `season`, `episode`)
- `season`: Integer (Nullable; set for season and episode ratings)
- `episode`: Integer (Nullable; set for episode ratings)

Migration 3 adds rating scope columns and recovers scope from legacy movie, season, and episode rows where possible. Watch State pull returns episode ratings by canonical `metaId:season:episode` video ID and season ratings with their season number.

### `dropped_state`
- `user_id`: Viewer ID (FK -> users.id)
- `media_item_id`: Media item ID (FK -> media_items.id)
- `at`: Integer (Timestamp)

### `sync_jobs`
- `id`: Queue job ID (PK)
- `user_id`: Viewer ID (FK -> users.id)
- `event_id`: AIOStreams event ID (unique with `user_id`)
- `payload`: Serialized, schema-validated Watch State event
- `status`: `pending`, `processing`, `complete`, or `dead`
- `attempts`: Retry count
- `next_attempt_at`: Integer (Timestamp)
- `last_error`: Text (Nullable)
- `created_at`, `updated_at`: Integer (Timestamp)

The repository applies versioned migrations transactionally at startup. Version 2 scopes sync event IDs to a viewer so different Trakt accounts cannot collide. OAuth token values are AES-256-GCM ciphertext; the encryption key is provided through `TOKEN_ENCRYPTION_KEY` and is never stored in SQLite.
