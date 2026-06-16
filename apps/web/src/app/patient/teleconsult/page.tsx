'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useLocale } from '@/i18n/LocaleProvider';
import { ApiRequestError, post } from '@/lib/api/client';
import { useOnline } from '@/lib/offline/online';

type Mode = 'VIDEO' | 'AUDIO' | 'CHAT';

interface JoinResult {
  roomUrl: string | null;
  mode: Mode;
  token?: string;
}

// D-06 — Téléconsultation (salle Daily.co). Bascule chat auto si réseau faible.
// L'id de consultation est fourni en query (?id=...). Sans clés Daily configurées
// côté serveur, roomUrl peut être absent → rendu gracieux « salle en préparation ».
function TeleconsultInner() {
  const { t } = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const consultationId = params.get('id');
  const online = useOnline();

  const [mode, setMode] = useState<Mode>('VIDEO');
  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const join = useCallback(async () => {
    if (!consultationId) {
      setError(t('teleconsult.no_session'));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await post<JoinResult>(`/consultations/${consultationId}/join`, {});
      if ('queued' in res) {
        setError(t('teleconsult.needs_network'));
        return;
      }
      setRoomUrl(res.roomUrl);
      setMode(res.mode);
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 400) {
        setError(t('teleconsult.not_active'));
      } else {
        setError(t('teleconsult.join_error'));
      }
    } finally {
      setLoading(false);
    }
  }, [consultationId, t]);

  useEffect(() => {
    void join();
  }, [join]);

  // Bascule de mode (réseau faible) branchée sur l'endpoint downgrade réel.
  async function downgrade() {
    if (!consultationId) {
      setMode((m) => (m === 'VIDEO' ? 'AUDIO' : 'CHAT'));
      return;
    }
    // Le nouveau mode provient de la réponse (et non de l'état `mode` potentiellement périmé).
    let nextMode: Mode;
    try {
      const res = await post<{ mode: Mode }>(`/consultations/${consultationId}/downgrade`, {});
      nextMode = 'queued' in res ? mode : res.mode;
      setMode(nextMode);
    } catch {
      // En cas d'échec réseau, on dégrade localement l'affichage (sécurité réseau faible).
      nextMode = mode === 'VIDEO' ? 'AUDIO' : 'CHAT';
      setMode(nextMode);
    }
    if (nextMode === 'CHAT') router.push('/patient/chat');
  }

  return (
    <div className="flex-1 bg-nuit text-white flex flex-col">
      <div className="relative flex-1 wax-dark flex items-center justify-center">
        {loading ? (
          <div className="card-pagne bg-indigo-900/60 px-6 py-4">
            <p className="text-white/70 text-sm">{t('teleconsult.connecting')}</p>
          </div>
        ) : error ? (
          <div className="card-pagne stitch-light bg-indigo-900/60 w-[78%] grid place-items-center p-6 text-center">
            <p className="text-white/80 text-sm">{error}</p>
            {consultationId && (
              <button
                type="button"
                onClick={() => void join()}
                className="mt-3 text-ocre-400 underline decoration-dotted underline-offset-4 text-[13px] font-bold"
              >
                {t('common.retry')}
              </button>
            )}
          </div>
        ) : roomUrl && mode !== 'CHAT' ? (
          <iframe
            title={t('teleconsult.title')}
            src={roomUrl}
            allow="camera; microphone; fullscreen; speaker; display-capture"
            className="absolute inset-0 w-full h-full border-0"
          />
        ) : mode === 'CHAT' ? (
          <div className="card-pagne stitch-light bg-indigo-900/60 w-[78%] grid place-items-center p-6 text-center">
            <p className="text-white/80 text-sm">{t('teleconsult.chat_mode')}</p>
            <button
              type="button"
              onClick={() => router.push('/patient/chat')}
              className="mt-3 bg-ocre-400 text-stone-900 font-display font-bold card-pagne px-4 py-2 text-[13px]"
            >
              {t('teleconsult.open_chat')}
            </button>
          </div>
        ) : (
          // roomUrl absent : Daily non configuré côté serveur → état gracieux.
          <div className="card-pagne stitch-light bg-indigo-900/60 w-[78%] aspect-[3/4] grid place-items-center p-6 text-center">
            <p className="text-white/60 text-sm">{t('teleconsult.room_preparing')}</p>
          </div>
        )}

        {/* PiP */}
        <div className="absolute bottom-4 right-4 w-20 h-28 card-pagne border-2 border-ocre-400 bg-black/40" />

        {(!online || mode !== 'VIDEO') && (
          <div className="absolute top-3 left-3 right-3 bg-ocre-400 text-stone-900 text-[12px] font-display font-bold card-pagne px-3 py-1 text-center">
            {t('teleconsult.low_network')} ({mode})
          </div>
        )}
      </div>

      <div className="p-5 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={downgrade}
          disabled={mode === 'CHAT'}
          className="bg-indigo-600 text-white font-display font-bold card-pagne px-4 py-3 text-[13px] disabled:opacity-50"
        >
          {t('teleconsult.downgrade')}
        </button>
        <button
          type="button"
          onClick={() => router.push('/patient')}
          className="bg-sos-500 text-white font-display font-extrabold card-pagne px-5 py-3 rotate-3"
        >
          {t('teleconsult.hangup')}
        </button>
      </div>
    </div>
  );
}

function TeleconsultFallback() {
  const { t } = useLocale();
  return (
    <div className="flex-1 bg-nuit text-white grid place-items-center">
      <div className="card-pagne bg-indigo-900/60 px-6 py-4">
        <p className="text-white/70 text-sm">{t('teleconsult.connecting')}</p>
      </div>
    </div>
  );
}

export default function TeleconsultPage() {
  return (
    <Suspense fallback={<TeleconsultFallback />}>
      <TeleconsultInner />
    </Suspense>
  );
}
