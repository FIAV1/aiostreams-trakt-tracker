import { expect, it, describe, beforeEach, vi } from 'vitest';
import { SyncEngine } from '../../src/sync/engine.js';
import { DatabaseRepository } from '../../src/database/repository.js';
import { TraktClient } from '../../src/trakt/client.js';
import { WatchStateEvent } from '@aiostreams/addon-sdk';

describe('SyncEngine', () => {
  let db: any;
  let traktClient: any;
  let syncEngine: SyncEngine;

  beforeEach(() => {
    db = {
      getSyncEvent: vi.fn(),
      upsertMediaItem: vi.fn(),
      getMediaItem: vi.fn(),
      getPlaybackState: vi.fn(),
      upsertPlaybackState: vi.fn(),
      upsertSyncEvent: vi.fn(),
      getSyncState: vi.fn(),
      getLatestSyncEvent: vi.fn(),
    };
    traktClient = {
      scrobble: vi.fn(),
      markWatched: vi.fn(),
      markUnwatched: vi.fn(),
      updateWatchlist: vi.fn(),
      updateRating: vi.fn(),
    };
    syncEngine = new SyncEngine(db, traktClient);
  });

  it('should skip already processed events', async () => {
    const event: any = { id: 'evt1', event: 'played', metaId: 'm1', videoId: 'v1', at: new Date().toISOString() };
    db.getSyncEvent.mockResolvedValue({ status: 'processed' });

    await syncEngine.processEvent('user1', event);

    expect(db.getSyncEvent).toHaveBeenCalledWith('evt1');
    expect(traktClient.markWatched).not.toHaveBeenCalled();
  });

  it('should apply event to Trakt and update state if newer', async () => {
    const event: any = { 
      id: 'evt2', 
      event: 'played', 
      metaId: 'm1', 
      videoId: 'v1', 
      at: new Date().toISOString(),
      scope: 'movie',
      positionMs: 1000,
      durationMs: 2000
    };
    db.getSyncEvent.mockResolvedValue(null);
    db.getMediaItem.mockResolvedValue({ id: 'mi1' });
    db.getPlaybackState.mockResolvedValue(null);

    await syncEngine.processEvent('user1', event);

    expect(traktClient.markWatched).toHaveBeenCalledWith('v1', 'movie', undefined, undefined);
    expect(db.upsertPlaybackState).toHaveBeenCalled();
    expect(db.upsertSyncEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'processed' }));
  });

  it('should skip events older than current state (LAW)', async () => {
    const event: any = { 
      id: 'evt3', 
      event: 'played', 
      metaId: 'm1', 
      videoId: 'v1', 
      at: '2023-01-01T10:00:00Z',
      scope: 'movie'
    };
    db.getSyncEvent.mockResolvedValue(null);
    db.getMediaItem.mockResolvedValue({ id: 'mi1' });
    db.getPlaybackState.mockResolvedValue({ 
      sourceTimestamp: '2023-01-01T11:00:00Z',
      source: 'jellyfin' 
    });

    await syncEngine.processEvent('user1', event);

    expect(traktClient.markWatched).not.toHaveBeenCalled();
    expect(db.upsertSyncEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped' }));
  });

  it('should handle scrobble events', async () => {
    const event: any = { 
      id: 'evt4', 
      event: 'start', 
      metaId: 'm1', 
      videoId: 'v1', 
      at: new Date().toISOString(),
      scope: 'movie',
      positionMs: 500,
      durationMs: 1000
    };
    db.getSyncEvent.mockResolvedValue(null);
    db.getMediaItem.mockResolvedValue({ id: 'mi1' });
    db.getPlaybackState.mockResolvedValue(null);

    await syncEngine.processEvent('user1', event);

    expect(traktClient.scrobble).toHaveBeenCalledWith('v1', 50, 1000);
  });
});
