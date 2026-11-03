import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { PullAnswerSchema, WatchStateEventSchema } from '@aiostreams/addon-sdk';
import type { WatchStateEvent } from '@aiostreams/addon-sdk';
import { SyncEngine } from '../sync/engine.js';
import type { DatabaseRepository } from '../database/repository.js';
import type { TraktClient } from '../trakt/client.js';
import type { SyncQueue } from '../sync/queue.js';

interface PushQuery { viewer?: string; }
interface PullQuery { since?: string; viewer?: string; }
type TraktClientFactory = (viewer: string) => Promise<TraktClient>;

function toEpoch(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  if (!value) return undefined;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : undefined;
}

function activityTimestamp(value: unknown): number {
  let latest = 0;
  const visit = (node: unknown) => {
    if (typeof node === 'string') {
      const parsed = Date.parse(node);
      if (Number.isFinite(parsed)) latest = Math.max(latest, parsed);
    } else if (node && typeof node === 'object') {
      for (const child of Object.values(node)) visit(child);
    }
  };
  visit(value);
  return latest;
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function activityFingerprint(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex').slice(0, 20);
}

export function watchStatePush(fastify: FastifyInstance, db: DatabaseRepository, queue: SyncQueue) {
  const handler = async (request: { params: { type: string; id: string }; query: PushQuery; body: unknown }, reply: any) => {
      const viewer = request.query.viewer?.trim() || 'default-user';
      const body = request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : {};
      const parsed = WatchStateEventSchema.safeParse({ ...body, scope: body.scope || request.params.type });
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid Watch State event', issues: parsed.error.issues });
      const event: WatchStateEvent = parsed.data;
      try {
        const user = await db.getUser(viewer);
        if (!user) return reply.status(404).send({ error: `Unknown viewer "${viewer}"` });
        if (!user.trakt_access_token || !user.trakt_refresh_token) {
          return reply.status(401).send({ error: `Viewer "${viewer}" must reconnect to Trakt` });
        }
        await queue.enqueue(viewer, event);
        return reply.status(204).send();
      } catch (error) {
        fastify.log.error({ err: error, viewer, eventId: event.id }, 'Watch State push could not be queued');
        return reply.status(500).send({ error: 'Watch State push could not be persisted' });
      }
  };
  fastify.post<{ Params: { type: string; id: string }; Querystring: PushQuery; Body: unknown }>('/watch_state/push/:type/:id', handler);
  fastify.post<{ Params: { type: string; id: string }; Querystring: PushQuery; Body: unknown }>('/watch_state/push/:type/:id.json', handler);
}

export function watchStatePull(fastify: FastifyInstance, db: DatabaseRepository, getTraktClient: TraktClientFactory) {
  const handler = async (request: { query: PullQuery }, reply: any) => {
    const viewer = request.query.viewer?.trim() || 'default-user';
    const since = request.query.since;
    try {
      const user = await db.getUser(viewer);
      if (!user) return reply.status(404).send({ error: `Unknown viewer "${viewer}"` });
      if (!user.trakt_access_token || !user.trakt_refresh_token) {
        return reply.status(401).send({ error: `Viewer "${viewer}" must reconnect to Trakt` });
      }
      const trakt = await getTraktClient(viewer);
      const engine = new SyncEngine(db, trakt);
      const [activity, state] = await Promise.all([trakt.getActivities(), db.getSyncState(viewer)]);
      const activityAt = activityTimestamp(activity);
      const fingerprint = activityFingerprint(activity);
      let version = await engine.getWatchedVersion(viewer, activityAt, fingerprint);

      // Fetch full snapshots only when Trakt reports new account activity.
      if (!state || state.watched_version !== fingerprint) {
        const [playback, history, watchlist, ratings] = await Promise.all([
          trakt.getPlaybackProgress(), trakt.getSyncHistory(), trakt.getWatchlist(), trakt.getRatings(),
        ]);
        await engine.syncRemoteState(viewer, playback.items, history.items, watchlist.items, ratings.items, activity);
        await db.recordTraktActivity(viewer, activityAt, fingerprint);
        version = await engine.getWatchedVersion(viewer, activityAt, fingerprint);
      }

      const [playbackItems, localItems, localWatchlist, localRatings, localDropped] = await Promise.all([
        db.listPlaybackItems(viewer), db.listPlaybackStates(viewer), db.listWatchlistState(viewer), db.listRatingState(viewer), db.listDroppedState(viewer),
      ]);
      const answer = {
        version,
        items: playbackItems.map((row: any) => ({
          type: row.type === 'movie' ? 'movie' : 'series', metaId: row.metaId, videoId: row.videoId,
          season: row.season, episode: row.episode, positionMs: row.positionMs,
          ...(row.durationMs > 0 ? { durationMs: row.durationMs, progressPercent: row.progressPercent } : {}),
          played: Boolean(row.watched), at: toEpoch(row.at),
        })),
        ...(since === version ? {} : { watched: {
          movies: [...new Set(localItems.filter((row: any) => row.type === 'movie' && row.watched).map((row: any) => row.metaId))],
          episodes: [...new Set(localItems.filter((row: any) => row.type !== 'movie' && row.watched).map((row: any) => row.videoId))],
          dropped: [...new Set(localDropped.map((row: any) => row.metaId))],
        } }),
        ...(since === version ? {} : { watchlist: localWatchlist.map((row: any) => ({
          type: row.type === 'movie' ? 'movie' : 'series', kind: row.type === 'movie' ? 'movie' : 'series',
          metaId: row.metaId, at: toEpoch(row.at),
        })) }),
        ...(since === version ? {} : { ratings: localRatings.map((row: any) => ({
          type: row.scope === 'movie' || row.type === 'movie' ? 'movie' : 'series',
          metaId: row.metaId,
          ...(row.scope === 'season' ? { season: row.season } : {}),
          ...(row.scope === 'episode' ? { videoId: `${row.metaId}:${row.season}:${row.episode}` } : {}),
          rating: row.rating, at: toEpoch(row.at),
        })) }),
      };
      const validated = PullAnswerSchema.safeParse(answer);
      if (!validated.success) {
        fastify.log.error({ issues: validated.error.issues }, 'Generated invalid Watch State pull response');
        return reply.status(500).send({ error: 'Generated an invalid Watch State response' });
      }
      return reply.send(validated.data);
    } catch (error) {
      fastify.log.error({ err: error, viewer }, 'Watch State pull failed');
      return reply.status(502).send({ error: error instanceof Error ? error.message : 'Watch State pull failed' });
    }
  };
  fastify.get<{ Querystring: PullQuery }>('/watch_state/pull', handler);
  fastify.get<{ Querystring: PullQuery }>('/watch_state/pull.json', handler);
}
