import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WatchStateEvent } from '@aiostreams/addon-sdk';
import { SyncEngine } from '../../src/sync/engine.js';

describe('SyncEngine.processEvent', () => {
  let db: any;
  let trakt: any;
  let engine: SyncEngine;

  beforeEach(() => {
    db = {
      getSyncEvent: vi.fn().mockResolvedValue(undefined),
      getMediaItem: vi.fn().mockResolvedValue({ id: 'video-1', mediaType: 'movie' }),
      getMediaItemByIdentifiers: vi.fn().mockResolvedValue(undefined),
      upsertMediaItem: vi.fn(),
      getLatestMediaEvent: vi.fn().mockResolvedValue(undefined),
      getPlaybackState: vi.fn().mockResolvedValue(undefined),
      upsertPlaybackState: vi.fn().mockResolvedValue(undefined),
      upsertSyncEvent: vi.fn().mockResolvedValue(undefined),
      setWatchlistState: vi.fn(),
      setRatingState: vi.fn(),
      setDroppedState: vi.fn(),
    };
    trakt = {
      markWatched: vi.fn().mockResolvedValue(undefined),
      markWatchedBulk: vi.fn().mockResolvedValue(undefined),
      markUnwatched: vi.fn().mockResolvedValue(undefined),
      scrobble: vi.fn().mockResolvedValue(undefined),
      updateWatchlist: vi.fn().mockResolvedValue(undefined),
      updateRating: vi.fn().mockResolvedValue(undefined),
    };
    engine = new SyncEngine(db, trakt);
  });

  const playedEvent = (overrides: Record<string, unknown> = {}) => ({
    id: 'event-1', event: 'played', scope: 'movie', videoId: 'video-1', metaId: 'imdb:tt1234567',
    ids: { imdb: 'tt1234567' }, at: 1_800_000_000_000, ...overrides,
  }) as WatchStateEvent;

  it('sends a valid played event to Trakt and persists local state', async () => {
    await engine.processEvent('viewer-a', playedEvent());

    expect(trakt.markWatched).toHaveBeenCalledWith(
      { kind: 'movie', ids: { imdb: 'tt1234567' }, season: undefined, episode: undefined },
      new Date(1_800_000_000_000),
    );
    expect(db.upsertPlaybackState).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'viewer-a', mediaItemId: 'video-1', watched: true, source: 'jellyfin',
    }));
    expect(db.upsertSyncEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'processed', source: 'jellyfin' }));
  });

  it('skips a duplicate item event without writing to Trakt again', async () => {
    db.getSyncEvent.mockImplementation(async (_viewer: string, eventId: string) =>
      eventId === 'event-1:video-1' ? { status: 'processed' } : undefined);

    await engine.processEvent('viewer-a', playedEvent());

    expect(trakt.markWatched).not.toHaveBeenCalled();
    expect(db.getSyncEvent).toHaveBeenNthCalledWith(1, 'viewer-a', 'event-1');
    expect(db.getSyncEvent).toHaveBeenNthCalledWith(2, 'viewer-a', 'event-1:video-1');
  });

  it('skips an older event than the latest processed event', async () => {
    db.getLatestMediaEvent.mockResolvedValue({
      event_timestamp: 1_800_000_001_000, source: 'trakt', event_type: 'trakt_watched',
    });

    await engine.processEvent('viewer-a', playedEvent({ at: 1_800_000_000_000 }));

    expect(trakt.markWatched).not.toHaveBeenCalled();
    expect(db.upsertSyncEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped' }));
  });

  it('lets Jellyfin win a timestamp tie with Trakt', async () => {
    db.getLatestMediaEvent.mockResolvedValue({
      event_timestamp: 1_800_000_000_000, source: 'trakt', event_type: 'trakt_watched',
    });

    await engine.processEvent('viewer-a', playedEvent());

    expect(trakt.markWatched).toHaveBeenCalledOnce();
    expect(db.upsertPlaybackState).toHaveBeenCalledOnce();
  });

  it('records stop events as watched when AIOStreams reports played=true', async () => {
    const event = playedEvent({ event: 'stop', positionMs: 900_000, durationMs: 1_000_000, played: true });

    await engine.processEvent('viewer-a', event);

    expect(trakt.scrobble).toHaveBeenCalledWith('stop', expect.any(Object), 90);
    expect(trakt.markWatched).not.toHaveBeenCalled();
  });

  it('writes history explicitly when AIOStreams reports played below Trakt’s scrobble threshold', async () => {
    const event = playedEvent({ event: 'stop', positionMs: 700_000, durationMs: 1_000_000, played: true });

    await engine.processEvent('viewer-a', event);

    expect(trakt.scrobble).toHaveBeenCalledWith('stop', expect.any(Object), 70);
    expect(trakt.markWatched).toHaveBeenCalledOnce();
  });

  it('prevents Trakt from auto-marking an AIOStreams-unplayed stop above Trakt’s threshold', async () => {
    const event = playedEvent({ event: 'stop', positionMs: 900_000, durationMs: 1_000_000, played: false });

    await engine.processEvent('viewer-a', event);

    expect(trakt.scrobble).toHaveBeenCalledWith('pause', expect.any(Object), 90);
    expect(trakt.markWatched).not.toHaveBeenCalled();
  });

  it('does not send a fabricated zero-progress scrobble when duration is unknown', async () => {
    const event = playedEvent({ event: 'pause', positionMs: 120_000, durationMs: undefined });

    await engine.processEvent('viewer-a', event);

    expect(trakt.scrobble).not.toHaveBeenCalled();
    expect(db.upsertPlaybackState).toHaveBeenCalledWith(expect.objectContaining({ positionMs: 120_000, durationMs: 0 }));
  });

  it('does not let one viewer’s event record suppress another viewer', async () => {
    await engine.processEvent('viewer-a', playedEvent());
    await engine.processEvent('viewer-b', playedEvent());

    expect(db.getSyncEvent).toHaveBeenNthCalledWith(1, 'viewer-a', 'event-1');
    expect(db.getSyncEvent).toHaveBeenNthCalledWith(3, 'viewer-b', 'event-1');
    expect(trakt.markWatched).toHaveBeenCalledTimes(2);
  });

  it('persists dropped state locally without making an unsupported Trakt write', async () => {
    await engine.processEvent('viewer-a', playedEvent({ event: 'dropped', scope: 'movie' }));

    expect(db.setDroppedState).toHaveBeenCalledWith('viewer-a', 'video-1', new Date(1_800_000_000_000), true);
    expect(trakt.markWatched).not.toHaveBeenCalled();
    expect(trakt.updateWatchlist).not.toHaveBeenCalled();
  });

  it('sends a bulk season mark in one Trakt history request', async () => {
    const event = {
      id: 'bulk-1', event: 'played', scope: 'season', season: 1, part: 1, parts: 1,
      metaId: 'tt1234567', ids: { imdb: 'tt1234567' }, at: 1_800_000_000_000,
      videos: [
        { videoId: 'tt1234567:1:1', season: 1, episode: 1 },
        { videoId: 'tt1234567:1:2', season: 1, episode: 2 },
      ],
    } as WatchStateEvent;

    await engine.processEvent('viewer-a', event);

    expect(trakt.markWatchedBulk).toHaveBeenCalledOnce();
    expect(trakt.markWatchedBulk).toHaveBeenCalledWith(
      { imdb: 'tt1234567' },
      [{ season: 1, episode: 1 }, { season: 1, episode: 2 }],
      new Date(1_800_000_000_000),
      true,
    );
    expect(db.upsertPlaybackState).toHaveBeenCalledTimes(2);
  });
});
