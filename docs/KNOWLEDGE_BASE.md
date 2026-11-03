# Project knowledge base

This is the durable record of project decisions and operational facts that are easy to lose between implementation sessions. Keep entries concise and update them alongside material changes. Put current product requirements in the README, detailed mechanisms in the architecture/database/sync docs, and only cross-cutting decisions or unresolved constraints here.

## Product and protocol

- The tracker is a self-hosted bridge from AIOStreams Watch State v2 to Trakt.tv. AIOStreams supplies the viewer identifier; all tokens, state, queue entries, and sync results must remain viewer-scoped.
- Supported synchronization includes playback progress, watched history, watchlists, and ratings. `dropped` remains local because Trakt has no universal dropped-state endpoint; syncing it to a custom list requires a separate product decision.
- Conflict handling follows per-item Latest Action Wins with deterministic Jellyfin precedence on equal timestamps. Trakt-origin snapshots must not be echoed back as duplicate Trakt writes.
- See `docs/API_MAPPING.md`, `docs/ARCHITECTURE.md`, and `docs/SYNC_ALGORITHM.md` for contracts and implementation details.

## Authentication and privacy

- Trakt authentication uses OAuth 2.0 Device Code Flow. The user approves a code on Trakt's HTTPS page; the tracker polls Trakt and stores encrypted credentials. No redirect URI, callback route, TLS certificate, or public tracker endpoint is needed.
- Current setup: users create an app from [Trakt Developer My Apps](https://developer.trakt.tv/apps), and Trakt currently requires a verified GitHub account to create apps. The tracker generates its own one-time device code and requires the app's client ID and client secret for its current device-token exchange; users must not paste generated access tokens or the app secret into AIOStreams. Trakt's current OAuth guide recommends PKCE for authorization-code sign-in, so revisit this integration if Trakt changes or removes device-flow credential requirements.
- OAuth compatibility is an open release risk: Trakt's current [app guide](https://developer.trakt.tv/docs/create-an-app) says newly created apps provide a Client ID and recommends PKCE; its [OAuth guide](https://developer.trakt.tv/docs/authentication-oauth) deprecates client secrets for user sign-in. The code still uses legacy Device Code token exchange and refresh with a client secret. Do not claim compatibility with newly created apps until verified; track migration in `docs/IMPLEMENTATION_PLAN.md` and preserve the no-public-callback deployment goal.
- The tracker needs outbound HTTPS to Trakt. AIOStreams and the user's browser need a private route to the tracker. Keep it on loopback, LAN, VPN, or a private Docker network as appropriate; do not configure public port forwarding for the tracker.
- `TOKEN_ENCRYPTION_KEY` must remain stable across restarts and backups. Never log secrets, access/refresh tokens, device codes, or encryption keys.

## Persistence and processing

- SQLite uses `better-sqlite3`; repository SQL is parameterized. Migrations run transactionally at startup.
- Push events enter a durable asynchronous queue after SDK schema validation. Retries are bounded with exponential backoff and Trakt `Retry-After` handling; exhausted work is marked dead for diagnosis.
- Idempotency and origin tracking prevent duplicate processing and sync loops. Read `docs/DATABASE_SCHEMA.md` before changing persisted state and `docs/SYNC_ALGORITHM.md` before changing event precedence.

## Docker and integration testing

- Production deployment is `docker-compose.yml`, which pulls `ghcr.io/fiav1/aiostreams-trakt-tracker:latest` by default; set `TRACKER_IMAGE` to pin a version. Persist `/data` and keep the encryption key stable.
- `.github/workflows/ci.yml` runs verification before Release Please or GHCR publishing. Release images use `latest` and semantic version tags.
- `docker-compose.test.yml` is an opt-in disposable stack with a local tracker build, official AIOStreams container, private Compose network, host-loopback UI ports, and isolated `.test-data/`. It enables private addon URLs only within this local test AIOStreams instance.
- Automated tests use simulated Trakt responses. Live E2E still requires a registered Trakt application, explicit device-code approval, and a reachable AIOStreams instance; never use a personal account for destructive/sync-mutating checks.

## Contribution and release policy

- `main` should accept changes through PRs only. The repository includes an importable ruleset at `.github/rulesets/main-protection.json`; GitHub must have it imported for enforcement.
- PR titles follow Conventional Commits because squash merge uses the title as the commit subject. `feat` maps to a minor bump, `fix` to patch, and `!`/`BREAKING CHANGE` to major. Release Please generates the changelog, version PR, tag, and GitHub Release.
- Dependabot checks npm and GitHub Actions weekly; npm patch/minor updates are grouped, major updates stay separate, and PR title prefixes remain compatible with semantic validation.
- The initial published version baseline is `1.0.0`, matching `package.json`. `.release-please-manifest.json` records this baseline and `.release-please-config.json` limits changelog history to commits after the bootstrap SHA.
- Release Please needs a repository secret named `RELEASE_PLEASE_TOKEN` so generated release PRs trigger validation workflows. Prefer a narrowly scoped fine-grained token (Contents read/write, Pull requests read/write, Issues write) or a GitHub App token; see `docs/CONTRIBUTING.md`.
- GitHub Packages creates package visibility/access settings outside the repository workflow. Confirm the GHCR package is public if anonymous homelab pulls are desired.

## Current known limitation

- Automated and service-level tests cover simulated OAuth, viewer linking, durable push processing, persistence, retries/idempotency, and pull output. Live Trakt/AIOStreams end-to-end validation remains uncompleted until the owner configures a dedicated test account and connected instance.

## Coding-agent guidance

- `AGENTS.md` is intentionally short and task-oriented: it states durable invariants and points to detailed docs only when relevant. Keep task plans and temporary debugging recipes out of it.
- When implementation changes affect durable project knowledge, update this file with the decision or operational constraint and update the owning technical doc with details. This follows OpenAI's [Codex guidance on keeping `AGENTS.md` focused and current](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra).
