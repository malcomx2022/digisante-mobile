'use client';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { Badge, CardPagne } from '@/components/ui';
import { Empty, ErrorState, SkeletonCards } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';
import { speak, speechSupported } from '@/lib/speech';

interface LabOrder {
  id: string;
  testType: string;
  status: string;
  createdAt: string;
  result: { id: string; values: Record<string, unknown>; reportUrl: string | null } | null;
}

// D-11 — Résultats de laboratoire (+ écoute audio Fɔ̀ngbè).
export default function ResultsPage() {
  const { t, lang } = useLocale();
  const { data, loading, error } = useApi<LabOrder[]>(() => get('/lab/orders'), []);

  // Lecture vocale d'un résultat (accessibilité — utilisateurs peu alphabétisés).
  function listen(o: LabOrder) {
    if (!o.result) return;
    const spoken = [
      o.testType,
      ...Object.entries(o.result.values).map(([k, v]) => `${k}: ${String(v)}`),
    ].join('. ');
    speak(spoken, lang);
  }

  return (
    <>
      <PatientHeader title={t('results.title')} wide />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6">
        {loading && <SkeletonCards label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && (data?.length ?? 0) === 0 && <Empty label={t('common.empty')} />}

        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {(data ?? []).map((o) => (
          <CardPagne key={o.id} className="p-4">
            <div className="flex items-center justify-between">
              <p className="font-display font-extrabold text-[0.875rem] text-stone-800">{o.testType}</p>
              <Badge variant={o.status === 'COMPLETED' ? 'normal' : 'eleve'}>{o.status}</Badge>
            </div>
            <p className="text-[0.75rem] text-stone-400">{new Date(o.createdAt).toLocaleDateString('fr-FR', { dateStyle: 'medium' })}</p>

            {o.result && (
              <div className="mt-3 space-y-1">
                {Object.entries(o.result.values).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-[0.8125rem] border-b border-dashed border-stone-200 py-1">
                    <span className="text-stone-500">{k}</span>
                    <span className="font-display font-bold">{String(v)}</span>
                  </div>
                ))}
                {speechSupported() && (
                  <button
                    type="button"
                    onClick={() => listen(o)}
                    className="mt-2 text-[0.8125rem] text-sante-700 underline decoration-dotted underline-offset-4"
                  >
                    {t('results.audio')}
                  </button>
                )}
              </div>
            )}
          </CardPagne>
        ))}
        </div>
      </main>
    </>
  );
}
