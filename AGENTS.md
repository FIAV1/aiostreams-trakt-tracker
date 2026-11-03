# Repository guidance for coding agents

## Purpose

This is a self-hosted AIOStreams Watch State v2 addon that synchronizes viewer-scoped playback state, watched history, watchlists, and ratings with Trakt. Preserve the existing protocol contract, data isolation, and safe retry behavior when changing the service.

## Durable invariants

- Keep each AIOStreams `viewer` isolated across authentication, persisted state, push processing, and pull responses.
- Validate Watch State events before queueing them. Preserve durable processing, retry limits, idempotency, and echo protection so retries and Trakt snapshots do not create loops or duplicate writes.
- Resolve conflicts per item using the documented Latest Action Wins rules. Keep equal-timestamp behavior deterministic.
- Use `better-sqlite3` through the repository layer with parameterized SQL. Add schema changes as transactional migrations; do not rewrite persisted history casually.
- Trakt uses OAuth Device Code Flow. The tracker needs outbound HTTPS to Trakt, but no public callback or inbound Trakt connection. Keep OAuth tokens encrypted at rest and never log credentials, tokens, encryption keys, or verification codes.
- Keep Docker runtime data under the persisted `/data` mount. The production Compose service pulls GHCR; the opt-in AIOStreams integration Compose file builds the local source and uses isolated data/network settings.

## Work by context

Read only the references relevant to the change:

- Service boundaries and protocol mapping: `docs/ARCHITECTURE.md`, `docs/API_MAPPING.md`.
- Conflict rules: `docs/SYNC_ALGORITHM.md`.
- Tables and migrations: `docs/DATABASE_SCHEMA.md`.
- Product scope and unfinished work: `docs/IMPLEMENTATION_PLAN.md`.
- Operational and historical decisions: `docs/KNOWLEDGE_BASE.md`.
- Contribution, commit, and release process: `docs/CONTRIBUTING.md`.

When a change alters durable behavior, operating assumptions, security boundaries, release steps, or an unresolved project decision, update the relevant documentation and `docs/KNOWLEDGE_BASE.md` in the same change. Keep this file concise and update it when repository-wide conventions or invariants change; do not add task-specific recipes here.

## Development and verification

- Runtime is Node.js 26 ESM, Fastify, TypeScript, SQLite via `better-sqlite3`, and the AIOStreams addon SDK.
- Install locked dependencies with `npm ci`; run `npm run dev` for local development.
- Run `npm run typecheck` and `npm test` for application changes. The Docker `test` target is the CI equivalent and also builds the production dependencies from a clean Linux install.
- Validate `docker-compose.yml` and `docker-compose.test.yml` when changing container configuration. The latter is disposable and uses `.env.test` plus `.test-data/`; never put real secrets in tracked files.
- Do not add dependencies or tests unrelated to the requested behavior. Do not claim live Trakt/AIOStreams validation unless performed with an explicitly configured test account and instance.

## Contribution and release

- Propose changes through pull requests to `main`. `docs/CONTRIBUTING.md` defines Conventional Commit pull request titles; squash merge makes that title the release input.
- Release Please uses Conventional Commits for SemVer, updates `package.json`, `package-lock.json`, and `CHANGELOG.md`, then creates a version tag and GitHub Release. GHCR production images publish only for a validated release.
- Dependabot checks npm and GitHub Actions weekly; keep its `chore(deps)` and `ci(deps)` PR title prefixes compatible with the semantic title check.
- The importable `main` ruleset is in `.github/rulesets/main-protection.json`. GitHub repository settings are not controlled by this file until an owner imports it.
- Keep the MIT license and package metadata aligned if licensing changes.
