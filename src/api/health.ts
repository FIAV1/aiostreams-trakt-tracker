import type { FastifyInstance } from 'fastify';
import { manifest } from '../index.js';
import type { DatabaseRepository } from '../database/repository.js';

export function apiRoutes(fastify: FastifyInstance, db: DatabaseRepository) {
  fastify.get('/manifest.json', async () => manifest);

  fastify.get('/', async (_request, reply) => reply.redirect('/manifest.json'));

  fastify.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  fastify.get<{ Querystring: { viewer?: string } }>('/api/status', async (request, reply) => {
    const viewer = request.query.viewer || 'default-user';
    const [user, queue] = await Promise.all([db.getUser(viewer), db.getSyncQueueStats(viewer)]);
    return { 
      status: 'running',
      version: '1.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      viewerConnected: Boolean(user?.trakt_access_token),
      queue: { pending: queue.pending ?? 0, processing: queue.processing ?? 0, dead: queue.dead ?? 0 },
    };
  });
}
