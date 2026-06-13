// ─────────────────────────────────────────────────────────────
// Point d'intégration push (FCM). Best-effort : ne bloque JAMAIS la connexion
// et n'échoue jamais en l'absence de support push (navigateur, permission).
//
// Aujourd'hui aucune obtention de token FCM n'est câblée côté web (pas de
// firebase-messaging configuré). `obtainFcmToken()` est l'unique point à
// brancher le jour où Firebase Web sera ajouté : il suffira de retourner le
// token ici, et l'enregistrement serveur suivra automatiquement.
// ─────────────────────────────────────────────────────────────
import { authApi } from '@/lib/api/auth';

/**
 * Tente d'obtenir un token push pour cet appareil. Retourne `null` tant que
 * Firebase Web n'est pas branché ou si l'environnement ne le supporte pas.
 */
async function obtainFcmToken(): Promise<string | null> {
  try {
    if (typeof window === 'undefined') return null;
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return null;
    // Pas encore de SDK firebase-messaging côté web : aucun token à fournir.
    // (Brancher ici getToken(messaging, { vapidKey }) une fois Firebase ajouté.)
    return null;
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
