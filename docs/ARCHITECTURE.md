# Trakt Sync Architecture

## Overview
The Trakt Sync service is a bidirectional synchronization bridge between Jellyfin (via AIOStreams Watch State v2 protocol) and Trakt.tv.

## Core Components

### 1. AIOStreams API (`src/api`)
Handles the HTTP interface for the AIOStreams addon protocol.
- `manifest.ts`: Defines the addon capabilities.
- `watch-state-push.ts`: Receives events from Jellyfin.
- `watch-state-pull.ts`: Provides state to AIOStreams.
- `auth.ts`: Handles the OAuth flow redirection and callback.

### 2. Trakt Client (`src/trakt`)
A wrapper around the Trakt REST API.
- `client.ts`: Base HTTP client with rate limiting and error handling.
- `auth.ts`: OAuth 2.0 PKCE implementation and token management.
- `scrobble.ts`, `history.ts`, `playback.ts`, `watchlist.ts`, `ratings.ts`: Domain-specific API operations.

### 3. Sync Engine (`src/sync`)
The heart of the service, implementing the "Latest Action Wins" strategy.
- `engine.ts`: Orchestrates the flow between API and Trakt.
- `conflict-resolution.ts`: Implements timestamp-based conflict resolution.
- `event-processor.ts`: Processes events asynchronously.
- `queue.ts`: Manages retries and event ordering.

### 4. Database (`src/database`)
Persistence layer using SQLite and Drizzle ORM.
- `schema.ts`: Defines users, media items, playback state, and sync events.
- `repository.ts`: Data access layer.

### 5. Identifier Mapping (`src/mapping`)
Resolves IDs between AIOStreams (IMDb, TMDB, TVDB) and Trakt.
- `identifiers.ts`: Logic for ID resolution and caching.

## Data Flow

### Push (Jellyfin -> Trakt)
1. AIOStreams sends a POST request to `/watch_state/push`.
2. API validates the event and persists it to `sync_events`.
3. Sync Engine picks up the event.
4. Identifier Mapping resolves the Trakt ID.
5. Conflict Resolution checks if the event is the latest action.
6. Trakt Client performs the API operation.
7. Event status is updated to `processed`.

### Pull (Trakt -> Jellyfin)
1. AIOStreams sends a GET request to `/watch_state/pull`.
2. API retrieves the current state from the database.
3. If the version is stale, the Sync Engine fetches updates from Trakt.
4. Trakt Client retrieves history, playback, and ratings.
5. Sync Engine updates the local state and generates a new version.
6. API returns the synchronized state.
