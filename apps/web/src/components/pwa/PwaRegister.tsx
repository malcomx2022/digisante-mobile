'use client';

import { useEffect, useState } from 'react';

import { useLocale } from '@/i18n/LocaleProvider';
import { flushQueue } from '@/lib/api/client';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Enregistre le service worker, rejoue la file hors-ligne au retour du réseau,
 * et propose : (1) l'installation de la PWA (beforeinstallprompt), (2) le
 * rechargement quand une nouvelle version du SW est prête (pas d'auto-reload :
 * on ne casse pas une session active).
 */
export function PwaRegister() {
  const { t } = useLocale();
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            // Mise à jour (et non première installation) prête → proposer le rechargement.
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              setUpdateReady(true);
            }
          });
        });
      })
      .catch(() => {
        /* l'app reste utilisable même si le SW échoue */
      });

    const onOnline = () => void flushQueue();
    window.addEventListener('online', onOnline);
    if (navigator.onLine) void flushQueue();
    return () => window.removeEventListener('online', onOnline);
  }, []);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      if (sessionStorage.getItem('pwa.install.dismissed')) return;
      setInstallEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  async function install() {
    if (!installEvt) return;
    await installEvt.prompt();
    await installEvt.userChoice.catch(() => undefined);
    setInstallEvt(null);
  }

  function dismissInstall() {
    sessionStorage.setItem('pwa.install.dismissed', '1');
    setInstallEvt(null);
  }

  if (updateReady) {
    return (
      <div className="fixed bottom-24 inset-x-4 z-[60] flex items-center gap-3 bg-nuit text-white card-pagne px-4 py-3 shadow-[0_10px_26px_rgba(0,0,0,.35)]">
        <span className="flex-1 text-[0.8125rem] font-display font-bold">{t('pwa.update')}</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="shrink-0 card-pagne bg-sante-600 text-white font-display font-extrabold text-[0.75rem] px-3 py-1.5"
        >
          {t('pwa.reload')}
        </button>
      </div>
    );
  }

  if (installEvt) {
    return (
      <div className="fixed bottom-24 inset-x-4 z-[60] flex items-center gap-3 bg-white card-pagne border border-stone-200 px-4 py-3 shadow-[0_10px_26px_rgba(0,0,0,.18)]">
        <span className="flex-1 text-[0.8125rem] font-display font-bold text-stone-700">{t('pwa.install')}</span>
        <button type="button" onClick={dismissInstall} className="shrink-0 text-[0.75rem] text-stone-400">
          {t('pwa.later')}
        </button>
        <button
          type="button"
          onClick={install}
          className="shrink-0 card-pagne bg-sante-600 text-white font-display font-extrabold text-[0.75rem] px-3 py-1.5"
        >
          {t('pwa.install_cta')}
        </button>
      </div>
    );
  }

  return null;
}
