# Agents Guide: AIOStreams Trakt Tracker

This document provides essential information for the development and maintenance of the AIOStreams Trakt Tracker addon.

## Project Overview

The AIOStreams Trakt Tracker is a self-hosted integration service that synchronizes viewing activity between Jellyfin and Trakt.tv using the AIOStreams Watch State v2 protocol.

### Core Objectives
- Bidirectional synchronization of playback progress, watched status, watchlists, and ratings.
- Implementation of the "Latest Action Wins" (LAW) conflict resolution strategy.
- High reliability and idempotency to prevent synchronization loops.

## Technical Architecture

### Tech Stack
- **Runtime**: Node.js (ESM)
- **Framework**: Fastify
- **Database**: SQLite (via `sqlite` and `sqlite3`)
- **Protocol**: AIOStreams Watch State v2
- **External API**: Trakt REST API (OAuth 2.0 PKCE)

### Key Components
- `TraktClient`: Handles all communication with the Trakt API, including pagination and rate limiting.
- `SyncEngine`: The core logic for processing events, resolving conflicts, and managing the synchronization flow.
- `DatabaseRepository`: Manages persistence for media items, playback states, and synchronization events.
- `WatchStateAPI`: Implements the AIOStreams protocol endpoints (push/pull).

## Development Guide

### Local Development
1. Install dependencies: `npm install`
2. Set up environment variables using `.env.example`.
3. Run in development mode: `npm run dev`
4. Run typecheck: `npm run typecheck`

### Testing
- Unit tests are located in `tests/unit/`.
- Run tests using: `npx vitest run`

### Adding New Features
1. Update the `API_MAPPING.md` if new Trakt endpoints are needed.
2. Implement the logic in `TraktClient` or `SyncEngine`.
3. Add corresponding tests in `tests/unit/`.
4. Update the AIOStreams manifest in `src/index.ts` if protocol capabilities change.

## Maintenance and Troubleshooting

### Common Issues
- **Native Dependencies**: `sqlite3` requires build tools. Use the provided Docker configuration for consistent builds.
- **OAuth Tokens**: Ensure `TOKEN_ENCRYPTION_KEY` is consistent across restarts to avoid token decryption failures.
- **Sync Loops**: Check `src/sync/engine.ts` for echo protection logic if loops are detected.

### Deployment
The project is designed to be deployed via Docker Compose. Ensure the `/data` volume is persisted to keep the SQLite database.

## Protocol Reference
- AIOStreams Watch State v2: [https://docs.aiostreams.viren070.me/reference/addon-protocol/watch-state/](https://docs.aiostreams.viren070.me/reference/addon-protocol/watch-state/)
- Trakt API: [https://developer.trakt.tv/](https://developer.trakt.tv/)
