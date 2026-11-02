# API Mapping

## AIOStreams Push -> Trakt API

| AIOStreams Event | Trakt API Endpoint | Operation | Notes |
| :--- | :--- | :--- | :--- |
| `start` | `/scrobbles` | POST | Start scrobbling |
| `pause` | `/scrobbles` | POST | Pause scrobbling |
| `stop` | `/scrobbles` | POST | Stop scrobbling |
| `played` | `/sync/history` | POST | Add to watched history |
| `unplayed` | `/sync/history` | DELETE | Remove from watched history |
| `watchlisted` | `/sync/watchlist` | POST | Add to watchlist |
| `unwatchlisted` | `/sync/watchlist` | DELETE | Remove from watchlist |
| `rated` | `/sync/ratings` | POST | Set rating |
| `unrated` | `/sync/ratings` | DELETE | Remove rating |
| `dropped` | Custom List | POST | Add to "Dropped" custom list |
| `undropped` | Custom List | DELETE | Remove from "Dropped" custom list |

## Trakt API -> AIOStreams Pull

| Trakt API Endpoint | AIOStreams Field | Mapping Logic |
| :--- | :--- | :--- |
| `/sync/playback` | `items` | Map progress percentage to `positionMs` |
| `/sync/history` | `watched` | Map Trakt history to `movies` and `episodes` |
| `/sync/watchlist` | `watchlist` | Map Trakt watchlist to `type`, `metaId`, `at` |
| `/sync/ratings` | `ratings` | Map Trakt ratings to `type`, `metaId`, `rating`, `at` |
| Custom List | `dropped` | Map custom list members to `dropped` array |

## Identifier Resolution

| Source ID | Trakt Resolution | Priority |
| :--- | :--- | :--- |
| IMDb ID (`tt...`) | `/search/movie` or `/search/show` | 1 |
| TMDB ID | `/search/movie` or `/search/show` | 2 |
| TVDB ID | `/search/movie` or `/search/show` | 3 |
| Trakt ID | Direct lookup | 4 |
