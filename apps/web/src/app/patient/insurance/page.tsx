'use client';

import { useState } from 'react';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { Badge, Button, CardPagne, ConfirmDialog, Nkyinkyim } from '@/components/ui';
import { Empty, ErrorState , SkeletonCards } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { insuranceApi, type Coverage, type InsuranceProvider } from '@/lib/api/insurance';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';
import { formatDate } from '@/i18n/format';

const STATUS_VARIANT: Record<string, 'normal' | 'eleve' | 'pro'> = {
  ACTIVE: 'normal',
  EXPIRED: 'pro',
  SUSPENDED: 'eleve',
};

// D-25 — Couverture d'assurance santé du patient (ARCH/AMU, CNSS, mutuelles).
export default function InsurancePage() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const [providerId, setProviderId] = useState('');
  const [memberNumber, setMemberNumber] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const { data: providers } = useApi<InsuranceProvider[]>(() => insuranceApi.providers(), []);
  const { data: coverages, loading, error } = useApi<Coverage[]>(() => insuranceApi.mine(), [tick]);

  async function add() {
    if (!providerId || !memberNumber.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      await insuranceApi.add({
        insuranceId: providerId,
        memberNumber: memberNumber.trim(),
        expiresAt: expiresAt || undefined,
      });
      setProviderId('');
      setMemberNumber('');
      setExpiresAt('');
      setTick((n) => n + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('auth.error'));
    } finally {
      setSubmitting(false);
    }
  }

  // Confirmation avant suppression (action destructive) via dialogue stylé.
  function remove(id: string) {
    setErr(null);
    setPendingRemove(id);
  }

  async function confirmRemove() {
    if (!pendingRemove) return;
    setRemoving(true);
    setErr(null);
    try {
      await insuranceApi.remove(pendingRemove);
      setPendingRemove(null);
      setTick((n) => n + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('auth.error'));
      setPendingRemove(null);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <>
      <PatientHeader title={t('insurance.title')} subtitle={t('insurance.subtitle')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto lg:w-full">
        {/* Mes couvertures */}
        {loading && <SkeletonCards label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && (coverages?.length ?? 0) === 0 && <Empty label={t('insurance.none')} />}
        {err && <p className="text-terre-600 font-bold text-[0.8125rem]">{err}</p>}

        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {(coverages ?? []).map((c) => (
            <CardPagne key={c.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <p className="font-display font-extrabold text-[0.875rem] text-stone-800">{c.insurance.name}</p>
                  <p className="text-[0.8125rem] text-stone-500">N° {c.memberNumber}</p>
                  {c.insurance.coverageTypes.length > 0 && (
                    <p className="text-[0.75rem] text-stone-400 mt-1">
                      {c.insurance.coverageTypes.map((ct) => t(`insurance.cov.${ct}`)).join(' · ')}
                    </p>
                  )}
                  {c.expiresAt && (
                    <p className="text-[0.75rem] text-ocre-600 mt-1">
                      {t('insurance.expires', { date: formatDate(c.expiresAt) })}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge variant={STATUS_VARIANT[c.status] ?? 'normal'}>{t(`insurance.status.${c.status}`)}</Badge>
                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    className="text-[0.75rem] text-terre-600 font-display font-bold"
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </div>
            </CardPagne>
          ))}
        </div>

        {/* Déclarer une couverture */}
        <CardPagne stitch className="p-4">
          <p className="font-display font-extrabold text-[0.8125rem] text-stone-700">{t('insurance.add')}</p>
          <Nkyinkyim className="my-3" />

          <div className="space-y-2">
            {(providers ?? []).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setProviderId(p.id === providerId ? '' : p.id)}
                className={cn(
                  'w-full text-left card-pagne px-3 py-2 border-2 text-[0.8125rem] font-display font-bold',
                  p.id === providerId ? 'bg-sante-600 text-white border-stone-900' : 'bg-white text-stone-700 border-stone-200',
                )}
              >
                {p.name}
              </button>
            ))}
          </div>

          <input
            value={memberNumber}
            onChange={(e) => setMemberNumber(e.target.value)}
            placeholder={t('insurance.member_number')}
            aria-label={t('insurance.member_number')}
            className="mt-3 w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-base pagne-focus focus:outline-none focus:border-sante-600"
          />
          <label className="block text-[0.75rem] text-stone-500 mt-2">{t('insurance.expires_at')}</label>
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            aria-label={t('insurance.expires_at')}
            className="mt-1 w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-base pagne-focus focus:outline-none focus:border-sante-600"
          />

          {err && <p className="text-terre-600 text-[0.8125rem] mt-2">{err}</p>}
          <Button variant="sante" full className="mt-3" onClick={add} disabled={submitting || !providerId || !memberNumber.trim()}>
            {t('insurance.add')}
          </Button>
        </CardPagne>
      </main>

      <ConfirmDialog
        open={!!pendingRemove}
        danger
        busy={removing}
        title={t('common.delete')}
        message={t('common.delete_confirm')}
        confirmLabel={t('common.delete')}
        onConfirm={confirmRemove}
        onCancel={() => setPendingRemove(null)}
      />
    </>
  );
}
