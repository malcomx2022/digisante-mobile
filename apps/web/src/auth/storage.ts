// Stockage local des jetons (appareil). Le refresh permet de reprendre la session.
const ACCESS = 'digisante.access';
const REFRESH = 'digisante.refresh';

export const tokenStore = {
  get(): { access: string | null; refresh: string | null } {
    if (typeof window === 'undefined') return { access: null, refresh: null };
    return { access: localStorage.getItem(ACCESS), refresh: localStorage.getItem(REFRESH) };
  },
  set(access: string, refresh: string): void {
    localStorage.setItem(ACCESS, access);
    localStorage.setItem(REFRESH, refresh);
  },
  clear(): void {
    localStorage.removeItem(ACCESS);
    localStorage.removeItem(REFRESH);
  },
};
