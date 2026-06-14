// ─────────────────────────────────────────────────────────────
// Intégration push (FCM Web). Best-effort : ne bloque JAMAIS la connexion et
// n'échoue jamais (navigateur, permission, support). Entièrement conditionné à
// la config publique NEXT_PUBLIC_FIREBASE_* : si absente → no-op (aucun token).
// Le SDK firebase est chargé en import dynamique (hors du bundle principal).
// ─────────────────────────────────────────────────────────────
import { authApi } from '@/lib/api/auth';

interface WebFirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
  vapidKey: string;
}

/** Lit la config Firebase Web depuis l'env public ; null si incomplète. */
function readFirebaseConfig(): WebFirebaseConfig | null {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!apiKey || !projectId || !messagingSenderId || !appId || !vapidKey) return null;
  return {
    apiKey,
    projectId,
    messagingSenderId,
    appId,
    vapidKey,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? `${projectId}.firebaseapp.com`,
  };
}

/**
 * Tente d'obtenir un token push FCM pour cet appareil. Retourne `null` si
 * Firebase Web n'est pas configuré, si l'environnement ne le supporte pas, ou
 * si la permission de notification n'est pas accordée.
 */
async function obtainFcmToken(): Promise<string | null> {
  try {
    if (typeof window === 'undefined') return null;
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return null;
    const cfg = readFirebaseConfig();
    if (!cfg) return null; // Firebase Web non configuré → no-op

    const { initializeApp, getApps } = await import('firebase/app');
    const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
    if (!(await isSupported())) return null;

    if (Notification.permission === 'denied') return null;
    const permission =
      Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') return null;

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
 * À appeler après une connexion réussie. Enregistre le token push s'il est
 * disponible. Totalement silencieux : aucune erreur ne remonte à l'appelant.
 */
export async function registerPushDevice(): Promise<void> {
  try {
    const token = await obtainFcmToken();
    if (!token) return;
    await authApi.registerDevice({ fcmToken: token });
  } catch {
    /* le push est optionnel — ne jamais bloquer la connexion */
  }
}
