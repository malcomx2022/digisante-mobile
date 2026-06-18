'use client';

import { useState } from 'react';

import { ProHeader } from '@/components/pro/ProHeader';
import { Badge, Button, CardPagne, Nkyinkyim } from '@/components/ui';
import { Empty, ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { labResultsApi, type DoctorLabResult } from '@/lib/api/labResults';
import { useApi } from '@/lib/api/useApi';

// D-20 — Médecin : réception & interprétation des résultats de labo prescrits.
export default function ProResultsPage() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [signError, setSignError] = useState<Record<string, boolean>>({});
  const { data, loading, error } = useApi<DoctorLabResult[]>(() => labResultsApi.list(), [tick]);

  async function sign(id: string) {
    const text = (drafts[id] ?? '').trim();
    if (!text) return;
    setBusy(id);
    setSignError((e) => ({ ...e, [id]: false }));
    try {
      await labResultsApi.interpret(id, text);
      setTick((n) => n + 1);
    } catch {
      // Échec d'interprétation (ex. 403 non-prescripteur §4) → feedback par ligne.
      setSignError((e) => ({ ...e, [id]: true }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <ProHeader title={t('proresults.title')} subtitle={t('proresults.sub')} wide />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-5xl lg:mx-auto lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0 lg:items-start">
        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && (data?.length ?? 0) === 0 && <Empty label={t('proresults.empty')} />}

        {(data ?? []).map((r) => (
          <CardPagne key={r.id} stitch={r.critical.length > 0} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-display font-extrabold text-[14px] text-stone-800">{r.testType}</p>
                <p className="text-[13px] text-stone-500">{r.patient ? `${r.patient.firstName} ${r.patient.lastName}` : '—'}</p>
              </div>
              {r.critical.length > 0 ? (
                <Badge className="bg-sos-500 text-white"><span aria-hidden="true">⚠</span> {t('labo.critical_short')}</Badge>
              ) : (
                <Badge variant="indigo">{t('proresults.normal')}</Badge>
              )}
            </div>

            {/* Valeurs mesurées */}
            <ul className="mt-2 space-y-0.5">
              {Object.entries(r.values).map(([k, v]) => {
                const crit = r.critical.find((c) => c.key === k);
                return (
                  <li key={k} className="flex items-center justify-between text-[13px]">
                    <span className="text-stone-600">{k}</span>
                    <span className={crit ? 'text-sos-600 font-display font-bold' : 'text-stone-800'}>
                      {String(v)}{crit ? ` · ${t(`labo.reason.${crit.reason}`)}` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>

            <Nkyinkyim className="my-3" />

            {r.interpretation ? (
              <div className="bg-indigo-50 card-pagne p-3">
                <p className="text-[11px] font-display font-bold text-indigo-700">{t('proresults.interpreted')}</p>
                <p className="text-[13px] text-stone-700 mt-0.5 whitespace-pre-line">{r.interpretation}</p>
              </div>
            ) : (
              <>
                <textarea
                  value={drafts[r.id] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                  placeholder={t('proresults.placeholder')}
                  aria-label={t('proresults.placeholder')}
                  rows={2}
                  className="w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-[14px] focus:outline-none focus:border-indigo-600"
                />
                <Button variant="indigo" full className="mt-2" onClick={() => sign(r.id)} disabled={busy === r.id || !(drafts[r.id] ?? '').trim()}>
                  {t('proresults.sign')}
                </Button>
                {signError[r.id] && <p className="text-sos-600 font-bold text-[12px] mt-2">{t('auth.error')}</p>}
              </>
            )}
          </CardPagne>
        ))}
      </main>
    </>
  );
}
