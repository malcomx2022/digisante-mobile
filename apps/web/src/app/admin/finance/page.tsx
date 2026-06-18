'use client';

import { CardPagne } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { ErrorState, SkeletonCards } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { financeApi, type FinanceOverview, type WebhookEntry } from '@/lib/api/finance';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';

function xof(v: string | number): string {
  return Number(v).toLocaleString('fr-FR');
}
function dt(s: string): string {
  return new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

// D-25e — Finances (back-office) : volumes paiements, réconciliation, wallets,
// journal des webhooks FedaPay. LECTURE SEULE — la logique §5 reste gelée.
export default function AdminFinance() {
  const { t } = useLocale();
  const ov = useApi<FinanceOverview>(() => financeApi.overview(30), []);
  const wh = useApi<{ data: WebhookEntry[]; total: number }>(() => financeApi.webhooks(1, 20), []);
  const data = ov.data;

  const totalVolume = data?.payments.byStatus.reduce((a, b) => a + Number(b.volume), 0) ?? 0;
  const completed = data?.payments.byStatus.find((b) => b.status === 'COMPLETED');

  // [valeur, libellé, accent]
  const kpis: [string | number, string, string][] = [
    [xof(totalVolume), t('finance.kpi_volume'), 'text-terre-600'],
    [xof(completed?.volume ?? 0), t('finance.kpi_completed'), 'text-sante-700'],
    [data?.reconciliation.backlog ?? 0, t('finance.kpi_backlog'), 'text-ocre-500'],
    [xof(data?.wallets.totalBalance ?? 0), t('finance.kpi_wallets'), 'text-indigo-700'],
  ];

  return (
    <>
      <SpaceHeader title={t('admin.finance')} subtitle={t('finance.subtitle')} headerClass="bg-indigo-950" wide />
      <main className="px-6 -mt-10 relative z-20 pb-6 lg:max-w-5xl lg:mx-auto lg:w-full space-y-5">
        {ov.error && <ErrorState label={t('auth.error')} />}
        {ov.loading && !data && <SkeletonCards count={4} label={t('common.loading')} />}

        {data && (
          <>
            {/* KPI */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
              {kpis.map(([val, label, accent], i) => (
                <CardPagne key={i} stitch={i === 0 ? 'indigo' : false} className={cn('p-4', i % 2 ? 'lg:rotate-0 -rotate-1' : 'lg:rotate-0 rotate-1')}>
                  <p className="text-[0.625rem] text-stone-400 font-extrabold uppercase tracking-wide mb-1">{label}</p>
                  <p className={cn('font-display font-extrabold text-2xl lg:text-[1.625rem] leading-none', accent)}>{val}</p>
                </CardPagne>
              ))}
            </div>
            <p className="text-[0.6875rem] text-stone-400 -mt-2">{t('finance.period', { days: String(data.periodDays) })} · {data.currency}</p>

            {/* Répartition par statut & méthode */}
            <div className="lg:grid lg:grid-cols-2 lg:gap-5 space-y-5 lg:space-y-0">
              <Breakdown
                title={t('finance.by_status')}
                rows={data.payments.byStatus.map((b) => ({ label: b.status ?? '—', count: b.count, volume: b.volume }))}
                t={t}
              />
              <Breakdown
                title={t('finance.by_method')}
                rows={data.payments.byMethod.map((b) => ({ label: b.method ?? '—', count: b.count, volume: b.volume }))}
                t={t}
              />
            </div>

            {/* File de réconciliation */}
            <section>
              <h2 className="font-display font-extrabold text-[0.875rem] text-stone-700 mb-2">
                {t('finance.reconciliation')} {data.reconciliation.backlog ? `(${data.reconciliation.backlog})` : ''}
              </h2>
              {data.reconciliation.oldest.length === 0 ? (
                <p className="text-[0.8125rem] text-sante-700 font-bold"><span aria-hidden="true">✓ </span>{t('finance.recon_clear')}</p>
              ) : (
                <CardPagne stitch="sos" className="p-0 overflow-hidden">
                  <ul className="divide-y divide-stone-100">
                    {data.reconciliation.oldest.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-[0.75rem]">
                        <span className="font-mono text-stone-500 truncate">{r.fedapayId ?? r.id}</span>
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          <span className="px-2 py-0.5 card-pagne bg-ocre-50 text-ocre-600 text-[0.59375rem] font-extrabold">{r.method}</span>
                          <span className="font-bold text-stone-900">{xof(r.amount)}</span>
                          <span className="text-stone-400">{dt(r.createdAt)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardPagne>
              )}
            </section>

            {/* Wallets diaspora */}
            <section>
              <h2 className="font-display font-extrabold text-[0.875rem] text-stone-700 mb-2">{t('finance.wallets')}</h2>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <Mini label={t('finance.wallet_total')} value={xof(data.wallets.totalBalance)} />
                <Mini label={t('finance.wallet_count')} value={data.wallets.count} />
                <Mini label={t('finance.wallet_active')} value={data.wallets.active} />
              </div>
              {data.wallets.recentMovements.length > 0 && (
                <CardPagne className="p-0 overflow-hidden">
                  <ul className="divide-y divide-stone-100">
                    {data.wallets.recentMovements.map((mv) => (
                      <li key={mv.id} className="flex items-center justify-between gap-2 px-4 py-2 text-[0.75rem]">
                        <span className="px-2 py-0.5 card-pagne bg-indigo-50 text-indigo-600 text-[0.59375rem] font-extrabold">{mv.type}</span>
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          <span className="font-bold text-stone-900">{xof(mv.amount)}</span>
                          <span className="text-stone-400">{dt(mv.createdAt)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardPagne>
              )}
            </section>

            {/* Journal des webhooks FedaPay (dérivé de l'audit) */}
            <section>
              <h2 className="font-display font-extrabold text-[0.875rem] text-stone-700 mb-2">{t('finance.webhooks')}</h2>
              {wh.loading && !wh.data && <SkeletonCards count={2} label={t('common.loading')} />}
              {wh.data && wh.data.data.length === 0 && <p className="text-[0.8125rem] text-stone-400">{t('common.empty')}</p>}
              {wh.data && wh.data.data.length > 0 && (
                <CardPagne className="p-0 overflow-hidden">
                  <ul className="divide-y divide-stone-100">
                    {wh.data.data.map((w) => (
                      <li key={w.id} className="flex items-center justify-between gap-2 px-4 py-2 text-[0.71875rem]">
                        <span className="flex items-center gap-2 min-w-0">
                          <span
                            className={cn(
                              'px-2 py-0.5 card-pagne text-[0.59375rem] font-extrabold',
                              w.outcome === 'rejected' ? 'bg-sos-50 text-sos-600' : 'bg-sante-50 text-sante-700',
                            )}
                          >
                            {w.outcome === 'rejected' ? t('finance.wh_rejected') : t('finance.wh_accepted')}
                          </span>
                          {w.source && <span className="text-stone-400">{w.source}</span>}
                          {w.fedapayId && <span className="font-mono text-stone-500 truncate">{w.fedapayId}</span>}
                        </span>
                        <span className="text-stone-400 whitespace-nowrap">{dt(w.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                </CardPagne>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}

function Mini({ label, value }: { label: string; value: string | number }) {
  return (
    <CardPagne className="p-3">
      <p className="text-[0.5625rem] text-stone-400 font-extrabold uppercase tracking-wide mb-1">{label}</p>
      <p className="font-display font-extrabold text-[1.125rem] text-stone-900 leading-none">{value}</p>
    </CardPagne>
  );
}

function Breakdown({
  title,
  rows,
  t,
}: {
  title: string;
  rows: { label: string; count: number; volume: string | number }[];
  t: (k: string) => string;
}) {
  return (
    <section>
      <h2 className="font-display font-extrabold text-[0.875rem] text-stone-700 mb-2">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-[0.8125rem] text-stone-400">{t('common.empty')}</p>
      ) : (
        <CardPagne className="p-0 overflow-hidden">
          <ul className="divide-y divide-stone-100">
            {rows.map((r) => (
              <li key={r.label} className="flex items-center justify-between gap-2 px-4 py-2.5 text-[0.8125rem]">
                <span className="font-bold text-stone-700">{r.label}</span>
                <span className="flex items-center gap-3 whitespace-nowrap">
                  <span className="text-stone-400">{r.count}</span>
                  <span className="font-display font-extrabold text-stone-900">{xof(r.volume)}</span>
                </span>
              </li>
            ))}
          </ul>
        </CardPagne>
      )}
    </section>
  );
}
