'use client';

import { PEV_BY_CODE, type VaccinationDisplayStatus, vaccinationDisplayStatus } from '@digisante/shared';
import { useState } from 'react';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { Badge, Button, CardPagne, ConfirmDialog, Nkyinkyim } from '@/components/ui';
import { Empty, ErrorState, SkeletonCards } from '@/components/ui/States';
import { formatDate } from '@/i18n/format';
import { useLocale } from '@/i18n/LocaleProvider';
import { vaccinationsApi, type Vaccination, type VaccinationSubject } from '@/lib/api/vaccinations';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';

// D-08c — Carnet de vaccination PEV : le patient suit ses vaccins et ceux de ses
// enfants (échéances générées depuis la date de naissance) + rappels multilingues.
// Enjeu majeur en zones reculées (mortalité infantile). Cloisonnement §4.
const STATUS_TONE: Record<VaccinationDisplayStatus, { badge: 'normal' | 'priorite' | 'eleve'; dot: string }> = {
  DONE: { badge: 'normal', dot: 'bg-sante-500' },
  OVERDUE: { badge: 'eleve', dot: 'bg-sos-500' },
  DUE_SOON: { badge: 'priorite', dot: 'bg-ocre-400' },
  UPCOMING: { badge: 'normal', dot: 'bg-stone-300' },
};

