import { ManifestSchema } from '@aiostreams/addon-sdk';

export const manifest = ManifestSchema.parse({
  id: 'com.kamehouse.trakt-sync',
  version: '1.0.0',
  name: 'AIOStreams Trakt Tracker',
  description: 'Synchronizes AIOStreams Watch State v2 with Trakt.tv',
  types: ['movie', 'series'],
  resources: [{
    name: 'watch_state',
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'tmdb:', 'tvdb:', 'trakt:'],
  }],
  behaviorHints: { configurable: false },
  watchState: {
    version: 2,
    viewers: true,
    push: {
      events: ['start', 'pause', 'stop', 'played', 'unplayed', 'watchlisted', 'unwatchlisted', 'dropped', 'undropped', 'rated', 'unrated'],
      bulk: true,
    },
    pull: { items: true, watched: true, watchlist: true, ratings: true },
  },
});
