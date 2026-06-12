'use client';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { Badge, CardPagne } from '@/components/ui';
import { Empty, ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';

interface LabOrder {
  id: string;
  testType: string;
  status: string;
  createdAt: string;
  result: { id: string; values: Record<string, unknown>; reportUrl: string | null } | null;
}

// D-11 — Résultats de laboratoire (+ écoute audio Fɔ̀ngbè).
export default function ResultsPage() {
  const { t } = useLocale();
  const { data, loading, error } = useApi<LabOrder[]>(() => get('/lab/orders'), []);

  return (
    <>
      <PatientHeader title={t('results.title')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6">
        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && (data?.length ?? 0) === 0 && <Empty label={t('common.empty')} />}

        {(data ?? []).map((o) => (
          <CardPagne key={o.id} className="p-4">
            <div className="flex items-center justify-between">
              <p className="font-display font-extrabold text-[14px] text-stone-800">{o.testType}</p>
              <Badge variant={o.status === 'COMPLETED' ? 'normal' : 'eleve'}>{o.status}</Badge>
            </div>
            <p className="text-[12px] text-stone-400">{new Date(o.createdAt).toLocaleDateString('fr-FR', { dateStyle: 'medium' })}</p>

            {o.result && (
              <div className="mt-3 space-y-1">
                {Object.entries(o.result.values).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-[13px] border-b border-dashed border-stone-200 py-1">
                    <span className="text-stone-500">{k}</span>
                    <span className="font-display font-bold">{String(v)}</span>
                  </div>
                ))}
                <button type="button" className="mt-2 text-[13px] text-sante-700 underline decoration-dotted underline-offset-4">
                  {t('results.audio')}
                </button>
              </div>
            )}
          </CardPagne>
        ))}
      </main>
    </>
  );
}
