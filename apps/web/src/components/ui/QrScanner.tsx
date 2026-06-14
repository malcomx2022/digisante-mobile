'use client';

import { useEffect, useRef, useState } from 'react';

import { CardPagne } from '@/components/ui';
import { useLocale } from '@/i18n/LocaleProvider';

// API native BarcodeDetector (Chrome/Android — audience principale). Absente sur
// iOS Safari → repli sur la saisie manuelle (déjà présente sur les écrans appelants).
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorInstance {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorInstance;

function getDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return w.BarcodeDetector ?? null;
}

/**
 * Lecteur de QR code via la caméra (en-vironnement arrière). Appelle `onResult`
 * avec la valeur décodée puis se ferme. Repli gracieux si non supporté / refusé.
 */
export function QrScanner({
  title,
  onResult,
  onClose,
}: {
  title?: string;
  onResult: (value: string) => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const Ctor = getDetectorCtor();
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) {
      setError(t('scan.unsupported'));
      return;
    }

    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const detector = new Ctor({ formats: ['qr_code'] });

    const tick = async () => {
      if (stopped || !videoRef.current) return;
      try {
        const codes = await detector.detect(videoRef.current);
        const hit = codes.find((c) => c.rawValue);
        if (hit) {
          stopped = true;
          onResult(hit.rawValue);
          return;
        }
      } catch {
        /* image illisible sur cette frame : on réessaie */
      }
      timer = setTimeout(tick, 300);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        timer = setTimeout(tick, 300);
      } catch {
        setError(t('scan.denied'));
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-nuit/70 px-4 py-6" role="dialog" aria-modal="true">
      <CardPagne stitch className="w-full max-w-md p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="font-display font-extrabold text-[15px] text-stone-800">{title ?? t('scan.title')}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-stone-400 font-display font-extrabold text-lg leading-none px-2"
          >
            ✕
          </button>
        </div>

        <div className="relative mt-3 card-pagne overflow-hidden bg-nuit border-2 border-ocre-400 aspect-square">
          <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
          {!error && <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-ocre-400 scan-line" />}
          {error && (
            <div className="absolute inset-0 grid place-items-center p-4 text-center">
              <p className="text-white/80 text-[13px]">{error}</p>
            </div>
          )}
        </div>

        <p className="text-[12px] text-stone-500 mt-3 text-center">{error ? t('scan.fallback') : t('scan.hint')}</p>
      </CardPagne>
    </div>
  );
}
