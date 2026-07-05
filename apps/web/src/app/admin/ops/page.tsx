'use client';

import { CardPagne } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { ErrorState, SkeletonCards } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { opsApi, type OpsHealth } from '@/lib/api/ops';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/i18n/format';

function dt(s: string | null, fallback: string): string {
  return s ? formatDateTime(s, { dateStyle: 'short', timeStyle: 'short' }) : fallback;
}
function uptime(sec: number, t: (k: string) => string): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const [ud, uh, um] = [t('ops.unit_d'), t('ops.unit_h'), t('ops.unit_m')];
  return d > 0 ? `${d}${ud} ${h}${uh}` : h > 0 ? `${h}${uh} ${m}${um}` : `${m}${um}`;
}

// D-25f — Ops / monitoring : santé infra, files de notifications, jobs cron,
// événements sécurité/ops 24 h. LECTURE SEULE (§4 : aucun contenu médical).
export default function AdminOps() {
  const { t } = useLocale();
  const h = useApi<OpsHealth>(() => opsApi.health(), []);
  const data = h.data;

  return (
    <>
      <SpaceHeader title={t('admin.ops')} subtitle={t('ops.subtitle')} headerClass="bg-indigo-950" wide />
      <main className="px-6 -mt-10 relative z-20 pb-6 lg:max-w-5xl lg:mx-auto lg:w-full space-y-5">
        {h.error && <ErrorState label={t('auth.error')} />}
        {h.loading && !data && <SkeletonCards count={4} label={t('common.loading')} />}

        {data && (
          <>
            {/* Infra */}
            <section>
              <h2 className="font-display font-extrabold text-[0.875rem] text-stone-700 mb-2">{t('ops.infra')}</h2>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
                <StatusPill label="Redis" up={data.infra.redis === 'up'} t={t} />
                <StatusPill label={t('ops.database')} up={data.infra.db === 'up'} t={t} />
                <Mini label={t('ops.uptime')} value={uptime(data.infra.uptimeSeconds, t)} />
                <StatusPill label="FedaPay" up={data.infra.fedapayConfigured} t={t} okKey="ops.configured" koKey="ops.stub" />
              </div>
            </section>

            {/* Notifications (file de dispatch) */}
            <section>
              <h2 className="font-display font-extrabold text-[0.875rem] text-stone-700 mb-2">{t('ops.notifications')}</h2>
              <div className="grid grid-cols-3 gap-3">
                <Mini label={t('ops.pending')} value={data.notifications.pending} accent={data.notifications.pending > 0 ? 'text-ocre-500' : undefined} />
                <Mini label={t('ops.failed')} value={data.notifications.failed} accent={data.notifications.failed > 0 ? 'text-sos-600' : undefined} />
                <Mini label={t('ops.sent_24h')} value={data.notifications.sentLast24h} accent="text-sante-700" />
              </div>
            </section>

            {/* Jobs cron */}
            <section>
              <h2 className="font-display font-extrabold text-[0.875rem] text-stone-700 mb-2">{t('ops.jobs')}</h2>
              <CardPagne className="p-0 overflow-hidden">
                <ul className="divide-y divide-stone-100">
                  <JobRow label={t('ops.reconciliation')} value={`${data.jobs.reconciliationBacklog} ${t('ops.in_backlog')}`} warn={data.jobs.reconciliationBacklog > 0} />
                  <JobRow label={t('ops.med_reminders')} value={dt(data.jobs.medicationLastGeneratedAt, t('ops.never'))} />
                  <JobRow label={t('ops.appt_reminders')} value={dt(data.jobs.appointmentLastReminderAt, t('ops.never'))} />
                </ul>
              </CardPagne>
            </section>

            {/* Événements sécurité / ops (24 h) */}
            <section>
              <h2 className="font-display font-extrabold text-[0.875rem] text-stone-700 mb-2">{t('ops.events_24h')}</h2>
              <CardPagne className="p-0 overflow-hidden">
                <ul className="divide-y divide-stone-100">
                  {data.events24h.map((e) => (
                    <li key={e.action} className="flex items-center justify-between gap-2 px-4 py-2.5 text-[0.75rem]">
                      <span className="font-mono font-bold text-indigo-700">{e.action}</span>
                      <span className={cn('font-display font-extrabold', e.count > 0 ? 'text-stone-900' : 'text-stone-300')}>{e.count}</span>
                    </li>
                  ))}
                </ul>
              </CardPagne>
            </section>
          </>
        )}
      </main>
    </>
  );
}

function Mini({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <CardPagne className="p-3">
      <p className="text-[0.5625rem] text-stone-400 font-extrabold uppercase tracking-wide mb-1">{label}</p>
      <p className={cn('font-display font-extrabold text-[1.125rem] leading-none', accent ?? 'text-stone-900')}>{value}</p>
    </CardPagne>
  );
}

function StatusPill({ label, up, t, okKey = 'ops.up', koKey = 'ops.down' }: { label: string; up: boolean; t: (k: string) => string; okKey?: string; koKey?: string }) {
  return (
    <CardPagne className="p-3">
      <p className="text-[0.5625rem] text-stone-400 font-extrabold uppercase tracking-wide mb-1">{label}</p>
      <p className={cn('font-display font-extrabold text-[0.9375rem] leading-none', up ? 'text-sante-700' : 'text-sos-600')}>
        <span aria-hidden="true">{up ? '● ' : '○ '}</span>
        {t(up ? okKey : koKey)}
      </p>
    </CardPagne>
  );
}

function JobRow({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <li className="flex items-center justify-between gap-2 px-4 py-2.5 text-[0.8125rem]">
      <span className="font-bold text-stone-700">{label}</span>
      <span className={cn('whitespace-nowrap', warn ? 'text-ocre-600 font-bold' : 'text-stone-500')}>{value}</span>
    </li>
  );
}
