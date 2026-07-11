'use client';

import { gestationalWeeks, TRIAGE_BY_ID, vaccinationDisplayStatus } from '@digisante/shared';
import Link from 'next/link';
import { useState } from 'react';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { Badge, Button, CardPagne, ConfirmDialog, Nkyinkyim } from '@/components/ui';
import { ErrorState, SkeletonCards } from '@/components/ui/States';
import { formatDate } from '@/i18n/format';
import { useLocale } from '@/i18n/LocaleProvider';
import { maternityApi, type AntenatalVisit, type Pregnancy } from '@/lib/api/maternity';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';

// D-08d — Santé maternelle : suivi de grossesse + rappels CPN + signes de danger.
// Enjeu majeur de mortalité maternelle en zones reculées. Cloisonnement §4.
const STATUS_TONE: Record<string, { badge: 'normal' | 'priorite' | 'eleve'; dot: string }> = {
  DONE: { badge: 'normal', dot: 'bg-sante-500' },
  OVERDUE: { badge: 'eleve', dot: 'bg-sos-500' },
  DUE_SOON: { badge: 'priorite', dot: 'bg-ocre-400' },
  UPCOMING: { badge: 'normal', dot: 'bg-stone-300' },
};

export default function MaternityPage() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const { data, loading, error } = useApi<Pregnancy | null>(() => maternityApi.getActive(), [tick]);
  const refresh = () => setTick((n) => n + 1);

  const [lmp, setLmp] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);

  async function start() {
    if (!lmp) return;
    setSaving(true);
    try {
      await maternityApi.start(lmp);
      setLmp('');
      refresh();
    } finally {
      setSaving(false);
    }
  }
  async function toggle(v: AntenatalVisit) {
    setBusyId(v.id);
    try {
      await maternityApi.setVisitDone(v.id, !v.doneAt);
      refresh();
    } finally {
      setBusyId(null);
    }
  }
  async function end() {
    await maternityApi.end();
    setConfirmEnd(false);
    refresh();
  }

  const now = new Date();
  const weeks = data ? gestationalWeeks(new Date(data.lmpDate), now) : 0;
  const dangerSigns = TRIAGE_BY_ID.PREGNANCY.questions;

  return (
    <>
      <PatientHeader title={t('maternity.title')} subtitle={t('maternity.subtitle')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto lg:w-full">
        {loading && !data && <SkeletonCards label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}

        {/* Aucune grossesse active → démarrer un suivi */}
        {!loading && !error && !data && (
          <CardPagne stitch className="p-4">
            <h2 className="font-display font-extrabold text-[0.9375rem] text-sante-800">{t('maternity.start')}</h2>
            <Nkyinkyim className="my-2" />
            <p className="text-[0.8125rem] text-stone-500 mb-2">{t('maternity.start_hint')}</p>
            <label className="block">
              <span className="font-display font-bold text-[0.75rem] text-stone-600">{t('maternity.lmp')}</span>
              <input
                type="date"
                value={lmp}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setLmp(e.target.value)}
                className="mt-1 w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-base pagne-focus focus:outline-none focus:border-sante-600"
              />
            </label>
            <Button variant="sante" full className="mt-3" disabled={saving || !lmp} onClick={start}>
              {saving ? t('common.loading') : t('maternity.start_btn')}
            </Button>
          </CardPagne>
        )}

        {data && (
          <>
            {/* Terme + âge gestationnel */}
            <CardPagne stitch className="p-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[0.625rem] text-stone-400 font-extrabold uppercase tracking-wide">{t('maternity.weeks')}</p>
                  <p className="font-display font-extrabold text-2xl text-sante-700">{t('maternity.weeks_val', { n: String(weeks) })}</p>
                </div>
                <div>
                  <p className="text-[0.625rem] text-stone-400 font-extrabold uppercase tracking-wide">{t('maternity.due')}</p>
                  <p className="font-display font-extrabold text-[1.0625rem] text-stone-900">{formatDate(data.dueDate)}</p>
                </div>
              </div>
            </CardPagne>

            {/* Consultations prénatales */}
            <section>
              <h2 className="font-display font-extrabold text-[0.875rem] text-stone-700 mb-2">{t('maternity.visits')}</h2>
              <CardPagne className="p-2">
                <ul>
                  {data.visits.map((v) => {
                    const st = vaccinationDisplayStatus({ status: v.doneAt ? 'DONE' : 'SCHEDULED', dueDate: new Date(v.dueDate) }, now);
                    const tone = STATUS_TONE[st];
                    return (
                      <li key={v.id} className="flex items-center gap-2 px-2 py-1.5">
                        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', tone.dot)} aria-hidden="true" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[0.8125rem] font-bold text-stone-800">
                            {t('maternity.visit_n', { n: String(v.contactNumber) })}
                            <span className="text-stone-400 font-normal"> · {formatDate(v.dueDate)}</span>
                          </p>
                          <p className="text-[0.6875rem] text-stone-500 leading-snug">{t(`maternity.objective.${v.contactNumber}`)}</p>
                        </div>
                        <Badge variant={tone.badge}>{t(`vaccinations.status.${st}`)}</Badge>
                        <button
                          type="button"
                          onClick={() => toggle(v)}
                          disabled={busyId === v.id}
                          aria-pressed={Boolean(v.doneAt)}
                          aria-label={t(v.doneAt ? 'vaccinations.mark_undone' : 'vaccinations.mark_done')}
                          className={cn(
                            'shrink-0 w-6 h-6 card-pagne grid place-items-center text-[0.75rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sante-600',
                            v.doneAt ? 'bg-sante-500 text-white' : 'bg-white border border-stone-300 text-transparent',
                          )}
                        >
                          <span aria-hidden="true">✓</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </CardPagne>
              <p className="mt-1.5 text-[0.6875rem] text-stone-400 leading-snug">{t('maternity.late_note')}</p>
            </section>

            {/* Signes de danger (réutilise le motif Grossesse du triage) */}
            <section>
              <h2 className="font-display font-extrabold text-[0.875rem] text-sos-700 mb-2">
                <span aria-hidden="true">⚠️ </span>{t('maternity.danger')}
              </h2>
              <CardPagne stitch="sos" className="p-3">
                <ul className="space-y-1 text-[0.8125rem] text-stone-700">
                  {dangerSigns.map((q) => (
                    <li key={q.key} className="flex gap-2">
                      <span className="text-sos-500" aria-hidden="true">•</span>
                      {t(`triage.q.${q.key}`)}
                    </li>
                  ))}
                </ul>
                <Link href="/patient/triage" className="block mt-3">
                  <Button variant="sos" full>{t('maternity.danger_check')}</Button>
                </Link>
              </CardPagne>
            </section>

            <Button variant="outline" full onClick={() => setConfirmEnd(true)}>{t('maternity.end')}</Button>
          </>
        )}
      </main>

      <ConfirmDialog
        open={confirmEnd}
        title={t('maternity.end')}
        message={t('maternity.end_confirm')}
        confirmLabel={t('maternity.end')}
        onConfirm={end}
        onCancel={() => setConfirmEnd(false)}
      />
    </>
  );
}