export default function VaccinationsPage() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const { data, loading, error } = useApi<VaccinationSubject[]>(() => vaccinationsApi.list(), [tick]);
  const refresh = () => setTick((n) => n + 1);

  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [isSelf, setIsSelf] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<VaccinationSubject | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function addSubject() {
    if (!name.trim() || !birthDate) return;
    setSaving(true);
    setFormErr(null);
    try {
      await vaccinationsApi.addSubject({ name: name.trim(), birthDate, isSelf });
      setName('');
      setBirthDate('');
      setIsSelf(false);
      refresh();
    } catch {
      setFormErr(t('auth.error'));
    } finally {
      setSaving(false);
    }
  }

  async function toggleDone(v: Vaccination) {
    setBusyId(v.id);
    try {
      await vaccinationsApi.setAdministered(v.id, v.status !== 'DONE');
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function removeSubject() {
    if (!toDelete) return;
    await vaccinationsApi.removeSubject(toDelete.id);
    setToDelete(null);
    refresh();
  }

  return (
    <>
      <PatientHeader title={t('vaccinations.title')} subtitle={t('vaccinations.subtitle')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto lg:w-full">
        {/* Ajout d'un sujet (soi ou un enfant) */}
        <CardPagne stitch className="p-4">
          <h2 className="font-display font-extrabold text-[0.9375rem] text-sante-800">{t('vaccinations.add')}</h2>
          <Nkyinkyim className="my-2" />
          <div className="space-y-2">
            <label className="block">
              <span className="font-display font-bold text-[0.75rem] text-stone-600">{t('vaccinations.name')}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('vaccinations.name_ph')}
                className="mt-1 w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-base pagne-focus focus:outline-none focus:border-sante-600"
              />
            </label>
            <label className="block">
              <span className="font-display font-bold text-[0.75rem] text-stone-600">{t('vaccinations.birthdate')}</span>
              <input
                type="date"
                value={birthDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setBirthDate(e.target.value)}
                className="mt-1 w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-base pagne-focus focus:outline-none focus:border-sante-600"
              />
            </label>
            <label className="flex items-center gap-2 text-[0.8125rem] text-stone-600">
              <input type="checkbox" checked={isSelf} onChange={(e) => setIsSelf(e.target.checked)} className="w-4 h-4 accent-sante-600" />
              {t('vaccinations.is_self')}
            </label>
            {formErr && <p className="text-[0.75rem] text-sos-600 font-bold">{formErr}</p>}
            <Button variant="sante" disabled={saving || !name.trim() || !birthDate} onClick={addSubject}>
              {saving ? t('common.loading') : t('vaccinations.generate')}
            </Button>
          </div>
        </CardPagne>

        {loading && !data && <SkeletonCards label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && (data?.length ?? 0) === 0 && <Empty label={t('vaccinations.empty')} />}

        {(data ?? []).map((s) => (
          <SubjectCard key={s.id} subject={s} busyId={busyId} onToggle={toggleDone} onDelete={() => setToDelete(s)} />
        ))}
      </main>

      <ConfirmDialog
        open={toDelete !== null}
        danger
        title={t('vaccinations.delete')}
        message={toDelete ? t('vaccinations.delete_confirm', { name: toDelete.name }) : ''}
        confirmLabel={t('vaccinations.delete')}
        onConfirm={removeSubject}
        onCancel={() => setToDelete(null)}
      />
    </>
  );
}

function SubjectCard({
  subject,
  busyId,
  onToggle,
  onDelete,
}: {
  subject: VaccinationSubject;
  busyId: string | null;
  onToggle: (v: Vaccination) => void;
  onDelete: () => void;
}) {
  const { t } = useLocale();
  const now = new Date();
  const done = subject.vaccinations.filter((v) => v.status === 'DONE').length;
  const overdue = subject.vaccinations.filter((v) => vaccinationDisplayStatus({ status: v.status, dueDate: new Date(v.dueDate) }, now) === 'OVERDUE').length;

  return (
    <CardPagne className="overflow-hidden">
      <div className="bg-sante-900 bogolan-dark p-4 text-white flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display font-extrabold flex items-center gap-2">
            {subject.name}
            {subject.isSelf && <span className="text-[0.625rem] bg-white/20 card-pagne px-1.5 py-0.5">{t('vaccinations.me')}</span>}
          </p>
          <p className="text-[0.75rem] text-white/80">{t('vaccinations.born', { date: formatDate(subject.birthDate) })}</p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          aria-label={t('vaccinations.delete')}
          className="shrink-0 text-white/80 hover:text-white card-pagne px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70"
        >
          <span aria-hidden="true">🗑</span>
        </button>
      </div>

      <div className="px-4 py-2 flex items-center gap-3 text-[0.6875rem] font-bold border-b border-stone-100">
        <span className="text-sante-700">{t('vaccinations.done_count', { n: String(done) })}</span>
        {overdue > 0 && <span className="text-sos-600">{t('vaccinations.overdue_count', { n: String(overdue) })}</span>}
      </div>

      <ul className="p-2">
        {subject.vaccinations.map((v) => {
          const st = vaccinationDisplayStatus({ status: v.status, dueDate: new Date(v.dueDate) }, now);
          const tone = STATUS_TONE[st];
          const vaccineKey = PEV_BY_CODE[v.vaccineCode]?.vaccineKey ?? v.vaccineCode;
          return (
            <li key={v.id} className="flex items-center gap-2 px-2 py-1.5">
              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', tone.dot)} aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="text-[0.8125rem] font-bold text-stone-800 truncate">
                  {t(`vaccine.${vaccineKey}`)}
                  {v.doseLabel && <span className="text-stone-400"> · {v.doseLabel}</span>}
                </p>
                <p className="text-[0.6875rem] text-stone-400">{formatDate(v.dueDate)}</p>
              </div>
              <Badge variant={tone.badge}>{t(`vaccinations.status.${st}`)}</Badge>
              <button
                type="button"
                onClick={() => onToggle(v)}
                disabled={busyId === v.id}
                aria-pressed={v.status === 'DONE'}
                aria-label={t(v.status === 'DONE' ? 'vaccinations.mark_undone' : 'vaccinations.mark_done')}
                className={cn(
                  'shrink-0 w-6 h-6 card-pagne grid place-items-center text-[0.75rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sante-600',
                  v.status === 'DONE' ? 'bg-sante-500 text-white' : 'bg-white border border-stone-300 text-transparent',
                )}
              >
                <span aria-hidden="true">✓</span>
              </button>
            </li>
          );
        })}
      </ul>
    </CardPagne>
  );
}
