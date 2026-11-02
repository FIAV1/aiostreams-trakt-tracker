import type { FastifyInstance } from 'fastify';

export function apiRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  fastify.get('/api/status', async (request, reply) => {
    return { 
      status: 'running',
      version: '1.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  });
}
