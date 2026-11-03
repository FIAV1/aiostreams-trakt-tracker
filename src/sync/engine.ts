import type { WatchStateEvent, PlaybackEvent, BulkMarkEvent, RatingEvent } from '@aiostreams/addon-sdk';
import { DatabaseRepository } from '../database/repository.js';
import { TraktClient, type TraktMediaRef } from '../trakt/client.js';

interface EventItem { videoId: string; kind: TraktMediaRef['kind']; season?: number; episode?: number; }

function preferredId(media: any): string | undefined {
  const ids = media?.ids || {};
  if (ids.imdb) return String(ids.imdb);
  for (const key of ['tmdb', 'tvdb', 'trakt', 'slug']) if (ids[key] != null) return `${key}:${ids[key]}`;
  return undefined;
}

function identityKeys(media: any): string[] {
  const ids = media?.ids || {};
  const keys = new Set<string>();
  const preferred = preferredId(media);
  if (preferred) keys.add(preferred);
  for (const key of ['trakt', 'imdb', 'tmdb', 'tvdb', 'slug']) {
    if (ids[key] == null) continue;
    keys.add(String(ids[key]));
    keys.add(`${key}:${ids[key]}`);
  }
  return [...keys];
}

export class SyncEngine {
  constructor(private readonly db: DatabaseRepository, private readonly traktClient: TraktClient) {}

  async processEvent(userId: string, event: WatchStateEvent): Promise<void> {
    const eventKey = this.eventKey(event);
    const existing = await this.db.getSyncEvent(userId, eventKey);
    if (existing?.source === 'system') return;

    const items = this.eventItems(event);
    if (!items.length) {
      if ((event.event === 'played' || event.event === 'unplayed') && (event.scope === 'season' || event.scope === 'series')) return;
      throw new Error(`Event ${event.event} has no media item to process`);
    }
    const at = this.parseTimestamp(event.at);
    let primaryMediaId = items[0].videoId;
    let applied = 0;
    let handled = 0;
    const bulkItems: Array<{ item: EventItem; mediaItem: any; itemEventId: string }> = [];
    try {
      for (const item of items) {
        if (!item.videoId) continue;
        const itemEventId = `${eventKey}:${encodeURIComponent(item.videoId)}`;
        const priorItem = await this.db.getSyncEvent(userId, itemEventId);
        if (priorItem?.status === 'processed' || priorItem?.status === 'skipped') { handled++; continue; }
        const mediaType = item.kind === 'movie' ? 'movie' : 'series';
        const eventIds = this.mediaRef(event, item).ids;
        const mediaItem = await this.db.getMediaItem(item.videoId)
          || await this.db.getMediaItemByIdentifiers(eventIds, event.metaId, item.kind !== 'episode')
          || await this.db.upsertMediaItem({
          id: item.videoId, mediaType, canonicalMetaId: event.metaId,
          ...this.identifiers(event), createdAt: new Date(), updatedAt: new Date(),
        });
        primaryMediaId = mediaItem.id;

        const latestEvent = await this.db.getLatestMediaEvent(userId, mediaItem.id);
        const currentState = await this.db.getPlaybackState(userId, mediaItem.id);
        const currentTime = latestEvent?.event_timestamp ?? (currentState ? this.parseStoredTimestamp(currentState.sourceTimestamp).getTime() : 0);
        const currentSource = latestEvent?.source ?? currentState?.source;
        const sameTimestampEcho = at.getTime() === currentTime && this.isEcho(event, currentState, latestEvent?.event_type);
        if (at.getTime() < currentTime || (at.getTime() === currentTime && currentSource === 'jellyfin') || sameTimestampEcho) {
          await this.db.upsertSyncEvent({ id: `${userId}:${itemEventId}`, eventId: itemEventId, userId, mediaItemId: mediaItem.id,
            eventType: event.event, source: 'jellyfin', eventTimestamp: at, status: 'skipped', createdAt: new Date() });
          handled++;
          continue;
        }

        const ref = this.mediaRef(event, item);
        await this.db.upsertSyncEvent({ id: `${userId}:${itemEventId}`, eventId: itemEventId, userId, mediaItemId: mediaItem.id,
          eventType: event.event, source: 'jellyfin', eventTimestamp: at, status: 'pending', createdAt: new Date() });
        const isBulkMark = (event.event === 'played' || event.event === 'unplayed')
          && (event.scope === 'series' || event.scope === 'season');
        if (isBulkMark) {
          if (item.season == null || item.episode == null) {
            await this.db.upsertSyncEvent({ id: `${userId}:${itemEventId}`, eventId: itemEventId, userId, mediaItemId: mediaItem.id,
              eventType: event.event, source: 'jellyfin', eventTimestamp: at, status: 'skipped',
              lastError: 'Bulk episode is missing season or episode numbering', createdAt: new Date() });
            handled++;
            continue;
          }
          bulkItems.push({ item, mediaItem, itemEventId });
          continue;
        }
        await this.applyToTrakt(event, ref, at);
        await this.applyLocalState(userId, mediaItem.id, mediaType, item, event, at);
        await this.db.upsertSyncEvent({ id: `${userId}:${itemEventId}`, eventId: itemEventId, userId, mediaItemId: mediaItem.id,
          eventType: event.event, source: 'jellyfin', eventTimestamp: at, status: 'processed', createdAt: new Date(), processedAt: new Date() });
        applied++;
        handled++;
      }

      if (bulkItems.length) {
        const ref = this.mediaRef(event, bulkItems[0].item);
        await this.traktClient.markWatchedBulk(
          ref.ids,
          bulkItems.map(({ item }) => ({ season: item.season!, episode: item.episode! })),
          at,
          event.event === 'played',
        );
        for (const { item, mediaItem, itemEventId } of bulkItems) {
          await this.applyLocalState(userId, mediaItem.id, mediaItem.mediaType, item, event, at);
          await this.db.upsertSyncEvent({ id: `${userId}:${itemEventId}`, eventId: itemEventId, userId, mediaItemId: mediaItem.id,
            eventType: event.event, source: 'jellyfin', eventTimestamp: at, status: 'processed', createdAt: new Date(), processedAt: new Date() });
        }
        applied += bulkItems.length;
        handled += bulkItems.length;
      }

      await this.db.upsertSyncEvent({
        id: `${userId}:${eventKey}`, eventId: eventKey, userId, mediaItemId: primaryMediaId,
        eventType: event.event, source: 'jellyfin', eventTimestamp: at,
        status: applied || handled ? 'processed' : 'skipped', createdAt: new Date(), processedAt: new Date(),
      });
    } catch (error) {
      await this.db.upsertSyncEvent({
        id: `${userId}:${eventKey}`, eventId: eventKey, userId, mediaItemId: primaryMediaId,
        eventType: event.event, source: 'jellyfin', eventTimestamp: at, status: 'failed',
        retryCount: (existing?.retry_count ?? 0) + 1,
        lastError: error instanceof Error ? error.message : String(error), createdAt: new Date(),
      });
      throw error;
    }
  }

