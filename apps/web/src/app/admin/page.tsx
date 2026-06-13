'use client';

import { useState } from 'react';

import { Badge, Button, CardPagne } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get, post } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';

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
  const kpis = [
    [usersTotal, t('admin.kpi_users')],
    [m.data?.consultations.total ?? 0, t('admin.kpi_consult')],
    [`${Number(m.data?.payments.completedVolume ?? 0).toLocaleString('fr-FR')}`, t('admin.kpi_revenue')],
    [`${Math.round((m.data?.uptimeSeconds ?? 0) / 3600)}h`, t('admin.kpi_uptime')],
  ] as const;

  return (
    <>
      <SpaceHeader title={t('admin.metrics')} headerClass="bg-indigo-950" profileHref="/admin/profile" />
      <main className="px-6 -mt-10 relative z-20 space-y-5 pb-6">
        {m.loading && <Loading label={t('common.loading')} />}
        <div className="grid grid-cols-2 gap-3">
          {kpis.map(([val, label], i) => (
            <CardPagne key={i} stitch={i === 0 ? 'indigo' : false} className={`p-4 ${i % 2 ? '-rotate-1' : 'rotate-1'}`}>
              <p className="font-display font-extrabold text-2xl text-indigo-700">{val}</p>
              <p className="text-[11px] text-stone-400">{label}</p>
            </CardPagne>
          ))}
        </div>

        <div>
          <h2 className="font-display font-extrabold text-[14px] text-stone-700 mb-2">
            {t('admin.kyc_queue')} {m.data?.kyc.pendingReview ? `(${m.data.kyc.pendingReview})` : ''}
          </h2>
          {queue.loading && <Loading label={t('common.loading')} />}
          <div className="space-y-3">
            {(queue.data?.data ?? []).map((k) => (
              <CardPagne key={k.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-display font-bold text-[14px]">{k.user.profile ? `${k.user.profile.firstName} ${k.user.profile.lastName}` : k.user.phone}</p>
                    <p className="text-[12px] text-stone-400">{k.user.role}</p>
                  </div>
                  <Badge variant="eleve">{k.status}</Badge>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button variant="sante" className="text-[12px] px-3 py-1.5" onClick={() => review(k.id, 'APPROVED')}>
                    {t('admin.approve')}
                  </Button>
                  <Button variant="sos" className="text-[12px] px-3 py-1.5" onClick={() => review(k.id, 'REJECTED')}>
                    {t('admin.reject')}
                  </Button>
                </div>
              </CardPagne>
            ))}
            {!queue.loading && (queue.data?.data?.length ?? 0) === 0 && <p className="text-[13px] text-stone-400">{t('common.empty')}</p>}
          </div>
        </div>
      </main>
    </>
  );
}
