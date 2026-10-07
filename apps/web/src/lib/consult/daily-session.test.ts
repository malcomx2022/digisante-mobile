import { describe, expect, it, vi } from 'vitest';
import { DailyMediaSession, restrictMode, validateDailyAccess, type MediaCall } from './daily-session';
const access = () => ({ roomUrl: 'https://digisante.daily.co/consult-1', token: 'jwt.test.signature', expiresAt: Math.floor(Date.now() / 1000) + 900, mode: 'VIDEO' as const });
function call() {
  return { load: vi.fn().mockResolvedValue(undefined), join: vi.fn().mockResolvedValue({}), setLocalVideo: vi.fn(), setLocalAudio: vi.fn(), destroy: vi.fn().mockResolvedValue(undefined) } as unknown as MediaCall;
}
describe('Daily — média privé', () => {
  it('transmet le jeton à join sans le concaténer à l’URL', async () => {
    const sdk = call(); const session = new DailyMediaSession(sdk);
    await session.connect(access());
    expect(sdk.load).toHaveBeenCalledWith({ url: access().roomUrl });
    expect(sdk.join).toHaveBeenCalledWith({ url: access().roomUrl, token: access().token, startVideoOff: false });
    expect((sdk.join as ReturnType<typeof vi.fn>).mock.calls[0]![0].url).not.toContain(access().token);
  });
  it('AUDIO coupe réellement la vidéo et laisse le micro actif', async () => {
    const sdk = call(); const session = new DailyMediaSession(sdk); await session.connect(access());
    session.applyMode('AUDIO');
    expect(sdk.setLocalVideo).toHaveBeenCalledWith(false);
    expect(sdk.setLocalAudio).not.toHaveBeenCalled();
  });
  it('reconnexion AUDIO : caméra éteinte dès join', async () => {
    const sdk = call(); const session = new DailyMediaSession(sdk);
    await session.connect({ ...access(), mode: 'AUDIO' });
    expect(sdk.join).toHaveBeenCalledWith(expect.objectContaining({ startVideoOff: true }));
    expect(sdk.setLocalVideo).toHaveBeenCalledWith(false);
  });
  it('CHAT coupe caméra/micro puis détruit la session une seule fois', async () => {
    const sdk = call(); const session = new DailyMediaSession(sdk); await session.connect(access());
    session.applyMode('CHAT'); session.close();
    expect(sdk.setLocalVideo).toHaveBeenCalledWith(false); expect(sdk.setLocalAudio).toHaveBeenCalledWith(false);
    expect(sdk.destroy).toHaveBeenCalledTimes(1);
  });
  it('une surveillance périmée ne remonte jamais VIDEO après AUDIO/CHAT', () => {
    expect(restrictMode('AUDIO', 'VIDEO')).toBe('AUDIO'); expect(restrictMode('CHAT', 'AUDIO')).toBe('CHAT');
  });
  it('après sortie, aucune réponse join tardive ne rallume de média', async () => {
    let done!: (value: unknown) => void;
    const sdk = call(); (sdk.join as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise((resolve) => { done = resolve; }));
    const session = new DailyMediaSession(sdk); const joining = session.connect(access());
    await Promise.resolve(); session.close(); done({}); await joining;
    expect(sdk.setLocalVideo).toHaveBeenCalledTimes(1); expect(sdk.setLocalAudio).toHaveBeenCalledTimes(1);
    expect(sdk.destroy).toHaveBeenCalledTimes(1);
  });
  it('refuse un accès expiré avant de joindre Daily', async () => {
    const sdk = call(); const session = new DailyMediaSession(sdk);
    await expect(session.connect({ ...access(), expiresAt: 1 })).rejects.toThrow(); expect(sdk.join).not.toHaveBeenCalled();
    await expect(session.connect({ ...access(), expiresAt: Number.NaN })).rejects.toThrow();
    await expect(session.connect({ ...access(), expiresAt: Number.POSITIVE_INFINITY })).rejects.toThrow();
  });
  it('rejette HTTP, origine tierce, URL avec token, fragment ou credentials', () => {
    for (const roomUrl of ['http://digisante.daily.co/r', 'https://attacker.test/r', 'https://digisante.daily.co/r?t=secret', 'https://digisante.daily.co/r#secret', 'https://user:secret@digisante.daily.co/r']) {
      expect(() => validateDailyAccess({ ...access(), roomUrl })).toThrow();
    }
  });
  it('un SDK en panne à destroy ne crée pas de rejet non géré', async () => {
    const sdk = call(); (sdk.destroy as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('test-only-failure'));
    const session = new DailyMediaSession(sdk); session.close(); await Promise.resolve();
    expect(sdk.destroy).toHaveBeenCalledTimes(1);
  });
});
