import fp from 'fastify-plugin';
import type Redis from 'ioredis';
import type { FastifyInstance } from 'fastify';
import { createRedis } from '@/lib/redis.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

export default fp(async (app: FastifyInstance) => {
  const redis = createRedis();
  app.decorate('redis', redis);
  app.addHook('onClose', async (instance) => {
    await instance.redis.quit();
  });
});
