# API Mapping

## Trakt account authorization

| Tracker operation | Trakt request | Notes |
| --- | --- | --- |
| Start login | `POST /oauth/device/code` | The tracker stores the private `device_code` server-side and shows the user code at `/auth/login?viewer=<viewer-id>`. |
| Poll login | `POST /oauth/device/token` | Poll at Trakt's returned interval until approval, denial, or expiration. The app client secret remains server-side. |
| Refresh credentials | `POST /oauth/token` | Rotates the stored refresh token; both new tokens are encrypted before persistence. |
| Disconnect | `POST /oauth/revoke` | Revokes the access token, then removes the local Trakt connection. |

This device-code flow is intended for media-center integrations and does not require a redirect URI or a callback into this tracker.

## AIOStreams Push → Trakt

Trakt write calls use the documented JSON sync/scrobble payloads. Media identifiers are forwarded from the AIOStreams event (`ids.trakt`, `ids.imdb`, `ids.tmdb`, `ids.tvdb`); Trakt resolves those identifiers when matching media.

| AIOStreams event | Trakt request | Notes |
| --- | --- | --- |
| `start` | `POST /scrobble/start` | Item plus progress percentage |
| `pause` | `POST /scrobble/pause` | Item plus progress percentage |
| `stop` | Usually `POST /scrobble/stop`; `POST /sync/history` when AIOStreams says played below Trakt's threshold | AIOStreams owns the watched decision; an unplayed stop over Trakt's automatic threshold is sent as a pause to avoid a false watched record |
| `played` | `POST /sync/history` | Movies or shows with nested season/episode data |
| `unplayed` | `POST /sync/history/remove` | Removes matching history |
| `watchlisted` | `POST /sync/watchlist` | Movies or shows |
| `unwatchlisted` | `POST /sync/watchlist/remove` | Movies or shows |
| `rated` | `POST /sync/ratings` | Ratings from 1 through 10 |
| `unrated` | `POST /sync/ratings/remove` | Removes matching ratings |
| `dropped` / `undropped` | Local SQLite state | A custom Trakt list is not configured yet |

Bulk watched/unwatched events are filtered per episode by timestamp, then eligible episodes are grouped by season into one Trakt history request. Bulk parts retain their part-suffixed event IDs for idempotency. Both extensionless and `.json` push URLs are accepted.

## Trakt → AIOStreams Pull

| Trakt endpoint | AIOStreams field | Mapping |
| --- | --- | --- |
| `GET /sync/playback` | `items` | Progress and paused timestamp; runtime is converted from minutes to milliseconds |
| `GET /sync/history` | `watched.movies`, `watched.episodes` | Movie IDs and episode IDs |
| `GET /sync/watchlist` | `watchlist` | Movie and show entries map to `type`, `kind`, `metaId`, and listing timestamp; Trakt-only season/episode watchlist entries are ignored because Watch State models movie/show favorites only |
| `GET /sync/ratings` | `ratings` | Movie/show ratings map to `type` and `metaId`; season ratings preserve `season`, and episode ratings preserve the canonical `metaId:season:episode` `videoId` |
| Local `dropped_state` | `watched.dropped` | Locally stored dropped IDs |
| `GET /sync/last_activities` | `version` | Latest Trakt activity contributes to the incremental version |

`GET /watch_state/pull` and `/watch_state/pull.json` accept `since` and `viewer`. Playback `items` are always returned; an unchanged `since` omits the version-gated `watched`, `watchlist`, and `ratings` blocks.

## Identifier handling

The service passes supported Trakt, IMDb, TMDB, and TVDB identifiers supplied in Watch State events directly to Trakt. If only `metaId` is supplied, recognized `imdb:tt...` or `provider:value` forms are converted. Trakt resolves supported external identifiers, so the addon does not need a separate lookup/cache service.
