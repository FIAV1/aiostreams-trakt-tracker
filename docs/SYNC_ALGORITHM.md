# Synchronization Algorithm

## Latest Action Wins

For a push event on a media item, the engine reads the latest successfully processed event for that viewer and item. The event timestamp is compared to the incoming timestamp:

- A newer incoming Jellyfin event is sent to Trakt and persisted locally.
- An older event is skipped.
- At equal timestamps, Jellyfin takes precedence over Trakt snapshots.

Trakt snapshots fetched during a full pull are written with source `trakt`. Bulk mark events are evaluated per episode so one episode's newer state does not suppress the rest of the bulk operation.

## Idempotency and retries

Event IDs are recorded in SQLite, unique within each viewer. Bulk parts receive a part suffix. The durable job queue deduplicates by viewer and event ID, processes jobs in order, and retries failures with exponential delay. Jobs stop retrying after ten attempts and remain marked dead for diagnostics.

Trakt calls use direct provider IDs where available. The Trakt API handles matching IMDb, TMDB, TVDB, and Trakt IDs. The project does not yet maintain a separate ID-resolution cache.

## Pull versions

The pull version combines the latest local audit event with the most recent activity timestamp returned by Trakt. A matching `since` version returns only the version field. A changed version triggers a full pull and state merge.

## Current limits

- `dropped` state is local-only; no custom Trakt list name is configured.
- Trakt's activity feed is account-wide, so deletions without item-specific timestamps cannot be ordered precisely against every local event.
