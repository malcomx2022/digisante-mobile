'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

import { ProHeader } from '@/components/pro/ProHeader';
import { Badge, Button, CardPagne, Nkyinkyim } from '@/components/ui';
import { Empty, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';

interface DmpRecord {
  id: string;
  type: string;
  title: string;
  data?: unknown;
  createdAt: string;
}

const BAR: Record<string, string> = {
  LAB_RESULT: 'bg-indigo-500',
  VACCINATION: 'bg-ocre-400',
  DIAGNOSIS: 'bg-sante-500',
  VITAL_SIGNS: 'bg-sante-500',
  ALLERGY: 'bg-sos-500',
};

// D-16 — Vue 360° patient (espace MÉDECIN PRO). L'accès au DMP passe par un
// partage consenti actif (CLAUDE.md §4). Le patientId est fourni en query
// (?patientId=...), typiquement après scan du QR de partage du patient.
// AUCUNE donnée médicale n'est codée en dur : tout vient de l'API, sous consentement.
function Patient360Inner() {
  const { t } = useLocale();
  const params = useSearchParams();
  const patientId = params.get('patientId');

  const { data, loading, error } = useApi<DmpRecord[]>(
    () => (patientId ? get(`/dmp/records?patientId=${encodeURIComponent(patientId)}`) : Promise.resolve([])),
    [patientId],
  );

  // Pas de patient sélectionné → invite à demander/scanner le partage consenti.
  if (!patientId) {
    return (
      <>
        <ProHeader title={t('pro.patient360')} />
        <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6">
          <CardPagne stitch="indigo" className="p-5 text-center">
            <p className="font-display font-extrabold text-[15px] text-stone-800">{t('pro.no_patient_title')}</p>
            <p className="text-[13px] text-stone-500 mt-2">{t('pro.no_patient_desc')}</p>
            <Nkyinkyim className="my-4" />
            <Button variant="indigo" full>
              {t('pro.scan_share')}
            </Button>
          </CardPagne>
          <ConsentNote />
        </main>
      </>
    );
  }

  // 403 → partage absent/expiré : on affiche l'état « accès non autorisé ».
  const isForbidden = error?.toLowerCase().includes('consent') || error?.toLowerCase().includes('partage') || error?.toLowerCase().includes('403');

  return (
    <>
      <ProHeader title={t('pro.patient360')} subtitle={patientId} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6">
        {loading && <Loading label={t('common.loading')} />}

        {!loading && error && (
          <CardPagne stitch="indigo" className="p-5 text-center">
            <p className="font-display font-extrabold text-[14px] text-stone-800">
              {isForbidden ? t('pro.access_denied_title') : t('common.empty')}
            </p>
            <p className="text-[13px] text-stone-500 mt-2">
              {isForbidden ? t('pro.access_denied_desc') : t('pro.load_error')}
            </p>
            <Nkyinkyim className="my-4" />
            <Button variant="indigo" full>
              {t('pro.request_share')}
            </Button>
          </CardPagne>
        )}

        {!loading && !error && (data?.length ?? 0) === 0 && <Empty label={t('pro.empty_dmp')} />}

        {!loading && !error && (data?.length ?? 0) > 0 && (
          <CardPagne stitch="indigo" className="p-4">
            <p className="font-display font-extrabold text-[13px] text-stone-700">{t('pro.dmp_records')}</p>
            <Nkyinkyim className="my-3" />
            <div className="space-y-3">
              {(data ?? []).map((r) => (
                <div key={r.id} className="flex gap-3">
                  <span className={`w-1.5 rounded-full ${BAR[r.type] ?? 'bg-stone-300'}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-display font-bold text-[14px] text-stone-800">{r.title}</p>
                      <Badge variant="indigo">{r.type}</Badge>
                    </div>
                    <p className="text-[12px] text-stone-400">
                      {new Date(r.createdAt).toLocaleDateString('fr-FR', { dateStyle: 'medium' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardPagne>
        )}

        <ConsentNote />
      </main>
    </>
  );
}

function ConsentNote() {
  const { t } = useLocale();
  return (
    <CardPagne className="p-4">
      <p className="font-display font-extrabold text-[13px] text-stone-700">{t('pro.access_section')}</p>
      <p className="text-[12px] text-stone-500 mt-1">{t('pro.access_note')}</p>
    </CardPagne>
  );
}

export default function Patient360Page() {
  return (
    <Suspense fallback={null}>
      <Patient360Inner />
    </Suspense>
  );
}
