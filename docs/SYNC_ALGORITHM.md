# Synchronization Algorithm

## Latest Action Wins (LAW)

The core objective is to ensure that the most recent user action is preserved, regardless of the source.

### Conflict Resolution Logic

When a new event $E_{new}$ arrives for media item $M$:

1. **Idempotency Check**: If $E_{new}.id$ exists in `sync_events` with status `processed`, discard.
2. **State Retrieval**: Fetch the latest known state $S_{current}$ for $M$ from `playback_state`.
3. **Timestamp Comparison**:
   - Let $T_{new} = E_{new}.timestamp$
   - Let $T_{current} = S_{current}.source\_timestamp$
4. **Decision**:
   - If $T_{new} > T_{current}$:
     - Apply $E_{new}$ to the local state.
     - Push the update to the opposite provider (if not already the source).
   - If $T_{new} < T_{current}$:
     - Discard $E_{new}$ (it is a stale update).
   - If $T_{new} == T_{current}$:
     - Use a deterministic tie-breaker (e.g., `source` priority: Jellyfin > Trakt).
5. **Persistence**: Update `playback_state` and mark $E_{new}$ as `processed`.

## Echo Protection

To prevent infinite loops (Jellyfin $\rightarrow$ Trakt $\rightarrow$ Jellyfin):

1. Every update pushed to a provider is tagged with a `system` source.
2. The Sync Engine ignores events where the source is `system` or where the event timestamp matches a recently processed local update within a small grace window (e.g., 1 second).
3. Use the `sync_events` table to track the origin of every state change.

## Versioning (Pull Interface)

The `watched_version` returned to AIOStreams is a hash of:
- The timestamp of the last processed `sync_event` for the user.
- The `last_trakt_activity` timestamp.

If the client's version matches the server's version, the server omits the `watched` block to save bandwidth.
