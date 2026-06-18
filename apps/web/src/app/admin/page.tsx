'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Badge, Button, CardPagne } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get, post } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';

interface Metrics {
  users: Record<string, number>;
  consultations: { active: number; total: number };
  payments: { completedVolume: string | number; currency: string };
  kyc: { pendingReview: number };
  uptimeSeconds: number;
}
interface KycItem {
  id: string;
  status: string;
  user: { phone: string; role: string; profile: { firstName: string; lastName: string } | null };
}
interface Paginated<T> {
  data: T[];
  total: number;
}

function kycName(k: KycItem): string {
  return k.user.profile ? `${k.user.profile.firstName} ${k.user.profile.lastName}` : k.user.phone;
}

// D-24 — Admin métriques + file KYC.
export default function AdminMetrics() {
  const { t } = useLocale();
  const m = useApi<Metrics>(() => get('/admin/metrics'), []);
  const [tick, setTick] = useState(0);
  const queue = useApi<Paginated<KycItem>>(() => get('/kyc/submissions?pageSize=10'), [tick]);

  async function review(id: string, decision: 'APPROVED' | 'REJECTED') {
    await post(`/kyc/submissions/${id}/review`, { decision, notes: decision === 'REJECTED' ? 'Non conforme' : 'OK' }).catch(() => {});
    setTick((x) => x + 1);
  }

  const usersTotal = Object.values(m.data?.users ?? {}).reduce((a, b) => a + b, 0);
  // [valeur, libellé, accent couleur]
  const kpis: [string | number, string, string][] = [
    [usersTotal, t('admin.kpi_users'), 'text-indigo-700'],
    [m.data?.consultations?.total ?? 0, t('admin.kpi_consult'), 'text-stone-900'],
    [`${Number(m.data?.payments?.completedVolume ?? 0).toLocaleString('fr-FR')}`, t('admin.kpi_revenue'), 'text-terre-600'],
    [m.data?.kyc?.pendingReview ?? 0, t('admin.kpi_kyc'), 'text-ocre-500'],
  ];

  const items = queue.data?.data ?? [];

  return (
    <>
      <SpaceHeader title={t('admin.metrics')} headerClass="bg-indigo-950" profileHref="/admin/profile" wide />
      <main className="px-6 -mt-10 relative z-20 space-y-5 pb-6 lg:max-w-5xl lg:mx-auto lg:w-full">
        {m.loading && <Loading label={t('common.loading')} />}
        {m.error && <ErrorState label={t('auth.error')} />}

        {/* KPI */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          {kpis.map(([val, label, accent], i) => (
            <CardPagne key={i} stitch={i === 0 ? 'indigo' : false} className={cn('p-4', i % 2 ? 'lg:rotate-0 -rotate-1' : 'lg:rotate-0 rotate-1')}>
              <p className="text-[0.625rem] text-stone-400 font-extrabold uppercase tracking-wide mb-1">{label}</p>
              <p className={cn('font-display font-extrabold text-2xl lg:text-[1.625rem] leading-none', accent)}>{val}</p>
            </CardPagne>
          ))}
        </div>

        {/* File KYC */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-display font-extrabold text-[0.875rem] text-stone-700">
              {t('admin.kyc_queue')} {m.data?.kyc?.pendingReview ? `(${m.data.kyc.pendingReview})` : ''}
            </h2>
            <Link href="/admin/kyc" className="text-[0.75rem] text-indigo-700 font-display font-bold">
              {t('adminkyc.review')} →
            </Link>
          </div>
          {queue.loading && <Loading label={t('common.loading')} />}
          {!queue.loading && items.length === 0 && <p className="text-[0.8125rem] text-stone-400">{t('common.empty')}</p>}

          {/* Mobile : cartes */}
          <div className="lg:hidden grid gap-3 grid-cols-1 sm:grid-cols-2">
            {items.map((k) => (
              <CardPagne key={k.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="font-display font-bold text-[0.875rem] truncate">{kycName(k)}</p>
                    <p className="text-[0.75rem] text-stone-400">{k.user.role}</p>
                  </div>
                  <Badge variant="eleve">{k.status}</Badge>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button variant="terre" className="text-[0.75rem] px-3 py-1.5" onClick={() => review(k.id, 'APPROVED')}>{t('admin.approve')}</Button>
                  <Button variant="sos" className="text-[0.75rem] px-3 py-1.5" onClick={() => review(k.id, 'REJECTED')}>{t('admin.reject')}</Button>
                </div>
              </CardPagne>
            ))}
          </div>

          {/* Desktop : table */}
          {items.length > 0 && (
            <div className="hidden lg:block bg-white card-pagne border border-stone-200 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-creme">
                    <th className="text-left px-5 py-2.5 text-[0.625rem] font-extrabold text-stone-400 uppercase tracking-wide">{t('admin.col_user')}</th>
                    <th className="text-left px-3 py-2.5 text-[0.625rem] font-extrabold text-stone-400 uppercase tracking-wide">{t('admin.col_role')}</th>
                    <th className="text-left px-3 py-2.5 text-[0.625rem] font-extrabold text-stone-400 uppercase tracking-wide">{t('admin.col_status')}</th>
                    <th className="text-right px-5 py-2.5 text-[0.625rem] font-extrabold text-stone-400 uppercase tracking-wide">{t('admin.col_action')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {items.map((k) => (
                    <tr key={k.id} className="hover:bg-creme">
                      <td className="px-5 py-2.5 font-bold text-[0.8125rem] text-stone-900">{kycName(k)}</td>
                      <td className="px-3 py-2.5"><span className="px-2 py-0.5 card-pagne bg-indigo-50 text-indigo-600 text-[0.59375rem] font-extrabold">{k.user.role}</span></td>
                      <td className="px-3 py-2.5"><Badge variant="eleve">{k.status}</Badge></td>
                      <td className="px-5 py-2.5">
                        <div className="flex gap-1.5 justify-end">
                          <Button variant="terre" className="text-[0.6875rem] px-2.5 py-1" onClick={() => review(k.id, 'APPROVED')}>{t('admin.approve')}</Button>
                          <Button variant="sos" className="text-[0.6875rem] px-2.5 py-1" onClick={() => review(k.id, 'REJECTED')}>{t('admin.reject')}</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
