'use client';

import { useState } from 'react';

import { useLocale } from '@/i18n/LocaleProvider';
import { useOnline } from '@/lib/offline/online';

type Mode = 'VIDEO' | 'AUDIO' | 'CHAT';

// D-06 — Téléconsultation (salle Daily.co). Bascule chat auto si réseau faible.
export default function TeleconsultPage() {
  const { t } = useLocale();
  const online = useOnline();
  const [mode, setMode] = useState<Mode>('VIDEO');

  function downgrade() {
    setMode((m) => (m === 'VIDEO' ? 'AUDIO' : 'CHAT'));
  }

  return (
    <div className="flex-1 bg-nuit text-white flex flex-col">
      <div className="relative flex-1 wax-dark flex items-center justify-center">
        <div className="card-pagne stitch-light bg-indigo-900/60 w-[78%] aspect-[3/4] grid place-items-center">
          <p className="text-white/60 text-sm">{t('teleconsult.waiting')}</p>
        </div>
        {/* PiP */}
        <div className="absolute bottom-4 right-4 w-20 h-28 card-pagne border-2 border-ocre-400 bg-black/40" />
        {(!online || mode !== 'VIDEO') && (
          <div className="absolute top-3 left-3 right-3 bg-ocre-400 text-stone-900 text-[12px] font-display font-bold card-pagne px-3 py-1 text-center">
            {t('teleconsult.low_network')} ({mode})
          </div>
        )}
      </div>

      <div className="p-5 flex items-center justify-center gap-4">
        <button type="button" onClick={downgrade} className="bg-indigo-600 text-white font-display font-bold card-pagne px-4 py-3 text-[13px]">
          {t('teleconsult.downgrade')}
        </button>
        <button type="button" className="bg-sos-500 text-white font-display font-extrabold card-pagne px-5 py-3 rotate-3">
          {t('teleconsult.hangup')}
        </button>
      </div>
    </div>
  );
}
