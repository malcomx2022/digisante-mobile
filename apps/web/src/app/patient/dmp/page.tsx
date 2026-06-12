'use client';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { CardPagne } from '@/components/ui';
import { Empty, ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';

interface DmpRecord {
  id: string;
  type: string;
  title: string;
  createdAt: string;
}

// Couleur de la barre latérale selon le type d'entrée (cf. D-04).
const BAR: Record<string, string> = {
  LAB_RESULT: 'bg-indigo-500',
  VACCINATION: 'bg-ocre-400',
  DIAGNOSIS: 'bg-sante-500',
  VITAL_SIGNS: 'bg-sante-500',
};

// D-04 — Dossier médical (DMP).
export default function DmpPage() {
  const { t } = useLocale();
  const { data, loading, error } = useApi<DmpRecord[]>(() => get('/dmp/records'), []);

  async function exportFhir() {
    try {
      const bundle = await get<unknown>('/dmp/export');
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/fhir+json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dmp-export.fhir.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <PatientHeader title={t('dmp.title')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6">
        <CardPagne className="p-4">
          <button
            type="button"
            onClick={exportFhir}
            className="w-full text-center text-[13px] font-display font-bold text-sante-700 underline decoration-dotted underline-offset-4"
          >
            {t('dmp.export')}
          </button>
        </CardPagne>

        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && (data?.length ?? 0) === 0 && <Empty label={t('common.empty')} />}

        <div className="space-y-3">
          {(data ?? []).map((r) => (
            <CardPagne key={r.id} className="p-4 flex gap-3">
              <span className={`w-1.5 rounded-full ${BAR[r.type] ?? 'bg-stone-300'}`} />
              <div className="flex-1">
                <p className="font-display font-bold text-[14px] text-stone-800">{r.title}</p>
                <p className="text-[12px] text-stone-400">
                  {r.type} · {new Date(r.createdAt).toLocaleDateString('fr-FR', { dateStyle: 'medium' })}
                </p>
              </div>
            </CardPagne>
          ))}
        </div>
      </main>
    </>
  );
}