  private eventKey(event: WatchStateEvent) {
    const part = 'part' in event ? `:${event.part}` : '';
    return `${event.id}${part}`;
  }

  private eventItems(event: WatchStateEvent): EventItem[] {
    if (event.event === 'start' || event.event === 'pause' || event.event === 'stop') {
      const playback = event as PlaybackEvent;
      return [{ videoId: playback.videoId, kind: playback.scope === 'movie' ? 'movie' : 'episode', season: playback.season ?? undefined, episode: playback.episode ?? undefined }];
    }
    if (event.event === 'played' || event.event === 'unplayed') {
      if (event.scope === 'movie') return [{ videoId: event.videoId, kind: 'movie' }];
      if (event.scope === 'episode') return [{ videoId: event.videoId, kind: 'episode', season: event.season ?? undefined, episode: event.episode ?? undefined }];
      const bulk = event as BulkMarkEvent;
      if (!bulk.videos.length) return [];
      return bulk.videos.map(video => ({ videoId: video.videoId, kind: 'episode', season: video.season ?? bulk.season ?? undefined, episode: video.episode ?? undefined }));
    }
    if (event.event === 'rated' || event.event === 'unrated') {
      const rating = event as RatingEvent;
      const kind = rating.scope === 'movie' ? 'movie' : rating.scope === 'series' ? 'show' : rating.scope;
      const fallbackId = rating.scope === 'season' || rating.scope === 'episode'
        ? `${rating.metaId}:${rating.scope}:${rating.season ?? 0}:${rating.episode ?? 0}`
        : rating.metaId;
      return [{ videoId: rating.videoId || fallbackId, kind, season: rating.season ?? undefined, episode: rating.episode ?? undefined }];
    }
    return [{ videoId: event.metaId, kind: event.scope === 'movie' ? 'movie' : 'show' }];
  }

