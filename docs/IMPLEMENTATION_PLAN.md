# Implementation Plan

## Milestone 0: Research and Protocol Validation (Completed)
- [x] Read AIOStreams Watch State v2 specification.
- [x] Verify Trakt API endpoints.
- [x] Define database schema.
- [x] Document conflict-resolution strategy.
- [x] Produce architecture and mapping docs.

## Milestone 1: Application Foundation
- [x] Initialize TypeScript project with Fastify.
- [x] Implement SQLite persistence through `better-sqlite3` using parameterized SQL.
- [x] Implement versioned database migrations (schema versions 1, 2, and 3 are applied transactionally at startup).
- [x] Implement structured logging (Fastify/Pino).
- [x] Implement health endpoint.
- [x] Configure Dockerfile and Docker Compose.
- [x] Implement basic addon manifest endpoint.

## Milestone 2: Trakt Authentication
- [x] Implement OAuth 2.0 Device Code Flow for media-center use.
- [x] Implement device-code request, user verification page, server-side polling, and token exchange.
- [x] Implement secure token storage (AES-256-GCM encryption).
- [x] Implement automatic token refresh.
- [x] Implement account disconnection (revoke credentials while preserving local sync history).

## Milestone 3: Push Synchronization
- [x] Implement Watch State push endpoint.
- [x] Validate events against the AIOStreams SDK schema and persist accepted jobs.
- [x] Implement durable asynchronous event processing with retry.
- [x] Implement Trakt scrobbling and history updates.
- [x] Implement watchlist and rating updates.
- [x] Handle bulk mark events with per-item conflict checks and grouped Trakt history writes.
- [x] Preserve `dropped` state locally and return it through Watch State pull (Trakt has no universal dropped-state equivalent; custom-list sync is outside the current product scope).

## Milestone 4: Pull Synchronization
- [x] Implement Watch State pull endpoint.
- [x] Retrieve Trakt history, playback, watchlist, and ratings.
- [x] Pass supported IMDb/TMDB/TVDB/Trakt identifiers directly to Trakt for resolution (a separate lookup cache is unnecessary for supported IDs).
- [x] Generate stable versions from local event identifiers and Trakt activity timestamps.
- [x] Return unchanged responses using the `since` version.
- [x] Persist and reconcile Trakt snapshots into local state before applying per-item timestamp precedence.
- [x] Map Trakt episode snapshots to AIOStreams canonical video IDs and preserve movie, series, season, and episode rating scopes in storage and pull responses.

## Milestone 5: Conflict Resolution
- [x] Implement per-item timestamp conflict resolution across Jellyfin pushes and Trakt snapshots.
- [x] Track event origin in persisted sync events.
- [x] Record Trakt-origin state so repeated snapshots do not trigger duplicate writebacks.
- [x] Apply timestamp ordering and deterministic Jellyfin precedence on equal timestamps.
- [x] Implement unit coverage for event idempotency, timestamp precedence, viewer isolation, local-only dropped state, protocol routes/version gating, resume items, legacy database migration/queue persistence, bulk history grouping, Trakt rating conversion, and concurrent token rotation.
- [x] Add service-level integration coverage for Device Code login and viewer linking, manifest delivery, AIOStreams push, durable queue processing, SQLite state persistence, idempotent retry, and Watch State pull.

## Milestone 6: Reliability and Multi-user
- [x] Implement retry queue with exponential backoff.
- [x] Handle Trakt rate limits with bounded `Retry-After` retries.
- [x] Implement multi-user support through the AIOStreams `viewer` parameter.
- [x] Expose connection and queue status through `/api/status`.

## Milestone 7: Documentation and Release
- [x] Complete installation and configuration guide.
- [x] Document Trakt app registration instructions.
- [x] Add GitHub Actions checks for clean Docker build/tests and repository artifact hygiene.
- [x] Add MIT licensing and package metadata.
- [x] Add Conventional Commit pull request title checks and Release Please SemVer automation.
- [x] Add weekly Dependabot update pull requests for npm and GitHub Actions.
- [x] Build and publish production GHCR images after validated releases.
- [x] Add an importable GitHub ruleset that requires PRs and the verification check on `main`.
- [x] Add an isolated, opt-in Docker Compose stack for manual AIOStreams integration testing.
- [x] Enable GitHub Actions to create and approve pull requests; Release Please created the 1.1.0 release PR after the failed run was retried. Optional `RELEASE_PLEASE_TOKEN` can avoid workflow approval holds for future PRs.
- [x] Make the repository public and activate the `main` branch ruleset; the `verify` check is passing on the Release Please PR.
- [ ] Confirm GHCR package visibility is public for anonymous pulls.
- [ ] Complete live end-to-end validation against a registered Trakt application and connected AIOStreams deployment.
- [ ] Review and update Trakt OAuth for current app registration: Trakt now recommends PKCE and its app guide describes Client ID-only setup, while this implementation's Device Code token exchange requires a Client Secret. Preserve private-network deployment and avoid introducing a public callback requirement if possible.

## Remaining implementation notes

- The queue is durable in SQLite and retries failed jobs up to ten times before marking them dead.
- SQLite persistence uses parameterized SQL in `DatabaseRepository`; schema creation and migrations live beside repository initialization.
- `dropped` is retained locally and returned by pull; syncing it to a custom Trakt list would require a separate product policy.
- Trakt account-wide activity timestamps cannot precisely order every remote deletion against every local item event.
- End-to-end validation requires a registered Trakt app and a connected AIOStreams/Jellyfin deployment; the tracker does not need an HTTPS callback.
- The Docker `test` build target runs the complete Vitest suite against a clean Linux install; all 37 tests pass, including version 2 database upgrade and service-level integration coverage. The production image was started with dummy OAuth configuration and returned HTTP 200 at `/health` and `/manifest.json`.
- Clean dependency installation and production dependency pruning report zero known npm vulnerabilities; obsolete `sqlite3`, Drizzle, and unused runtime dependencies have been removed.
- Live end-to-end validation still requires a registered Trakt app, browser/AIOStreams reachability to the private tracker, and an AIOStreams instance connected to it. Use a dedicated test Trakt account so sync checks do not change personal watch history, lists, or ratings.
- Trakt's current [app creation guide](https://developer.trakt.tv/docs/create-an-app) says app creation requires a verified GitHub account and recommends PKCE; its [OAuth guide](https://developer.trakt.tv/docs/authentication-oauth) says client secrets are deprecated for user sign-in. This tracker still uses Device Code Flow and includes a client secret in token exchange and refresh. Confirm compatibility with newly created Trakt apps before claiming current OAuth setup is fully validated; if the Trakt portal does not issue a client secret, OAuth migration is required.
- GitHub checks on 2026-11-03 initially showed `can_approve_pull_request_reviews: false`; after the owner enabled Actions PR creation, rerunning the workflow succeeded and opened release PR #7 for 1.1.0. The repo is public, the `Protect main` branch ruleset is active, and `verify` passes on PR #7. No Actions secrets are configured; the built-in token is being used. GHCR image publication is skipped until the release PR is merged and the release is created.
