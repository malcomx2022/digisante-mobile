'use client';

import Link from 'next/link';
import { useState } from 'react';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { CardPagne } from '@/components/ui';
import { useLocale } from '@/i18n/LocaleProvider';
import { post } from '@/lib/api/client';
import { buildSosSmsLink, SOS_NUMBER } from '@/lib/sos';

// D-07 — SOS : bouton octogonal, géoloc, alerte API en ligne + repli SMS hors-ligne.
export default function SosPage() {
  const { t } = useLocale();
  const [status, setStatus] = useState<'idle' | 'locating' | 'sent'>('idle');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  function trigger() {
    setStatus('locating');
    const finish = async (latitude?: number, longitude?: number) => {
      if (latitude != null && longitude != null) {
        setCoords({ latitude, longitude });
        try {
          await post('/sos', { latitude, longitude });
        } catch {
          /* hors-ligne → file ; le SMS reste disponible ci-dessous */
        }
      }
      setStatus('sent');
    };
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => finish(p.coords.latitude, p.coords.longitude),
        () => finish(),
        { timeout: 8000 },
      );
    } else {
      finish();
    }
  }

  return (
    <>
      <PatientHeader title={t('sos.title')} />
      <main className="px-6 -mt-10 relative z-20 space-y-5 pb-6">
        <div className="flex flex-col items-center pt-4">
          <button type="button" onClick={trigger} aria-label={t('sos.title')} className="sos-octogone pulse-sos w-44 h-44 text-white font-display font-extrabold text-xl grid place-items-center">
            SOS
          </button>
          <p className="mt-4 text-[13px] text-stone-500">
            {status === 'locating' ? t('sos.locating') : status === 'sent' ? `✓ ${t('sos.sent')}` : t('sos.tap')}
          </p>
          {coords && (
            <p className="text-[12px] text-stone-400">
              📍 {coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)}
            </p>
          )}
        </div>

        {/* Repli SMS — toujours disponible, même hors-ligne */}
        <a href={buildSosSmsLink(coords ?? {})} className="block w-full text-center bg-sos-600 text-white font-display font-extrabold card-pagne py-3">
          {t('sos.sms')}
        </a>

        {/* Fiche d'urgence : groupe sanguin, allergies, contact — visible par les secours */}
        <Link href="/patient/emergency" className="block w-full text-center bg-white card-pagne border border-stone-300 text-stone-800 font-display font-extrabold py-3">
          🩸 {t('sos.emergency_card')}
        </Link>

        <CardPagne className="p-4">
          <p className="font-display font-extrabold text-[13px] text-stone-700 mb-2">{t('sos.numbers')}</p>
          <a href="tel:112" className="flex items-center justify-between py-2 border-b border-dashed border-stone-200">
            <span className="font-bold">{t('sos.samu')}</span>
            <span className="text-sos-600 font-display font-extrabold">112</span>
          </a>
          <a href={`tel:${SOS_NUMBER}`} className="flex items-center justify-between py-2">
            <span className="font-bold">Contact d’urgence</span>
            <span className="text-sante-700 font-display font-extrabold">{SOS_NUMBER}</span>
          </a>
        </CardPagne>
      </main>
    </>
  );
}
