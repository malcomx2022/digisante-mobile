import { useEffect, useState } from 'react';

/** État réseau réactif (online/offline). Sûr côté SSR (true par défaut). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}

/** Lecture ponctuelle (hors React). */
export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}
