'use client';

import { useEffect, useState } from 'react';

// QR généré LOCALEMENT (lib qrcode, import dynamique) → fonctionne hors-ligne et
// n'envoie aucune donnée à un tiers (important pour les jetons de partage DMP, §4).
export function QrImage({
  value,
  size = 120,
  alt,
  className,
}: {
  value: string;
  size?: number;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    void import('qrcode')
      .then((QR) => QR.toDataURL(value, { margin: 1, width: size, errorCorrectionLevel: 'M' }))
      .then((url) => {
        if (active) setSrc(url);
      })
      .catch(() => {
        // Génération impossible → fallback texte visible (pas un div vide permanent).
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [value, size]);

  if (failed) {
    return (
      <div
        className={className}
        style={{ width: size, height: size }}
        role="img"
        aria-label={alt}
      >
        <span className="grid h-full w-full place-items-center text-center text-[0.5625rem] font-bold text-stone-500">
          QR ✕
        </span>
      </div>
    );
  }

  if (!src) {
    return <div className={className} style={{ width: size, height: size }} aria-hidden />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={size} height={size} className={className} />;
}
