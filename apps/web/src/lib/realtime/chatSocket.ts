// ─────────────────────────────────────────────────────────────
// Socket temps réel du chat. Se connecte à /api/v1/chat/ws?token=<access JWT>
// (les navigateurs ne peuvent pas poser d'en-tête Authorization sur un WebSocket).
// Reconnexion automatique avec backoff. L'événement reçu est léger
// ({ type:'chat', threadId }) : l'appelant re-fetch le contenu via REST (déchiffré).
// ─────────────────────────────────────────────────────────────
import { getAccessToken, refreshAccessToken } from '@/lib/api/client';

export interface ChatRealtimeEvent {
  type: 'chat';
  threadId: string;
}

/** Base ws(s):// dérivée de l'URL API (ou de l'origine courante). */
function wsBase(): string {
  const api = process.env.NEXT_PUBLIC_API_URL ?? '';
  const base = api || (typeof window !== 'undefined' ? window.location.origin : '');
  return base.replace(/^http/, 'ws');
}

/**
 * Ouvre le canal temps réel et appelle `onEvent` à chaque événement de chat.
 * Renvoie une fonction de fermeture (à appeler au démontage).
 */
export function openChatSocket(onEvent: (event: ChatRealtimeEvent) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  // Mis à true tant que la connexion courante n'est pas (re)ouverte. Sur une
  // reconnexion (attempt > 0) sans ouverture préalable, on rafraîchit le jeton
  // avant de retenter — couvre le cas d'un access token expiré (point 4).
  let everOpened = false;

  // Toujours lire un jeton FRAIS au moment du connect (jamais capturé une seule fois).
  // Si la tentative précédente ne s'est pas (ré)ouverte, on force un refresh avant
  // de reconnecter pour éviter une boucle de reconnexion sur jeton expiré.
  const connect = async () => {
    if (closed) return;
    let token = getAccessToken();
    if (!everOpened && attempt > 0 && token) {
      // Tentative précédente non ouverte → refresh (single-flight, partagé avec le 401).
      const refreshed = await refreshAccessToken();
      if (closed) return;
      if (refreshed) token = refreshed;
    }
    if (!token) {
      // Pas encore authentifié : on retente bientôt.
      reconnectTimer = setTimeout(() => void connect(), 2000);
      return;
    }
    ws = new WebSocket(`${wsBase()}/api/v1/chat/ws?token=${encodeURIComponent(token)}`);

    ws.onopen = () => {
      attempt = 0;
      everOpened = true;
    };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data as string) as ChatRealtimeEvent;
        if (data.type === 'chat' && data.threadId) onEvent(data);
      } catch {
        /* trame non JSON ignorée */
      }
    };
    ws.onerror = () => {
      ws?.close();
    };
    ws.onclose = () => {
      if (closed) return;
      const delay = Math.min(1000 * 2 ** attempt, 15000);
      attempt += 1;
      everOpened = false; // la prochaine tentative déclenchera un refresh si besoin
      reconnectTimer = setTimeout(() => void connect(), delay);
    };
  };

  void connect();

  return () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  };
}
