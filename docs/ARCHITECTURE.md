# Trakt Sync Architecture

## Runtime components

- `src/server.ts` loads required configuration, opens SQLite, registers routes, creates a durable sync worker, and handles shutdown.
- `src/index.ts` defines and validates the AIOStreams addon manifest.
- `src/api/auth.ts` implements viewer-scoped Trakt Device Code login/status polling and account disconnection.
- `src/api/watch-state.ts` validates Watch State v2 push events and builds pull responses from Trakt plus local state.
- `src/api/health.ts` exposes health/status and `/manifest.json`.
- `src/trakt/auth.ts` handles device-code authorization, token refresh, and revocation.
- `src/trakt/token-crypto.ts` encrypts/decrypts tokens with AES-256-GCM.
- `src/trakt/client.ts` owns Trakt HTTP calls, headers, pagination, rate-limit retries, and payload construction.
- `src/sync/queue.ts` persists accepted push events and retries them with exponential backoff.
- `src/sync/engine.ts` applies pushed events, merges Trakt snapshots, and performs per-item timestamp conflict checks.
- `src/database/repository.ts` creates and migrates SQLite tables transactionally, then implements persistence with parameterized SQL through `better-sqlite3`.

## Push flow

1. AIOStreams POSTs an event to `/watch_state/push/:scope/:id.json` with an optional `viewer` query parameter; the extensionless form is also accepted.
2. The server validates the event with the bundled AIOStreams SDK schema and checks that the viewer has connected Trakt.
3. The payload is durably queued in SQLite; the endpoint acknowledges it after persistence.
4. The queue worker calls `SyncEngine`, which compares the event timestamp to the latest stored event for each media item.
5. A winning event is applied to Trakt and local state, then recorded with its origin. Failures are retried up to ten times.

## Pull flow

1. AIOStreams GETs `/watch_state/pull` (or `/watch_state/pull.json`) with `viewer` and optional `since`.
2. The server reads Trakt's last-activity timestamps and always returns up to 1,000 newest playback/resume `items`; active `start` events clear their resume item. When `since` matches it omits version-gated `watched`, `watchlist`, and `ratings` blocks.
3. When the version changes, it fetches playback, history, watchlist, and ratings, merges timestamped Trakt state into local playback/audit records, then maps the result to Watch State v2.
4. Locally stored dropped IDs are returned in the `watched.dropped` array.

## Persistence and limitations

SQLite stores viewer credentials, media identifiers, playback state, event audit records, sync checkpoints, watchlist/ratings/dropped state, and durable queue jobs. OAuth tokens are encrypted at rest.

Conflict reconciliation uses timestamped local events and Trakt snapshots, with Jellyfin winning equal timestamps. Supported external IDs are sent directly to Trakt, which resolves them; no separate identifier cache is maintained. `dropped` is retained locally and returned through Watch State pull. Queue counts, including dead jobs, are available through `/api/status`. Device Code login avoids a callback; live end-to-end validation requires a registered Trakt app and connected AIOStreams deployment.
