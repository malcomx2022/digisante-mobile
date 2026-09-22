// ─────────────────────────────────────────────────────────────
// Intégration push (FCM Web). Best-effort : ne bloque JAMAIS la connexion et
// n'échoue jamais (navigateur, permission, support). Entièrement conditionné à
// la config publique NEXT_PUBLIC_FIREBASE_* : si absente → no-op (aucun token).
// Le SDK firebase est chargé en import dynamique (hors du bundle principal).
//
// ⚠️ NEXT_PUBLIC_* est INLINÉ AU BUILD : changer la config Firebase web exige un
// NOUVEAU BUILD + déploiement (la console admin ne gère que les secrets SERVEUR).
// Seules des valeurs PUBLIQUES vivent ici — jamais `privateKey`/`clientEmail`
// (vérifié par push.test.ts et `scripts/check-web-bundle-secrets.mjs`).
// ─────────────────────────────────────────────────────────────
import { authApi } from '@/lib/api/auth';

export interface WebFirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
  vapidKey: string;
}

type PublicEnv = Record<string, string | undefined>;

/** Construit la config Firebase Web ; null si incomplète (fonction PURE, testée). */
export function parseFirebaseConfig(env: PublicEnv): WebFirebaseConfig | null {
  const apiKey = env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const projectId = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const messagingSenderId = env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  const appId = env.NEXT_PUBLIC_FIREBASE_APP_ID;
  const vapidKey = env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!apiKey || !projectId || !messagingSenderId || !appId || !vapidKey) return null;
  return {
    apiKey,
    projectId,
    messagingSenderId,
    appId,
    vapidKey,
    authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
  };
}

/** Lit la config depuis l'env public — accès LITTÉRAUX, requis pour l'inlining Next. */
function readFirebaseConfig(): WebFirebaseConfig | null {
  return parseFirebaseConfig({
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    NEXT_PUBLIC_FIREBASE_VAPID_KEY: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
  });
}

/**
 * Tente d'obtenir un token push FCM pour cet appareil. Retourne `null` si
 * Firebase Web n'est pas configuré, si l'environnement ne le supporte pas, ou
 * si la permission n'est pas accordée. `prompt: false` (reprise de session) ne
 * DEMANDE jamais la permission : on ne surprend pas l'utilisateur à l'ouverture.
 */
async function obtainFcmToken(prompt: boolean): Promise<string | null> {
  try {
    if (typeof window === 'undefined') return null;
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return null;
    const cfg = readFirebaseConfig();
    if (!cfg) return null; // Firebase Web non configuré → no-op

    const { initializeApp, getApps } = await import('firebase/app');
    const { getMessaging, getToken, isSupported, onMessage } = await import('firebase/messaging');
    if (!(await isSupported())) return null;

    if (Notification.permission === 'denied') return null;
    if (Notification.permission !== 'granted') {
      if (!prompt) return null;
      if ((await Notification.requestPermission()) !== 'granted') return null;
    }

    const appConfig = {
      apiKey: cfg.apiKey,
      authDomain: cfg.authDomain,
      projectId: cfg.projectId,
      messagingSenderId: cfg.messagingSenderId,
      appId: cfg.appId,
    };

    // SW dédié FCM (config publique transmise en query — un SW ne lit pas l'env).
    const swParams = new URLSearchParams(appConfig).toString();
    const registration = await navigator.serviceWorker.register(
      `/firebase-messaging-sw.js?${swParams}`,
      { scope: '/firebase-cloud-messaging-push-scope' },
    );

    const app = getApps()[0] ?? initializeApp(appConfig);
    const messaging = getMessaging(app);
    // PREMIER PLAN : FCM n'affiche rien quand l'app est ouverte (seul le SW gère
    // l'arrière-plan). On relaie par le SW pour un rendu et un clic identiques.
    onMessage(messaging, (payload) => {
      const title = payload.notification?.title || 'DigiSanté';
      const body = payload.notification?.body || '';
      const link = payload.data?.link || '/';
      void registration.showNotification(title, { body, icon: '/icon-192.png', data: { link } });
    });
    const token = await getToken(messaging, {
      vapidKey: cfg.vapidKey,
      serviceWorkerRegistration: registration,
    });
    return token || null;
  } catch {
    return null;
  }
}

/**
 * Enregistre le token push s'il est disponible. `prompt: true` après une connexion
 * explicite ; `false` à la reprise de session (propage une ROTATION du token par
 * FCM, et ré-enregistre l'appareil si une déconnexion ailleurs l'a purgé — le
 * serveur ne garde qu'UN token par compte). Silencieux : aucune erreur ne remonte.
 */
export async function registerPushDevice(opts: { prompt?: boolean } = {}): Promise<void> {
  try {
    const token = await obtainFcmToken(opts.prompt ?? true);
    if (!token) return;
    await authApi.registerDevice({ fcmToken: token });
  } catch {
    /* le push est optionnel — ne jamais bloquer la connexion */
  }
}
