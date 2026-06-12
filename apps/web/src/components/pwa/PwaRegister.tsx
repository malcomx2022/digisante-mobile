'use client';

import { useEffect } from 'react';

import { flushQueue } from '@/lib/api/client';

/** Enregistre le service worker et rejoue la file hors-ligne au retour du réseau. */
export function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* l'app reste utilisable même si le SW échoue */
    });

    const onOnline = () => {
      void flushQueue();
    };
    window.addEventListener('online', onOnline);
    // Tentative initiale (cas où des mutations restaient en file).
    if (navigator.onLine) void flushQueue();

    return () => window.removeEventListener('online', onOnline);
  }, []);

  return null;
}
