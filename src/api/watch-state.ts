import type { FastifyInstance } from 'fastify';
import { SyncEngine } from '../sync/engine.js';
import { DatabaseRepository } from '../database/repository.js';
import { TraktClient } from '../trakt/client.js';
import type { TraktConfig } from '../trakt/config.js';

export async function watchStatePush(fastify: FastifyInstance, db: DatabaseRepository, traktClient: TraktClient, config: TraktConfig) {
  fastify.post('/watch_state/push/:type/:id', async (request, reply) => {
    const { type, id } = request.params as any;
    const event = request.body as any;
    const viewer = request.query.viewer as string || undefined;

    try {
      const syncEngine = new SyncEngine(db, traktClient);
      await syncEngine.processEvent(viewer, event);
      return reply.send({ success: true });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: error.message });
    }
  });
}

export async function watchStatePull(fastify: FastifyInstance, db: DatabaseRepository, traktClient: TraktClient, config: TraktConfig) {
  fastify.get('/watch_state/pull', async (request, reply) => {
    const since = request.query.since as string || '0';
    const viewer = request.query.viewer as string || 'default-user';

    try {
      const syncEngine = new SyncEngine(db, traktClient);
      const version = await syncEngine.getWatchedVersion(viewer);

      if (since === version) {
        // Omit watched block if version matches
        const playback = await traktClient.getPlaybackProgress();
        const items = playback.items.map((item: any) => ({
          type: item.type,
          metaId: item.metaId,
          videoId: item.videoId,
          season: item.season,
          episode: item.episode,
          progressPercent: item.progressPercent,
          positionMs: item.positionMs,
          durationMs: item.durationMs,
          played: item.watched,
          at: item.timestamp,
        }));

        return reply.send({
          version,
          items,
        });
      }

      // Full sync
      const playback = await traktClient.getPlaybackProgress();
      const items = playback.items.map((item: any) => ({
        type: item.type,
        metaId: item.metaId,
        videoId: item.videoId,
        season: item.season,
        episode: item.episode,
        progressPercent: item.progressPercent,
        positionMs: item.positionMs,
        durationMs: item.durationMs,
        played: item.watched,
        at: item.timestamp,
      }));

      const history = await traktClient.getSyncHistory();
      const watched = {
        movies: history.items.filter((i: any) => i.type === 'movie').map((m: any) => ({
          metaId: m.metaId,
          at: m.timestamp,
        })),
        episodes: history.items.filter((i: any) => i.type === 'episode').map((e: any) => ({
          metaId: e.metaId,
          videoId: e.videoId,
          season: e.season,
          episode: e.episode,
          at: e.timestamp,
        })),
      };

      const watchlist = await traktClient.getWatchlist();
      const watchlistItems = watchlist.items.map((item: any) => ({
        type: item.type,
        metaId: item.metaId,
        at: item.timestamp,
      }));

      const ratings = await traktClient.getRatings();
      const ratingsItems = ratings.items.map((item: any) => ({
        type: item.type,
        metaId: item.metaId,
        rating: item.rating,
        at: item.timestamp,
      }));

      return reply.send({
        version,
        items,
        watched,
        watchlist: watchlistItems,
        ratings: ratingsItems,
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: error.message });
    }
  });
}
