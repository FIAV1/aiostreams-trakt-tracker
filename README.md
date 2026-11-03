# AIOStreams Trakt Tracker

A self-hosted bridge between AIOStreams Watch State v2 and Trakt.tv. It stores sync state in SQLite, encrypts OAuth tokens at rest, and processes push events through a durable retry queue.

## Requirements

- Node.js 22 or Docker with Docker Compose
- A Trakt account and Trakt API application
- A private HTTPS callback URL reachable from your browser during Trakt sign-in

## Configure Trakt OAuth

Create a Trakt API application at [Trakt Developer My Apps](https://developer.trakt.tv/apps). Register the exact HTTPS callback URL used by this service, for example `https://trakt-sync.home.arpa/auth/callback`, and copy the client ID. PKCE sign-in does not need the optional client secret. Trakt no longer accepts localhost redirect URIs, so use an HTTPS hostname your browser can reach, such as a private home-network hostname behind a reverse proxy.

Create `.env` from `.env.example`, then set:

```env
PORT=3000
HOST=0.0.0.0
PUBLIC_BASE_URL=https://trakt-sync.home.arpa
TRAKT_CLIENT_ID=your_client_id
TRAKT_CLIENT_SECRET=
TRAKT_REDIRECT_URI=https://trakt-sync.home.arpa/auth/callback
# Set this to the output of: openssl rand -hex 32
TOKEN_ENCRYPTION_KEY=
DATABASE_URL=./data/trakt-sync.db
LOG_LEVEL=info
```

Generate a strong encryption key with `openssl rand -hex 32`. This creates 32 random bytes encoded as 64 hexadecimal characters. If OpenSSL is unavailable, use `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep the key stable: changing it makes existing encrypted tokens unreadable. `trakt-sync.home.arpa` is a private home-network example; configure it in your LAN DNS and provide a trusted HTTPS certificate/reverse proxy, or replace it with your own private HTTPS hostname. See [RFC 8375](https://www.rfc-editor.org/rfc/rfc8375.html).

## Run locally

```sh
npm ci
npm run dev
```

The development script reads `.env`. Open `https://trakt-sync.home.arpa/auth/login` through your private HTTPS reverse proxy to connect the default viewer. For a named AIOStreams viewer, use `/auth/login?viewer=<viewer-id>`.

`GET /health` reports service health. `GET /manifest.json` serves the Watch State v2 manifest. Pushes are accepted only for a viewer that has connected a Trakt account.

## Docker Compose

Set the same environment values in `.env`. The Compose file publishes the container port using `HOST_PORT` (default `3000`) and binds it to `HOST_BIND_IP` (default `127.0.0.1`, accessible only from the Docker host). If AIOStreams runs on another homelab machine, set `HOST_BIND_IP` to the tracker host's private LAN address and restrict access to the AIOStreams host with your firewall. Do not configure router port forwarding. For Trakt login, provide an HTTPS callback route that your browser can reach over your LAN/VPN and that matches the registered redirect URI. Trakt redirects the browser to this callback; it does not connect to the tracker directly. Then run:

```sh
docker compose up -d --build
```

SQLite data is stored in the mounted `./data` directory. Back up that directory and keep `TOKEN_ENCRYPTION_KEY` with the backup.

## AIOStreams

Install the addon using the base URL of this service. AIOStreams requests the manifest at `/manifest.json` and uses the Watch State push/pull routes. The manifest advertises viewer support.

The service supports playback progress, watched history, watchlists, and ratings. `dropped` entries are kept locally because Trakt does not provide a universal dropped-state endpoint; syncing them to a custom Trakt list is outside the current scope.

### Keep the tracker private

The tracker does not need a public endpoint if your AIOStreams instance can reach it over your LAN, VPN, or a private Docker network. With the default `HOST_BIND_IP=127.0.0.1`, only programs on the Docker host can reach the published port. To allow another homelab host, bind to the tracker's private LAN IP and use a firewall rule that permits only AIOStreams (and your browser/proxy for OAuth sign-in). A remotely hosted AIOStreams instance cannot reach a private LAN address unless you provide a private route such as a VPN. For self-hosted AIOStreams, `ALLOW_PRIVATE_URLS` permits private addon URLs; keep it disabled on a public instance because it allows requests into that server's internal network.

This app currently connects Trakt with the PKCE redirect flow. Trakt requires an HTTPS, non-localhost callback. You can keep the callback private with an internal DNS name and trusted HTTPS certificate that your browser can reach during sign-in; the tracker itself can remain inaccessible from the public internet. The tracker does need outbound internet access to call Trakt's API. See [Trakt's PKCE redirect requirements](https://developer.trakt.tv/docs/pkce) and [AIOStreams' private URL setting](https://docs.aiostreams.viren070.me/configuration/environment-variables/#network).

## Development commands

```sh
npm run typecheck
npm run build
npm test
```

See [the implementation plan](docs/IMPLEMENTATION_PLAN.md), [API mapping](docs/API_MAPPING.md), and [architecture](docs/ARCHITECTURE.md) for current scope and known gaps.
