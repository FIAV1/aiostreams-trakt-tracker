import { DatabaseRepository } from '../database/repository.js';
import { TraktClient } from '../trakt/client.js';
import type { WatchStateEvent, PlaybackEvent, MarkEvent, BulkMarkEvent, ListEvent, RatingEvent } from '@aiostreams/addon-sdk';

export class SyncEngine {
  constructor(private db: DatabaseRepository, private traktClient: TraktClient) {}

  async processEvent(userId: string, event: WatchStateEvent) {
    const { event: eventType, metaId, at } = event;

    // 1. Idempotency Check
    const existingEvent = await this.db.getSyncEvent(event.id);
    if (existingEvent && existingEvent.status === 'processed') {
      console.log(`Event ${event.id} already processed. Skipping.`);
      return;
    }

    // 2. Echo Protection
    if (existingEvent && existingEvent.source === 'system') {
      console.log(`Event ${event.id} is a system-generated echo. Skipping.`);
      return;
    }

    // 3. Resolve the primary videoId for this event
    const videoId = this.resolveVideoId(event);
    if (!videoId) {
      console.log(`Event ${event.id} has no resolvable videoId. Skipping.`);
      return;
    }

    // 4. Resolve media item
    let mediaItem = await this.db.getMediaItem(videoId);
    if (!mediaItem) {
      mediaItem = await this.db.upsertMediaItem({
        id: videoId,
        mediaType: event.scope === 'movie' ? 'movie' : 'series',
        canonicalMetaId: metaId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // 5. Conflict Resolution (Latest Action Wins)
    const currentState = await this.db.getPlaybackState(userId, mediaItem.id);
    if (currentState) {
      const newTimestamp = this.parseTimestamp(at).getTime();
      const currentTimestamp = this.parseTimestamp(currentState.sourceTimestamp).getTime();

      if (newTimestamp < currentTimestamp) {
        console.log(`Conflict detected: event is older than current state. Skipping.`);
        await this.db.upsertSyncEvent({
          id: event.id,
          userId,
          mediaItemId: mediaItem.id,
          eventType,
          source: 'jellyfin',
          eventTimestamp: this.parseTimestamp(at),
          status: 'skipped',
          createdAt: new Date(),
        });
        return;
      }

      if (newTimestamp === currentTimestamp && currentState.source === 'jellyfin') {
        console.log(`Conflict detected: event timestamp equals current state (Jellyfin priority). Skipping.`);
        return;
      }
    }

    // 6. Apply event to Trakt
    try {
      await this.applyToTrakt(event, videoId);

      // 7. Update local state
      await this.db.upsertPlaybackState({
        id: `${userId}:${videoId}`,
        userId,
        mediaItemId: mediaItem.id,
        videoId,
        season: this.getSeason(event),
        episode: this.getEpisode(event),
        positionMs: this.getPositionMs(event),
        durationMs: this.getDurationMs(event),
        progressPercent: this.getProgress(event),
        watched: eventType === 'played',
        source: 'jellyfin',
        sourceTimestamp: this.parseTimestamp(at),
        updatedAt: new Date(),
      });

      await this.db.upsertSyncEvent({
        id: event.id,
        userId,
        mediaItemId: mediaItem.id,
        eventType,
        source: 'jellyfin',
        eventTimestamp: this.parseTimestamp(at),
        status: 'processed',
        createdAt: new Date(),
      });

    } catch (error) {
      console.error(`Failed to sync event ${eventType} for ${videoId}:`, error);
      await this.db.upsertSyncEvent({
        id: event.id,
        userId,
        mediaItemId: mediaItem.id,
        eventType,
        source: 'jellyfin',
        eventTimestamp: this.parseTimestamp(at),
        status: 'failed',
        lastError: error instanceof Error ? error.message : String(error),
        createdAt: new Date(),
      });
      throw error;
    }
  }

  private parseTimestamp(at: number | string): Date {
    if (typeof at === 'string') {
      return new Date(at);
    }
    // at is Unix timestamp in seconds per AIOStreams schema
    return new Date(at * 1000);
  }

  private resolveVideoId(event: WatchStateEvent): string | undefined {
    if (event.event === 'start' || event.event === 'pause' || event.event === 'stop') {
      return (event as PlaybackEvent).videoId;
    }
    if (event.event === 'played' || event.event === 'unplayed') {
      if ((event as MarkEvent).scope === 'movie' || (event as MarkEvent).scope === 'episode') {
        return (event as MarkEvent).videoId;
      }
      // Bulk event — use first video
      return (event as BulkMarkEvent).videos?.[0]?.videoId;
    }
    if (event.event === 'rated' || event.event === 'unrated') {
      return (event as RatingEvent).videoId;
    }
    // List events don't carry videoId — use metaId as fallback
    return (event as ListEvent).metaId;
  }

  private getSeason(event: WatchStateEvent): number | undefined {
    if (event.event === 'rated' || event.event === 'unrated') {
      return (event as RatingEvent).season ?? undefined;
    }
    if (event.event === 'start' || event.event === 'pause' || event.event === 'stop') {
      return (event as PlaybackEvent).season ?? undefined;
    }
    if (event.event === 'played' || event.event === 'unplayed') {
      if ((event as MarkEvent).scope === 'movie' || (event as MarkEvent).scope === 'episode') {
        return (event as MarkEvent).season ?? undefined;
      }
      return (event as BulkMarkEvent).season ?? undefined;
    }
    return undefined;
  }

  private getEpisode(event: WatchStateEvent): number | undefined {
    if (event.event === 'rated' || event.event === 'unrated') {
      return (event as RatingEvent).episode ?? undefined;
    }
    if (event.event === 'start' || event.event === 'pause' || event.event === 'stop') {
      return (event as PlaybackEvent).episode ?? undefined;
    }
    if (event.event === 'played' || event.event === 'unplayed') {
      if ((event as MarkEvent).scope === 'movie' || (event as MarkEvent).scope === 'episode') {
        return (event as MarkEvent).episode ?? undefined;
      }
      return (event as BulkMarkEvent).videos?.[0]?.episode ?? undefined;
    }
    return undefined;
  }

  private getPositionMs(event: WatchStateEvent): number {
    if (event.event === 'start' || event.event === 'pause' || event.event === 'stop') {
      return (event as PlaybackEvent).positionMs;
    }
    return 0;
  }

  private getDurationMs(event: WatchStateEvent): number {
    if (event.event === 'start' || event.event === 'pause' || event.event === 'stop') {
      return (event as PlaybackEvent).durationMs ?? 0;
    }
    return 0;
  }

  private getProgress(event: WatchStateEvent): number {
    if (event.event === 'start' || event.event === 'pause' || event.event === 'stop') {
      const pos = (event as PlaybackEvent).positionMs;
      const dur = (event as PlaybackEvent).durationMs;
      if (dur && dur > 0) {
        return (pos / dur) * 100;
      }
      return 0;
    }
    return 0;
  }

  private async applyToTrakt(event: WatchStateEvent, videoId: string): Promise<void> {
    const { event: eventType } = event;

    switch (eventType) {
      case 'start':
      case 'pause':
      case 'stop': {
        const ev = event as PlaybackEvent;
        const progress = ev.durationMs && ev.durationMs > 0 ? (ev.positionMs / ev.durationMs) * 100 : 0;
        await this.traktClient.scrobble(videoId, progress, ev.durationMs ?? 0);
        break;
      }
      case 'played': {
        if (event.scope === 'movie' || event.scope === 'episode') {
          const ev = event as MarkEvent;
          await this.traktClient.markWatched(videoId, 'movie', ev.season ?? undefined, ev.episode ?? undefined);
        } else {
          const ev = event as BulkMarkEvent;
          for (const v of ev.videos) {
            await this.traktClient.markWatched(v.videoId, 'episode', v.season ?? undefined, v.episode ?? undefined);
          }
        }
        break;
      }
      case 'unplayed': {
        if (event.scope === 'movie' || event.scope === 'episode') {
          const ev = event as MarkEvent;
          await this.traktClient.markUnwatched(videoId, 'movie', ev.season ?? undefined, ev.episode ?? undefined);
        } else {
          const ev = event as BulkMarkEvent;
          for (const v of ev.videos) {
            await this.traktClient.markUnwatched(v.videoId, 'episode', v.season ?? undefined, v.episode ?? undefined);
          }
        }
        break;
      }
      case 'watchlisted':
        await this.traktClient.updateWatchlist(videoId, event.scope === 'movie' ? 'movie' : 'show', 'add');
        break;
      case 'unwatchlisted':
        await this.traktClient.updateWatchlist(videoId, event.scope === 'movie' ? 'movie' : 'show', 'remove');
        break;
      case 'rated': {
        const ev = event as RatingEvent;
        const scope = ev.scope === 'movie' ? 'movie' : ev.scope === 'season' ? 'season' : 'episode';
        await this.traktClient.updateRating(videoId, scope, ev.rating ?? 0, ev.season ?? undefined, ev.episode ?? undefined);
        break;
      }
      case 'unrated': {
        const ev = event as RatingEvent;
        const scope = ev.scope === 'movie' ? 'movie' : ev.scope === 'season' ? 'season' : 'episode';
        await this.traktClient.updateRating(videoId, scope, null, ev.season ?? undefined, ev.episode ?? undefined);
        break;
      }
      default:
        // dropped/undropped have no direct Trakt equivalent — handled by local state only
        break;
    }
  }

  async getWatchedVersion(userId: string): Promise<string> {
    const syncState = await this.db.getSyncState(userId);
    if (!syncState) return 'v0';

    const lastEvent = await this.db.getLatestSyncEvent(userId);
    const eventTimestamp = lastEvent ? new Date(lastEvent.created_at).getTime() : 0;
    const traktTimestamp = new Date(syncState.last_trakt_activity).getTime();

    return `v${eventTimestamp}-${traktTimestamp}`;
  }

  async syncFromTrakt(userId: string) {
    const history = await this.traktClient.getSyncHistory();
    const activities = await this.traktClient.getActivities();

    const latestActivity = activities.length > 0
      ? new Date(activities[0].completed_at || activities[0].created_at)
      : new Date();

    await this.db.upsertSyncState({
      id: `sync-state:${userId}`,
      userId,
      watchedVersion: `v${Date.now()}`,
      lastTraktActivity: latestActivity,
      lastFullSync: new Date(),
      lastIncrementalSync: new Date(),
      updatedAt: new Date(),
    });

    for (const item of history.items) {
      const mediaItem = await this.db.getMediaItem(item.id) || await this.db.upsertMediaItem({
        id: item.id,
        mediaType: item.type,
        canonicalMetaId: item.metaId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const currentState = await this.db.getPlaybackState(userId, mediaItem.id);
      const traktTimestamp = new Date(item.watched_at || item.completed_at);

      if (currentState && new Date(currentState.sourceTimestamp) > traktTimestamp) {
        console.log(`Conflict detected: Trakt state for ${item.id} is older than local state. Skipping.`);
        continue;
      }

      await this.db.upsertPlaybackState({
        id: `${userId}:${mediaItem.id}`,
        userId,
        mediaItemId: mediaItem.id,
        videoId: item.id,
        season: item.season,
        episode: item.episode,
        positionMs: item.positionMs || 0,
        durationMs: item.durationMs || 0,
        progressPercent: item.progressPercent || 0,
        watched: true,
        source: 'trakt',
        sourceTimestamp: traktTimestamp,
        updatedAt: new Date(),
      });
    }
  }
}