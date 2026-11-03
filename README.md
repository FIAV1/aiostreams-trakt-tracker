# AIOStreams Trakt Tracker

[![CI](https://github.com/FIAV1/aiostreams-trakt-tracker/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/FIAV1/aiostreams-trakt-tracker/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/FIAV1/aiostreams-trakt-tracker?display_name=tag)](https://github.com/FIAV1/aiostreams-trakt-tracker/releases/latest)
[![License](https://img.shields.io/github/license/FIAV1/aiostreams-trakt-tracker)](LICENSE)

A self-hosted bridge between AIOStreams Watch State v2 and Trakt.tv. It stores sync state in SQLite, encrypts OAuth tokens at rest, and processes push events through a durable retry queue.

## Requirements

- Node.js 22 or Docker with Docker Compose
- A Trakt API application with a client ID and client secret

## Connect your Trakt account

The tracker obtains and refreshes the OAuth tokens for you. You do not need to create or paste an access token manually. First create a Trakt API app and configure the tracker with that app's credentials:

1. Sign in to [Trakt](https://trakt.tv/) and open [Trakt Developer My Apps](https://developer.trakt.tv/apps).
2. If prompted, connect and verify your GitHub account in the Developer panel. Trakt currently requires a verified GitHub account to create API apps; see [Trakt's app creation guide](https://developer.trakt.tv/docs/create-an-app).
3. Choose **Create a new API app** and create an app. Copy its **Client ID**. The tracker’s current Device Code token exchange also requires a **Client Secret**; keep it on the tracker and never enter it in AIOStreams or publish it. Trakt's current [app guide](https://developer.trakt.tv/docs/create-an-app) describes the Client ID and recommends PKCE for sign-in, while this project has not yet migrated from its existing Device Code implementation. If Trakt does not provide a client secret for your app, this version cannot complete OAuth; see the current limitation in the [implementation plan](docs/IMPLEMENTATION_PLAN.md).
4. Create `.env` from `.env.example` and set `TRAKT_CLIENT_ID`, `TRAKT_CLIENT_SECRET`, and `TOKEN_ENCRYPTION_KEY` as shown below. Generate the encryption key with `openssl rand -hex 32` (or the Node.js command below); it must stay stable across restarts because saved tokens are encrypted with it.
5. Start the tracker (see [Run locally](#run-locally) or [Docker Compose](#docker-compose)). Open `http://<tracker-host>:3000/auth/login` in a browser. For a named AIOStreams viewer, use `http://<tracker-host>:3000/auth/login?viewer=<viewer-id>`.
6. The tracker displays a one-time device code and Trakt verification link. Open the link, sign in to Trakt if asked, enter the code, and approve access. Leave the tracker login page open until it confirms the account is connected.

The tracker polls Trakt and stores the resulting access and refresh tokens encrypted in its database. Device Code Flow does not need a redirect URI, callback route, TLS certificate, or public tracker endpoint. Your browser must reach the tracker, and the tracker needs outbound internet access to Trakt. See [Trakt's OAuth guide](https://developer.trakt.tv/docs/authentication-oauth) for details about the device flow.

Create `.env` from `.env.example`, then set:

```env
PORT=3000
HOST=0.0.0.0
TRAKT_CLIENT_ID=your_client_id
TRAKT_CLIENT_SECRET=your_client_secret
# Set this to the output of: openssl rand -hex 32
TOKEN_ENCRYPTION_KEY=
DATABASE_URL=./data/trakt-sync.db
LOG_LEVEL=info
```

`openssl rand -hex 32` creates 32 random bytes encoded as 64 hexadecimal characters. If OpenSSL is unavailable, use `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep the key stable: changing it makes existing encrypted tokens unreadable.

## Run locally

```sh
npm ci
npm run dev
```

The development script reads `.env`. Open `http://<tracker-host>:3000/auth/login` in a browser to connect the default viewer. For a named AIOStreams viewer, use `/auth/login?viewer=<viewer-id>`. Enter the displayed code at Trakt's verification page; keep the login page open until it reports success.

`GET /health` reports service health. `GET /manifest.json` serves the Watch State v2 manifest. Pushes are accepted only for a viewer that has connected a Trakt account.

## Docker Compose

The Compose file pulls the production image from `ghcr.io/fiav1/aiostreams-trakt-tracker:latest`. After Conventional Commits land on `main`, Release Please opens or updates a version and changelog pull request. Merging that PR creates a SemVer tag and GitHub Release; the pipeline publishes the matching image after CI succeeds. To pin a release, set `TRACKER_IMAGE` in `.env`, for example `ghcr.io/fiav1/aiostreams-trakt-tracker:1.2.3`.

After the first successful publish, check the package's settings on GitHub. If it is private, change its visibility to **Public** so Docker hosts can pull it anonymously. Public GHCR images can be pulled without authentication. See [package visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility) and [Container Registry access](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

Set the same environment values in `.env`. The Compose file publishes the container port using `HOST_PORT` (default `3000`) and binds it to `HOST_BIND_IP` (default `127.0.0.1`, accessible only from the Docker host). If AIOStreams runs in a separate container, loopback binding will not let that container reach the tracker. Set `HOST_BIND_IP` to a private host address reachable from AIOStreams (for Docker Desktop, `host.docker.internal` resolves to the host, but the tracker still must bind to a reachable host interface) and restrict access with your firewall. If AIOStreams runs on another homelab machine, use the tracker's private LAN address and allow only that machine through the firewall. To sign in, your browser must also reach `/auth/login`; Trakt does not connect to the tracker. Do not configure router port forwarding. Docker documents that localhost-published ports are accessible only from the host; see [port publishing](https://docs.docker.com/engine/network/port-publishing/). Then run:

```sh
docker compose pull
docker compose up -d
```

SQLite data is stored in the mounted `./data` directory. Back up that directory and keep `TOKEN_ENCRYPTION_KEY` with the backup.

## Disposable AIOStreams integration stack

For hands-on end-to-end checks, the repository includes [docker-compose.test.yml](docker-compose.test.yml). It starts an isolated tracker and the official AIOStreams image on a private Compose network, stores their data under `.test-data/`, and binds browser-facing ports to `127.0.0.1` only. It does not change the normal `docker-compose.yml` stack.

Copy `.env.test.example` to `.env.test`, then set your Trakt app credentials and generate two different 64-character keys with `openssl rand -hex 32` (one for the tracker, one for AIOStreams). Start the stack:

```sh
docker compose --env-file .env.test -f docker-compose.test.yml up -d --build
```

Open `http://localhost:3002/stremio/configure` to configure the local AIOStreams instance. Add the tracker using the internal URL `http://tracker-test:3000`; both containers share a private Compose network. The test AIOStreams container allows private URLs so it can reach that service name. Open `http://localhost:3001/auth/login` in your browser to connect the default Trakt viewer. You must approve the device code on Trakt; the tracker completes token polling and storage after approval.

The test stack uses separate data directories. Stop it with `docker compose --env-file .env.test -f docker-compose.test.yml down`. To reset its stored state, stop the stack and remove `.test-data/`. Pin `AIOSTREAMS_IMAGE` in `.env.test` if you need repeatable tests across AIOStreams releases. Do not use this test configuration on a public AIOStreams instance: private URL access is enabled for the isolated local stack.

## AIOStreams

Install the addon using the base URL of this service. AIOStreams requests the manifest at `/manifest.json` and uses the Watch State push/pull routes. The manifest advertises viewer support.

The service supports playback progress, watched history, watchlists, and ratings. `dropped` entries are kept locally because Trakt does not provide a universal dropped-state endpoint; syncing them to a custom Trakt list is outside the current scope.

### Keep the tracker private

The tracker does not need a public endpoint if your AIOStreams instance can reach it over your LAN, VPN, or a private Docker network. With the default `HOST_BIND_IP=127.0.0.1`, only programs on the Docker host can reach the published port; a separate AIOStreams container needs a reachable private host address or shared Docker network. Use a firewall rule to permit only AIOStreams (and your browser for OAuth sign-in). A remotely hosted AIOStreams instance cannot reach a private LAN address unless you provide a private route such as a VPN. For self-hosted AIOStreams, `ALLOW_PRIVATE_URLS` permits private addon URLs; keep it disabled on a public instance because it allows requests into that server's internal network.

This app connects Trakt using Device Code Flow, intended for media-center and other input-constrained apps. The browser opens Trakt's own HTTPS verification page; the tracker can be served over private HTTP and remain inaccessible from the public internet. The browser and AIOStreams must be able to reach the tracker, and the tracker needs outbound HTTPS access to Trakt. See [Trakt authentication documentation](https://developer.trakt.tv/docs/authentication-oauth) and [AIOStreams' private URL setting](https://docs.aiostreams.viren070.me/configuration/environment-variables/#network).

## Development commands

```sh
npm run typecheck
npm run build
npm test
```

The Vitest suite includes unit tests and a service-level integration test that exercises simulated Trakt Device Code login and viewer linking, manifest delivery, push processing through the durable queue, SQLite persistence, duplicate-event idempotency, and pull output without contacting Trakt.

## Contributing and releases

Contributions are welcome through pull requests. See [contributing and release guidelines](docs/CONTRIBUTING.md) for Conventional Commit titles and the automated release process. The repository includes an importable [main protection ruleset](.github/rulesets/main-protection.json); import it from **Settings → Rules → Rulesets** to block direct pushes to `main` and require the `verify` check. GitHub rulesets are repository settings and do not become active just by committing the JSON file. GitHub documents [importing repository rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/managing-rulesets-for-a-repository).

Before the first main-branch update after enabling the release workflow, add the `RELEASE_PLEASE_TOKEN` Actions secret described in the contributing guide. Also check the GHCR package visibility if you want anonymous pulls.

## License

This project is licensed under the [MIT License](LICENSE).

See [the implementation plan](docs/IMPLEMENTATION_PLAN.md), [API mapping](docs/API_MAPPING.md), and [architecture](docs/ARCHITECTURE.md) for current scope and known gaps.
