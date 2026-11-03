import type { WatchStateEvent } from '@aiostreams/addon-sdk';
import type { DatabaseRepository } from '../database/repository.js';
import type { TraktClient } from '../trakt/client.js';
import { SyncEngine } from './engine.js';

type ClientFactory = (viewer: string) => Promise<TraktClient>;

/** A single-process worker backed by SQLite so accepted pushes survive restarts. */
export class SyncQueue {
  private timer?: NodeJS.Timeout;
  private draining = false;
  private stopped = true;

  constructor(private readonly db: DatabaseRepository, private readonly getClient: ClientFactory, private readonly logger: { error: (obj: unknown, message: string) => void }) {}

  async start() {
    if (!this.stopped) return;
    await this.db.requeueInterruptedSyncJobs();
    this.stopped = false;
    this.timer = setInterval(() => void this.drain(), 1000);
    this.timer.unref();
    void this.drain();
  }

  async enqueue(viewer: string, event: WatchStateEvent) {
    const key = 'part' in event ? `${event.id}:${event.part}` : event.id;
    await this.db.enqueueSyncJob(viewer, key, event);
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    while (this.draining) await new Promise(resolve => setTimeout(resolve, 25));
  }

  private async drain() {
    if (this.stopped || this.draining) return;
    this.draining = true;
    try {
      while (!this.stopped) {
        const jobs = await this.db.claimDueSyncJobs(10);
        if (!jobs.length) break;
        for (const job of jobs) {
          try {
            const event = JSON.parse(job.payload) as WatchStateEvent;
            const client = await this.getClient(job.user_id);
            await new SyncEngine(this.db, client).processEvent(job.user_id, event);
            await this.db.completeSyncJob(job.id);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.db.failSyncJob(job.id, job.attempts, message);
            this.logger.error({ err: error, jobId: job.id, attempts: job.attempts + 1 }, 'Watch State job failed');
          }
        }
      }
    } catch (error) {
      this.logger.error({ err: error }, 'Could not read Watch State queue');
    } finally {
      this.draining = false;
    }
  }
}
