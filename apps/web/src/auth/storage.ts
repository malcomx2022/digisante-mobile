// Cache de session (offline-first). On n'y stocke QUE le profil utilisateur
// courant (NON sensible — aucun jeton). Le refresh token (30 j) vit désormais
// dans un cookie HttpOnly inaccessible au JavaScript (audit CSO C6) : une faille
// XSS ne peut plus voler la session. Ce cache sert uniquement à rouvrir l'app
// HORS-LIGNE sans réseau ; le jeton d'accès est ré-obtenu via le cookie dès que
// le réseau revient (intercepteur de refresh).
import type { AuthUser } from '@/lib/api/auth';

const KEY = 'digisante.session';

export const sessionCache = {
  get(): AuthUser | null {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  },
  set(user: AuthUser): void {
    localStorage.setItem(KEY, JSON.stringify(user));
  },
  clear(): void {
    localStorage.removeItem(KEY);
  },
};
