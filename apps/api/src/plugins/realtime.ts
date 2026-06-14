// ─────────────────────────────────────────────────────────────
// Temps réel (chat) — @fastify/websocket + fan-out inter-workers via Redis pub/sub.
// En cluster PM2 ×2, un message envoyé sur un worker doit atteindre les sockets
// connectés sur l'AUTRE worker : on publie un événement léger sur Redis, chaque
// worker le reçoit et le pousse à SES sockets des destinataires concernés.
// Le contenu n'est PAS véhiculé ici (le client re-fetch via REST, déchiffré §4) :
// l'événement ne transporte que { threadId, recipients }.
// ─────────────────────────────────────────────────────────────
import websocket from '@fastify/websocket';
import fp from 'fastify-plugin';
import Redis from 'ioredis';
import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';

import { env } from '@/lib/env.js';

/** Canal Redis de diffusion des événements de chat. */
export const CHAT_CHANNEL = 'chat:events';

export interface ChatEvent {
  threadId: string;
  /** userId des participants à notifier (patient + médecin). */
  recipients: string[];
}

interface ChatHub {
  add(userId: string, socket: WebSocket): void;
  remove(userId: string, socket: WebSocket): void;
}

declare module 'fastify' {
  interface FastifyInstance {
    chatHub: ChatHub;
  }
}

export default fp(async (app: FastifyInstance) => {
  await app.register(websocket);

  // Registre LOCAL au worker : userId → sockets ouverts.
  const clients = new Map<string, Set<WebSocket>>();

  const hub: ChatHub = {
    add(userId, socket) {
      let set = clients.get(userId);
      if (!set) {
        set = new Set();
        clients.set(userId, set);
      }
      set.add(socket);
    },
    remove(userId, socket) {
      const set = clients.get(userId);
      if (!set) return;
      set.delete(socket);
      if (set.size === 0) clients.delete(userId);
    },
  };
  app.decorate('chatHub', hub);

  // Abonné Redis dédié (une connexion distincte de app.redis, requis pour SUBSCRIBE).
  const subscriber = new Redis(env.REDIS_URL);
  await subscriber.subscribe(CHAT_CHANNEL);
  subscriber.on('message', (_channel, payload) => {
    let event: ChatEvent;
    try {
      event = JSON.parse(payload) as ChatEvent;
    } catch {
      return;
    }
    const data = JSON.stringify({ type: 'chat', threadId: event.threadId });
    for (const userId of event.recipients) {
      const set = clients.get(userId);
      if (!set) continue;
      for (const socket of set) {
        if (socket.readyState === WebSocket.OPEN) socket.send(data);
      }
    }
  });

  app.addHook('onClose', async () => {
    await subscriber.quit();
  });
});