  private identifiers(event: WatchStateEvent): Record<string, unknown> {
    const ids: Record<string, unknown> = { ...(event.ids || {}) };
    const candidates = [event.metaId, 'videoId' in event ? event.videoId : undefined];
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue;
      const qualified = candidate.match(/^(trakt|imdb|tmdb|tvdb):(.+)$/i);
      if (qualified) ids[qualified[1].toLowerCase()] ??= qualified[2];
      else if (/^tt\d+$/i.test(candidate)) ids.imdb ??= candidate;
    }
    return { traktId: ids.trakt, imdbId: ids.imdb, tmdbId: ids.tmdb, tvdbId: ids.tvdb };
  }

  private mediaRef(event: WatchStateEvent, item: EventItem): TraktMediaRef {
    const identifiers = this.identifiers(event);
    const ids = { ...(event.ids || {}) } as Record<string, string | number>;
    const qualified = event.metaId.match(/^(trakt|imdb|tmdb|tvdb):(.+)$/i);
    if (qualified) ids[qualified[1].toLowerCase()] ??= qualified[2];
    else if (/^tt\d+$/i.test(event.metaId)) ids.imdb ??= event.metaId;
    return { kind: item.kind, ids: { ...ids, ...Object.fromEntries(Object.entries(identifiers).filter(([key, value]) => key.endsWith('Id') && value).map(([key, value]) => [key.slice(0, -2).toLowerCase(), value as string])) }, season: item.season, episode: item.episode };
  }

  private async applyToTrakt(event: WatchStateEvent, ref: TraktMediaRef, at: Date) {
    switch (event.event) {
      case 'start': case 'pause': case 'stop': {
        const playback = event as PlaybackEvent;
        const duration = playback.durationMs ?? 0;
        const progress = duration > 0 ? Math.min(100, Math.max(0, playback.positionMs / duration * 100)) : undefined;
        let scrobbleAction = event.event;
        if (event.event === 'stop' && playback.played === false && progress !== undefined && progress > 80) {
          // Trakt's stop threshold is lower than AIOStreams' default; pause to avoid a false watched record.
          scrobbleAction = 'pause';
        }
        if (duration > 0) {
          if (scrobbleAction !== 'stop' || (progress !== undefined && progress >= 1)) {
            await this.traktClient.scrobble(scrobbleAction, ref, progress!);
          }
        }
        // Stop scrobbling records history above Trakt's threshold; use an explicit history write below it.
        if (event.event === 'stop' && playback.played && (progress === undefined || progress <= 80)) {
          return this.traktClient.markWatched(ref, at);
        }
        return;
      }
      case 'played': return this.traktClient.markWatched(ref, at);
      case 'unplayed': return this.traktClient.markUnwatched(ref);
      case 'watchlisted': return this.traktClient.updateWatchlist(ref, 'add');
      case 'unwatchlisted': return this.traktClient.updateWatchlist(ref, 'remove');
      case 'rated': return this.traktClient.updateRating(ref, (event as RatingEvent).rating ?? null, at);
      case 'unrated': return this.traktClient.updateRating(ref, null);
      case 'dropped': case 'undropped': return;
    }
  }

  private async applyLocalState(userId: string, mediaItemId: string, mediaType: string, item: EventItem, event: WatchStateEvent, at: Date) {
    if (event.event === 'watchlisted' || event.event === 'unwatchlisted') {
      await this.db.setWatchlistState(userId, mediaItemId, at, event.event === 'watchlisted');
      return;
    }
    if (event.event === 'rated' || event.event === 'unrated') {
      await this.db.setRatingState(userId, mediaItemId, event.event === 'rated' ? (event as RatingEvent).rating ?? null : null, at);
      return;
    }
    if (event.event === 'dropped' || event.event === 'undropped') {
      await this.db.setDroppedState(userId, mediaItemId, at, event.event === 'dropped');
      return;
    }

    const playback = ['start', 'pause', 'stop'].includes(event.event) ? event as PlaybackEvent : undefined;
    const current = await this.db.getPlaybackState(userId, mediaItemId);
    await this.db.upsertPlaybackState({
      id: `${userId}:${item.videoId}`, userId, mediaItemId, videoId: item.videoId,
      season: item.season, episode: item.episode,
      positionMs: playback?.positionMs ?? 0, durationMs: playback?.durationMs ?? 0,
      progressPercent: playback?.durationMs ? Math.min(100, playback.positionMs / playback.durationMs * 100) : 0,
      watched: event.event === 'played' ? true : event.event === 'unplayed' ? false : playback?.played ?? Boolean(current?.watched),
      source: 'jellyfin', sourceTimestamp: at, updatedAt: new Date(), mediaType,
    });
  }

  private parseTimestamp(at: number | string): Date {
    if (typeof at === 'number') return new Date(at < 1e12 ? at * 1000 : at);
    const parsed = new Date(at);
    if (!Number.isFinite(parsed.getTime())) throw new Error(`Invalid event timestamp: ${at}`);
    return parsed;
  }
  private parseStoredTimestamp(value: Date | number | string): Date {
    if (value instanceof Date) return value;
    const parsed = typeof value === 'number' ? new Date(value) : new Date(value);
    if (!Number.isFinite(parsed.getTime())) return new Date(0);
    return parsed;
  }

  private isEcho(event: WatchStateEvent, state: any, latestEventType?: string): boolean {
    if (!latestEventType?.startsWith('trakt_')) return false;
    switch (event.event) {
      case 'played': return latestEventType === 'trakt_watched' && Boolean(state?.watched);
      case 'unplayed': return latestEventType === 'trakt_unwatched' && !state?.watched;
      case 'watchlisted': return latestEventType === 'trakt_watchlisted';
      case 'unwatchlisted': return latestEventType === 'trakt_unwatchlisted';
      case 'rated': return latestEventType === 'trakt_rated';
      case 'unrated': return latestEventType === 'trakt_unrated';
      case 'start': case 'pause': case 'stop': {
        if (latestEventType !== 'trakt_playback' || !state) return false;
        const playback = event as PlaybackEvent;
        return Math.abs(Number(state.positionMs) - playback.positionMs) < 1000;
      }
      default: return false;
    }
  }

  /** Merge Trakt snapshots into local state so later Jellyfin pushes can apply LAW per item. */
  async syncRemoteState(userId: string, playback: any[], history: any[], watchlist: any[], ratings: any[], activity: any) {
    const remoteWatched = new Set<string>();
    for (const entry of playback) {
      const movie = entry.movie;
      const show = entry.show;
      const episode = entry.episode;
      const isMovie = entry.type === 'movie' || Boolean(movie);
      const media = isMovie ? movie : show;
      const metaId = preferredId(media);
      const videoId = isMovie ? metaId : preferredId(episode) || (metaId && episode ? `${metaId}:s${episode.season}e${episode.number}` : undefined);
      const at = this.remoteTimestamp(entry.paused_at);
      if (!metaId || !videoId || !at) continue;
      const progress = Number(entry.progress ?? 0);
      const runtime = Number(isMovie ? movie?.runtime : episode?.runtime);
      await this.mergeRemoteItem(userId, {
        videoId, metaId, mediaType: isMovie ? 'movie' : 'series', season: episode?.season, episode: episode?.number,
        positionMs: runtime > 0 ? runtime * 60_000 * progress / 100 : 0,
        durationMs: runtime > 0 ? runtime * 60_000 : 0, progressPercent: progress, watched: false, at,
        ids: episode?.ids || media?.ids, includeCanonical: isMovie || !episode,
      }, 'trakt_playback');
    }

    for (const entry of history) {
      const movie = entry.movie;
      const show = entry.show;
      const episode = entry.episode;
      const isMovie = Boolean(movie);
      const media = isMovie ? movie : show;
      const metaId = preferredId(media);
      const videoId = isMovie ? metaId : preferredId(episode) || (metaId && episode ? `${metaId}:s${episode.season}e${episode.number}` : undefined);
      const at = this.remoteTimestamp(entry.watched_at);
      if (!metaId || !videoId || !at) continue;
      remoteWatched.add(videoId);
      for (const key of identityKeys(isMovie ? movie : episode)) remoteWatched.add(key);
      await this.mergeRemoteItem(userId, {
        videoId, metaId, mediaType: isMovie ? 'movie' : 'series', season: episode?.season, episode: episode?.number,
        positionMs: 0, durationMs: 0, progressPercent: 0, watched: true, at,
        ids: episode?.ids || media?.ids, includeCanonical: isMovie || !episode,
      }, 'trakt_watched');
    }

    const localPlayback = await this.db.listPlaybackStates(userId);
    for (const state of localPlayback) {
      if (!state.watched || remoteWatched.has(state.videoId)) continue;
      const activityAt = this.latestActivityDate(activity, state.type === 'movie'
        ? [['movies', 'watched_at']]
        : [['episodes', 'watched_at']]);
      if (!activityAt) continue;
      const media = await this.db.getMediaItem(state.videoId);
      if (!media) continue;
      const latest = await this.db.getLatestMediaEvent(userId, media.id);
      const currentTimestamp = latest?.event_timestamp ?? Number(state.at);
      if (activityAt.getTime() <= currentTimestamp) continue;
      await this.db.upsertPlaybackState({
        id: `${userId}:${state.videoId}`, userId, mediaItemId: media.id, videoId: state.videoId,
        season: state.season, episode: state.episode, positionMs: state.positionMs, durationMs: state.durationMs,
        progressPercent: state.progressPercent, watched: false, source: 'trakt', sourceTimestamp: activityAt, updatedAt: new Date(),
      });
      await this.recordRemoteEvent(userId, media.id, `trakt:unwatched:${state.videoId}:${activityAt.getTime()}`, 'trakt_unwatched', activityAt);
    }

    for (const entry of watchlist) {
      const object = entry.movie || entry.show || entry.season || entry.episode;
      const metaId = preferredId(object);
      const at = this.remoteTimestamp(entry.listed_at);
      if (!metaId || !at) continue;
      const videoId = metaId;
      const mediaType = entry.type === 'movie' || entry.movie ? 'movie' : 'series';
      const media = await this.ensureMediaItem(userId, videoId, metaId, mediaType, object?.ids, true);
      const latest = await this.db.getLatestMediaEvent(userId, media.id);
      if (latest && (at.getTime() < latest.event_timestamp || (at.getTime() === latest.event_timestamp && latest.source === 'jellyfin'))) continue;
      await this.db.setWatchlistState(userId, media.id, at, true);
      await this.recordRemoteEvent(userId, media.id, `trakt:watchlist:${videoId}:${at.getTime()}`, 'trakt_watchlisted', at);
    }

    const remoteWatchlist = new Set(watchlist.flatMap(entry => identityKeys(entry.movie || entry.show || entry.season || entry.episode)));
    for (const local of await this.db.listWatchlistState(userId)) {
      if (remoteWatchlist.has(local.metaId)) continue;
      const activityAt = this.latestActivityDate(activity, local.type === 'movie'
        ? [['watchlist', 'movies'], ['movies', 'watchlisted_at']]
        : [['watchlist', 'shows'], ['shows', 'watchlisted_at']]);
      if (!activityAt) continue;
      const latest = await this.db.getLatestMediaEvent(userId, local.mediaItemId);
      if (!latest || activityAt.getTime() <= latest.event_timestamp) continue;
      await this.db.setWatchlistState(userId, local.mediaItemId, activityAt, false);
      await this.recordRemoteEvent(userId, local.mediaItemId, `trakt:unwatchlisted:${local.metaId}:${activityAt.getTime()}`, 'trakt_unwatchlisted', activityAt);
    }

    for (const entry of ratings) {
      const object = entry.movie || entry.show || entry.season || entry.episode;
      const metaId = preferredId(entry.show || object);
      const at = this.remoteTimestamp(entry.rated_at);
      if (!metaId || !at || typeof entry.rating !== 'number') continue;
      const scopedId = entry.season?.number != null
        ? `${metaId}:season:${entry.season.number}`
        : entry.episode?.ids ? preferredId(entry.episode) : metaId;
      if (!scopedId) continue;
      const mediaType = entry.type === 'movie' || entry.movie ? 'movie' : 'series';
      const media = await this.ensureMediaItem(userId, scopedId, metaId, mediaType, object?.ids, !entry.episode);
      const latest = await this.db.getLatestMediaEvent(userId, media.id);
      if (latest && (at.getTime() < latest.event_timestamp || (at.getTime() === latest.event_timestamp && latest.source === 'jellyfin'))) continue;
      await this.db.setRatingState(userId, media.id, entry.rating, at);
      await this.recordRemoteEvent(userId, media.id, `trakt:rating:${scopedId}:${at.getTime()}`, 'trakt_rated', at);
    }

    const remoteRatings = new Set(ratings.flatMap(entry => identityKeys(entry.show || entry.movie || entry.season || entry.episode)));
    for (const local of await this.db.listRatingState(userId)) {
      if (remoteRatings.has(local.metaId)) continue;
      const activityAt = this.latestActivityDate(activity, local.type === 'movie'
        ? [['ratings', 'movies'], ['movies', 'rated_at']]
        : [['ratings', 'shows'], ['shows', 'rated_at'], ['ratings', 'seasons'], ['ratings', 'episodes']]);
      if (!activityAt) continue;
      const latest = await this.db.getLatestMediaEvent(userId, local.mediaItemId);
      if (!latest || activityAt.getTime() <= latest.event_timestamp) continue;
      await this.db.setRatingState(userId, local.mediaItemId, null, activityAt);
      await this.recordRemoteEvent(userId, local.mediaItemId, `trakt:unrated:${local.metaId}:${activityAt.getTime()}`, 'trakt_unrated', activityAt);
    }
  }

  private latestActivityDate(activity: any, paths: string[][]): Date | undefined {
    const found: Date[] = [];
    const scan = (value: unknown) => {
      if (Array.isArray(value)) { for (const item of value) scan(item); return; }
      const date = this.remoteTimestamp(value);
      if (date) { found.push(date); return; }
      if (value && typeof value === 'object') for (const nested of Object.values(value)) scan(nested);
    };
    for (const path of paths) {
      let value = activity;
      for (const part of path) value = value?.[part];
      scan(value);
    }
    return found.sort((a, b) => b.getTime() - a.getTime())[0];
  }

  private remoteTimestamp(value: unknown): Date | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const date = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
    return Number.isFinite(date.getTime()) ? date : undefined;
  }

  private async ensureMediaItem(_userId: string, videoId: string, metaId: string, mediaType: string, ids: Record<string, unknown> = {}, includeCanonical = true) {
    return await this.db.getMediaItem(videoId)
      || await this.db.getMediaItemByIdentifiers(ids, metaId, includeCanonical)
      || await this.db.upsertMediaItem({
      id: videoId, mediaType, canonicalMetaId: metaId,
      traktId: ids.trakt, imdbId: ids.imdb, tmdbId: ids.tmdb, tvdbId: ids.tvdb,
      createdAt: new Date(), updatedAt: new Date(),
    });
  }

  private async mergeRemoteItem(userId: string, item: any, eventType: string) {
    const media = await this.ensureMediaItem(userId, item.videoId, item.metaId, item.mediaType, item.ids, item.includeCanonical);
    const latest = await this.db.getLatestMediaEvent(userId, media.id);
    if (latest && (item.at.getTime() < latest.event_timestamp || (item.at.getTime() === latest.event_timestamp && latest.source === 'jellyfin'))) return;
    await this.db.upsertPlaybackState({
      id: `${userId}:${item.videoId}`, userId, mediaItemId: media.id, videoId: item.videoId,
      season: item.season, episode: item.episode, positionMs: item.positionMs, durationMs: item.durationMs,
      progressPercent: item.progressPercent, watched: item.watched, source: 'trakt', sourceTimestamp: item.at, updatedAt: new Date(),
    });
    await this.recordRemoteEvent(userId, media.id, `trakt:${eventType}:${item.videoId}:${item.at.getTime()}`, eventType, item.at);
  }

  private async recordRemoteEvent(userId: string, mediaItemId: string, eventId: string, eventType: string, at: Date) {
    await this.db.upsertSyncEvent({
      id: `${userId}:${eventId}`, eventId, userId, mediaItemId, eventType, source: 'trakt', eventTimestamp: at,
      status: 'processed', createdAt: new Date(), processedAt: new Date(),
    });
  }

  async getWatchedVersion(userId: string, traktActivity = 0, activityFingerprint = ''): Promise<string> {
    const [syncState, lastEvent] = await Promise.all([this.db.getSyncState(userId), this.db.getLatestSyncEvent(userId)]);
    const latestTraktActivity = Math.max(traktActivity, syncState?.last_trakt_activity ?? 0);
    if (!latestTraktActivity && !lastEvent && !activityFingerprint) return 'v0';
    return `v${lastEvent?.created_at ?? 0}-${lastEvent?.event_id ?? ''}-${latestTraktActivity}-${activityFingerprint}`;
  }
}
