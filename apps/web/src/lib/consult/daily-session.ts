// Cycle média partagé patient/médecin. Jeton en mémoire seulement, hors URL/DOM.
import type { DailyCall } from '@daily-co/daily-js';

export type ConsultMode = 'VIDEO' | 'AUDIO' | 'CHAT';
export type MediaCall = Pick<DailyCall, 'load' | 'join' | 'setLocalVideo' | 'setLocalAudio' | 'destroy'>;
export interface DailyAccess { roomUrl: string; token: string; expiresAt: number; mode: ConsultMode }
const rank = { VIDEO: 0, AUDIO: 1, CHAT: 2 };

export function restrictMode(current: ConsultMode, next: ConsultMode): ConsultMode {
  return rank[next] > rank[current] ? next : current;
}

export function validateDailyAccess(access: DailyAccess) {
  const url = new URL(access.roomUrl);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.daily\.co$/.test(url.hostname) ||
      url.username || url.password || url.port || url.search || url.hash ||
      !/^\/[a-zA-Z0-9_-]+$/.test(url.pathname) ||
      !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(access.token) ||
      !Number.isSafeInteger(access.expiresAt) || access.expiresAt * 1000 <= Date.now()) throw new Error('Invalid Daily access');
}

export class DailyMediaSession {
  private closed = false;
  private mode: ConsultMode = 'VIDEO';
  constructor(private readonly call: MediaCall) {}

  async connect(access: DailyAccess) {
    validateDailyAccess(access);
    if (this.closed) return;
    this.mode = restrictMode(this.mode, access.mode);
    // Prebuilt injecte ?t= si join déclenche load : charger SANS token d'abord.
    // Sur l'instance chargée, join transmet le token par message au fournisseur.
    await this.call.load({ url: access.roomUrl });
    if (this.closed) return;
    validateDailyAccess(access);
    await this.call.join({ url: access.roomUrl, token: access.token, startVideoOff: this.mode !== 'VIDEO' });
    // Une réponse join tardive après sortie ne doit jamais relancer le média.
    if (this.closed) return;
    this.applyMode(this.mode);
  }

  applyMode(mode: ConsultMode) {
    if (this.closed) return;
    this.mode = restrictMode(this.mode, mode);
    if (this.mode !== 'VIDEO') this.call.setLocalVideo(false);
    if (this.mode === 'CHAT') this.close();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    // Coupure immédiate, puis libération de l'iframe et de ses périphériques.
    try { this.call.setLocalVideo(false); this.call.setLocalAudio(false); } catch { /* instance déjà détruite */ }
    try { void this.call.destroy().catch(() => undefined); } catch { /* instance déjà détruite */ }
  }
}
