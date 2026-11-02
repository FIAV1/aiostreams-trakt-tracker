# AIOStreams Trakt Sync

A bidirectional synchronization bridge between Jellyfin (via AIOStreams Watch State v2 protocol) and Trakt.tv.

## Features

- **Bidirectional Sync**: Synchronize playback progress, watched history, watchlists, and ratings.
- **Latest Action Wins**: Conflict resolution ensures the most recent user action is preserved.
- **OAuth 2.0 PKCE**: Secure authentication with Trakt.tv.
- **AIOStreams Protocol**: Full implementation of the Watch State v2 protocol.
- **Dockerized**: Easy deployment with Docker Compose.

## Prerequisites

- [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose/)
- A Trakt.tv account
- A Trakt API Application (Client ID and Redirect URI)

## Installation & Setup

### 1. Trakt API Application
1. Go to [Trakt API Apps](https://trakt.tv/oauth/applications).
2. Create a new application.
3. Set the **Redirect URI** to `https://your-domain.com/auth/callback` (replace `your-domain.com` with your actual domain).
4. Note your **Client ID**.

### 2. Configuration
Create a `.env` file in the root directory:

```env
# Server Configuration
PORT=3000
PUBLIC_BASE_URL=https://your-domain.com

# Trakt API Configuration
TRAKT_CLIENT_ID=your_trakt_client_id
TRAKT_REDIRECT_URI=https://your-domain.com/auth/callback

# Security
# Generate a random 32-character string for the encryption key
TOKEN_ENCRYPTION_KEY=your_random_32_char_key

# Database
DATABASE_URL=/data/trakt-sync.db
```

### 3. Deployment
Run the application using Docker Compose:

```bash
docker-compose up -d --build
```

## AIOStreams Configuration

Add the following addon to your AIOStreams configuration:

```json
{
  "id": "com.kamehouse.trakt-sync",
  "url": "https://your-domain.com"
}
```

## Authentication

1. Once the service is running, navigate to `https://your-domain.com/auth/login`.
2. Follow the prompts to authorize the application with your Trakt account.
3. After successful authorization, your account will be linked.

## Architecture

The service is built with:
- **Node.js 22** & **TypeScript**
- **Fastify** (Web Framework)
- **SQLite** (Persistence)
- **Trakt REST API** (Upstream Provider)

For more details, see the [Architecture Documentation](docs/ARCHITECTURE.md).

## License

MIT
