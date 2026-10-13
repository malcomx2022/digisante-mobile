'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useLocale } from '@/i18n/LocaleProvider';
import { ApiRequestError, get, postNow } from '@/lib/api/client';
import { useOnline } from '@/lib/offline/online';

import { DailyMediaSession, restrictMode, validateDailyAccess, type ConsultMode } from '@/lib/consult/daily-session';
export type { ConsultMode } from '@/lib/consult/daily-session';

interface JoinResult {
  roomUrl: string | null;
  mode: ConsultMode;
  token: string | null;
  expiresAt: number | null;
}

/**
 * Salle de téléconsultation (D-06) — partagée patient ET médecin.
 *
 * Extraite de `patient/teleconsult` au lot 7 : les deux côtés rejoignent la MÊME
 * salle par le MÊME endpoint (`/consultations/:id/join`, qui autorise les deux
 * participants), avec la même bascule réseau faible `VIDEO → AUDIO → CHAT`.
 * Le média exige le réseau, sans file hors ligne ; SDK et repli chat sont communs.
 *
 * Ce qui diffère par espace est passé en props : où raccrocher, où ouvrir le chat,
 * et l'action de clôture (`onEnd`) réservée au médecin.
 */
export function ConsultationRoom({
  consultationId,
  homePath,
  chatPath,
  onEnd,
  endLabel,
  endBusy = false,
}: {
  consultationId: string | null;
  /** Destination du bouton « Raccrocher ». */
  homePath: string;
  /** Destination du repli chat (mode CHAT). */
  chatPath: string;
  /** Clôture de la consultation — médecin uniquement (absent côté patient). */
  onEnd?: () => void;
  endLabel?: string;
  endBusy?: boolean;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const online = useOnline();

  const [mode, setMode] = useState<ConsultMode>('VIDEO');
  const [hasMedia, setHasMedia] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const media = useRef<DailyMediaSession | null>(null);
  const modeRef = useRef<ConsultMode>('VIDEO');
  const downgradeBusy = useRef(false);
  const degradeAfter = useRef(0);
  const scope = useRef(0);
  const previousId = useRef(consultationId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Bascule automatique vers la messagerie seulement lors d'une TRANSITION vécue
  // dans la salle. Une consultation déjà en CHAT à l'ouverture affiche la carte
  // CHAT : sinon le médecin, renvoyé en boucle vers la messagerie, ne pourrait
  // jamais atteindre « Terminer » (seul point de clôture).
  const applyMode = useCallback((next: ConsultMode, redirect = true) => {
    const restricted = restrictMode(modeRef.current, next);
    const transition = restricted === 'CHAT' && modeRef.current !== 'CHAT';
    modeRef.current = restricted;
    media.current?.applyMode(restricted);
    setMode(restricted);
    if (transition && redirect) router.push(chatPath);
  }, [chatPath, router]);

  const downgrade = useCallback(async () => {
    if (!consultationId || downgradeBusy.current || modeRef.current === 'CHAT') return;
    const generation = scope.current;
    downgradeBusy.current = true;
    setBusy(true);
    // Le réseau faible doit couper le média même si l'API n'est plus joignable.
    const local = modeRef.current === 'VIDEO' ? 'AUDIO' : 'CHAT';
    applyMode(local);
    try {
      const res = await postNow<{ mode: ConsultMode }>(`/consultations/${consultationId}/downgrade`, {});
      if (generation === scope.current) applyMode(res.mode);
    } catch (e) {
      if (generation === scope.current && e instanceof ApiRequestError && [400, 401, 403, 404].includes(e.status)) {
        media.current?.close();
        setHasMedia(false);
        setError(t('teleconsult.not_active'));
      }
    } finally {
      if (generation === scope.current) { downgradeBusy.current = false; setBusy(false); }
    }
  }, [consultationId, applyMode, t]);

  useEffect(() => {
    scope.current += 1;
    downgradeBusy.current = false;
    setBusy(false);
    if (previousId.current !== consultationId) {
      previousId.current = consultationId; modeRef.current = 'VIDEO'; setMode('VIDEO');
    }
    let cancelled = false;
    let ownMedia: DailyMediaSession | null = null;
    let poll: ReturnType<typeof setInterval> | undefined;
    let expires: ReturnType<typeof setTimeout> | undefined;
    let polling = false;
    const stop = () => {
      clearInterval(poll); clearTimeout(expires);
      ownMedia?.close();
      if (media.current === ownMedia) media.current = null;
    };
    setLoading(true);
    setError(null);
    setHasMedia(false);
    async function connect() {
      if (!consultationId) { setError(t('teleconsult.no_session')); setLoading(false); return; }
      try {
        const res = await postNow<JoinResult>(`/consultations/${consultationId}/join`, {});
        if (cancelled) return;
        applyMode(res.mode, false);
        if (modeRef.current === 'CHAT') return;
        if (!res.roomUrl || !res.token || !res.expiresAt) return;
        const access = { roomUrl: res.roomUrl, token: res.token, expiresAt: res.expiresAt, mode: modeRef.current };
        validateDailyAccess(access);
        // Le chunk Daily n'est téléchargé que pour un accès réellement émis.
        const { default: Daily } = await import('@daily-co/daily-js');
        if (cancelled || !container.current) return;
        const call = Daily.createFrame(container.current, {
          iframeStyle: { width: '100%', height: '100%', border: '0' },
          showLeaveButton: false, showUserNameChangeUI: false,
        });
        const frame = call.iframe();
        if (frame) { frame.referrerPolicy = 'no-referrer'; frame.title = t('teleconsult.title'); frame.allow = 'camera; microphone; fullscreen'; }
        ownMedia = new DailyMediaSession(call);
        media.current = ownMedia;
        call.on('participant-updated', (event) => {
          if (event.participant.local && event.participant.video && modeRef.current !== 'VIDEO') ownMedia?.applyMode(modeRef.current);
        });
        call.on('network-quality-change', (event) => {
          if (!cancelled && event.threshold === 'very-low' && Date.now() >= degradeAfter.current) {
            degradeAfter.current = Date.now() + 15_000;
            void downgrade();
          }
        });
        call.on('error', () => { if (!cancelled) { stop(); setHasMedia(false); setError(t('teleconsult.join_error')); } });
        call.on('left-meeting', () => { if (!cancelled) { stop(); setHasMedia(false); setError(t('teleconsult.session_expired')); } });
        // Expiration locale indépendante du succès de la surveillance API.
        expires = setTimeout(() => {
          if (!cancelled) { stop(); setHasMedia(false); setError(t('teleconsult.session_expired')); }
        }, Math.max(0, res.expiresAt * 1000 - Date.now()));
        setHasMedia(true);
        await ownMedia.connect(access);
        if (cancelled || media.current !== ownMedia) return;
        poll = setInterval(() => {
          if (polling || cancelled) return;
          polling = true;
          void get<{ mode: ConsultMode }>(`/consultations/${consultationId}/session`, { retries: 0 })
            .then((state) => { if (!cancelled) applyMode(state.mode); })
            .catch((e: unknown) => {
              if (!cancelled && e instanceof ApiRequestError && [400, 401, 403, 404].includes(e.status)) {
                stop(); setHasMedia(false); setError(t('teleconsult.not_active'));
              }
            }).finally(() => { polling = false; });
        }, 15_000);
      } catch (e) {
        stop();
        if (!cancelled) { setHasMedia(false); setError(t(e instanceof ApiRequestError && [400, 401, 403, 404].includes(e.status) ? 'teleconsult.not_active' : 'teleconsult.join_error')); }
      } finally { if (!cancelled) setLoading(false); }
    }
    void connect();
    const pageExit = () => stop();
    window.addEventListener('pagehide', pageExit);
    return () => {
      cancelled = true; scope.current += 1; stop(); clearInterval(poll); clearTimeout(expires);
      window.removeEventListener('pagehide', pageExit);
    };
  }, [consultationId, attempt, t, applyMode, downgrade]);

  useEffect(() => { if (!online && hasMedia) void downgrade(); }, [online, hasMedia, downgrade]);

  function leave(path: string) { media.current?.close(); setHasMedia(false); router.push(path); }

  return (
    <div className="flex-1 bg-nuit text-white flex flex-col">
      <div className="relative flex-1 wax-dark flex items-center justify-center">
        <div ref={container} className="absolute inset-0" />
        {loading ? (
          <div className="card-pagne bg-indigo-900/60 px-6 py-4">
            <p className="text-white/80 text-sm">{t('teleconsult.connecting')}</p>
          </div>
        ) : error ? (
          <div className="card-pagne stitch-light bg-indigo-900/60 w-[78%] grid place-items-center p-6 text-center">
            <p className="text-white/80 text-sm">{error}</p>
            {consultationId && (
              <button
                type="button"
                onClick={() => setAttempt((value) => value + 1)}
                className="mt-3 text-ocre-400 underline decoration-dotted underline-offset-4 text-[0.8125rem] font-bold"
              >
                {t('common.retry')}
              </button>
            )}
          </div>
        ) : hasMedia && mode !== 'CHAT' ? null : mode === 'CHAT' ? (
          <div className="card-pagne stitch-light bg-indigo-900/60 w-[78%] grid place-items-center p-6 text-center">
            <p className="text-white/80 text-sm">{t('teleconsult.chat_mode')}</p>
            <button
              type="button"
              onClick={() => leave(chatPath)}
              className="mt-3 bg-ocre-400 text-stone-900 font-display font-bold card-pagne px-4 py-2 text-[0.8125rem]"
            >
              {t('teleconsult.open_chat')}
            </button>
          </div>
        ) : (
          // Fournisseur absent : aucun iframe ni jeton fictif, messagerie accessible.
          <div className="card-pagne stitch-light bg-indigo-900/60 w-[78%] aspect-[3/4] grid place-items-center p-6 text-center">
            <p className="text-white/80 text-sm">{t('teleconsult.provider_unavailable')}</p>
          </div>
        )}


        {(!online || mode !== 'VIDEO') && (
          <div className="absolute top-3 left-3 right-3 bg-ocre-400 text-stone-900 text-[0.75rem] font-display font-bold card-pagne px-3 py-1 text-center">
            {t('teleconsult.low_network')} ({mode})
          </div>
        )}
      </div>

      {/* La BottomNav est masquée dans la salle (AppShell) : cette barre de
          contrôle devient donc l'élément le plus bas de l'écran et doit
          reprendre la zone sûre que la navigation portait — sinon le bouton
          « Raccrocher » se retrouve sous l'indicateur d'accueil iOS. */}
      <div className="p-5 pb-safe flex flex-wrap items-center justify-center gap-4">
        <button
          type="button"
          onClick={downgrade}
          disabled={busy || mode === 'CHAT' || !consultationId}
          className="bg-indigo-600 text-white font-display font-bold card-pagne px-4 py-3 text-[0.8125rem] disabled:opacity-50 focus-visible:ring-inset"
        >
          {t('teleconsult.downgrade')}
        </button>
        <button type="button" onClick={() => leave(chatPath)} className="bg-indigo-600 text-white font-display font-bold card-pagne px-4 py-3 text-[0.8125rem] focus-visible:ring-inset">
          {t('teleconsult.open_chat')}
        </button>
        {onEnd && (
          <button
            type="button"
            onClick={onEnd}
            disabled={endBusy}
            className="bg-ocre-400 text-stone-900 font-display font-bold card-pagne px-4 py-3 text-[0.8125rem] disabled:opacity-50 focus-visible:ring-inset"
          >
            {endLabel}
          </button>
        )}
        <button
          type="button"
          onClick={() => leave(homePath)}
          className="bg-sos-500 text-white font-display font-extrabold card-pagne px-5 py-3 rotate-3 focus-visible:ring-inset"
        >
          {t('teleconsult.hangup')}
        </button>
      </div>
    </div>
  );
}

/** Écran d'attente pendant la résolution de `useSearchParams` (Suspense). */
export function ConsultationRoomFallback() {
  const { t } = useLocale();
  return (
    <div className="flex-1 bg-nuit text-white grid place-items-center">
      <div className="card-pagne bg-indigo-900/60 px-6 py-4">
        <p className="text-white/80 text-sm">{t('teleconsult.connecting')}</p>
      </div>
    </div>
  );
}
