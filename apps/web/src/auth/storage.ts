// Cache de session (offline-first). On n'y stocke QUE le profil utilisateur
// courant (NON sensible — aucun jeton). Le refresh token (30 j) vit désormais
// dans un cookie HttpOnly inaccessible au JavaScript (audit CSO C6) : une faille
// XSS ne lit pas ce cookie mais peut agir dans une session ouverte. Ce cache sert uniquement à rouvrir l'app
// HORS-LIGNE sans réseau ; le jeton d'accès est ré-obtenu via le cookie dès que
// le réseau revient (intercepteur de refresh).
import type { AuthUser } from '@/lib/api/auth';

const KEY = 'digisante.session';

export const sessionCache = {
  get(): AuthUser | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (!value.id || !value.role || !value.lang) return null;
      const minimal = { id: value.id, role: value.role, status: value.status, lang: value.lang };
      // Réduire aussi un cache créé avant L4 dès sa première lecture.
      if (raw !== JSON.stringify(minimal)) localStorage.setItem(KEY, JSON.stringify(minimal));
      return { ...minimal, phone: '', email: null } as AuthUser;
    } catch {
      return null;
    }
  },
  set(user: AuthUser): void {
    localStorage.setItem(KEY, JSON.stringify({ id: user.id, role: user.role, status: user.status, lang: user.lang }));
  },
  clear(): void {
    localStorage.removeItem(KEY);
  },
};
