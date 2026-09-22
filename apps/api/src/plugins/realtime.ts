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

/** Connexions temps réel simultanées par compte (onglets + appareils). */
export const MAX_SOCKETS_PER_USER = 5;

export default fp(async (app: FastifyInstance) => {
  // Le serveur n'accepte AUCUN message client (événements descendants seulement) :
  // trame limitée à 4 Kio — le défaut de `ws` (100 Mio) laissait un patient pousser
  // un worker au seuil de redémarrage mémoire de PM2 avec quelques trames.
  await app.register(websocket, { options: { maxPayload: 4096 } });

  // Registre LOCAL au worker : userId → sockets ouverts.
  const clients = new Map<string, Set<WebSocket>>();
  // Vivacité par socket (heartbeat ping/pong) : true si un pong a été reçu depuis
  // le dernier ping. Un socket non répondant est fermé au cycle suivant.
  const alive = new WeakMap<WebSocket, boolean>();

  const hub: ChatHub = {
    add(userId, socket) {
      let set = clients.get(userId);
      if (!set) {
        set = new Set();
        clients.set(userId, set);
      }
      // Au plus MAX_SOCKETS_PER_USER onglets/appareils : le plus ancien est fermé.
      if (set.size >= MAX_SOCKETS_PER_USER) {
        const oldest = set.values().next().value as WebSocket | undefined;
        if (oldest) {
          set.delete(oldest);
          oldest.close(1008, 'too many connections');
        }
      }
      set.add(socket);
      alive.set(socket, true);
      socket.on('pong', () => alive.set(socket, true));
    },
    remove(userId, socket) {
      const set = clients.get(userId);
      if (!set) return;
      set.delete(socket);
      if (set.size === 0) clients.delete(userId);
    },
  };
  app.decorate('chatHub', hub);

  // Heartbeat : ping périodique → termine les connexions mortes (TCP coupé
  // silencieusement, proxy idle). Les navigateurs répondent au ping au niveau
  // protocole (pas de code client). unref() : n'empêche pas l'arrêt du process.
  const HEARTBEAT_MS = 30_000;
  const heartbeat = setInterval(() => {
    for (const [userId, set] of clients) {
      for (const socket of set) {
        if (alive.get(socket) === false) {
          socket.terminate();
          set.delete(socket);
          if (set.size === 0) clients.delete(userId);
          continue;
        }
        alive.set(socket, false);
        try {
          socket.ping();
        } catch {
          /* socket déjà fermé : nettoyé au cycle suivant */
        }
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

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
    clearInterval(heartbeat);
    await subscriber.quit();
  });
});
