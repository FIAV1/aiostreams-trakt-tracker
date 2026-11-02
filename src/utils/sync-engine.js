import { WatchStateEvent, type Addon } from '@aiostreams/addon-sdk';
import { FastifyInstance } from 'fastify';
import { FileStorage } from '../utils/storage.js';

export class FileBasedSyncEngine {
  private storage: FileStorage;

  constructor(storagePath: string) {
    this.storage = new FileStorage(storagePath);
  }

  async processEvent(event: WatchStateEvent, viewer: string): Promise<void> {
    const eventId = `${event.at}-${event.metaId}-${event.videoId}`;
    const filePath = `${this.storage.storagePath}/events/${eventId}.json`;

    // Check if event already processed (idempotency)
    const existing = await this.storage.readFile(filePath);
    if (existing) {
      console.log(`Event already processed: ${eventId}`);
      return;
    }

    // Process event (implement your business logic here)
    console.log(`Processing event: ${event.event} for ${event.videoId} (viewer: ${viewer})`);

    // Save event
    await this.storage.writeFile(filePath, {
      ...event,
      processedAt: new Date().toISOString(),
      viewer,
      status: 'processed',
    });
  }

  async getPlaybackItems(): Promise<any[]> {
    const items = await this.storage.readFile<any[]>(
      `${this.storage.storagePath}/playback-items.json`
    );
    return items || [];
  }

  async getWatchedHistory(): Promise<any> {
    const history = await this.storage.readFile<any>(
      `${this.storage.storagePath}/watched-history.json`
    );
    return history || { movies: [], episodes: [] };
  }

  async getWatchlist(): Promise<any[]> {
    const watchlist = await this.storage.readFile<any[]>(
      `${this.storage.storagePath}/watchlist.json`
    );
    return watchlist || [];
  }

  async getRatings(): Promise<any[]> {
    const ratings = await this.storage.readFile<any[]>(
      `${this.storage.storagePath}/ratings.json`
    );
    return ratings || [];
  }
}
