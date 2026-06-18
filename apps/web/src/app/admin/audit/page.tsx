'use client';

import { CardPagne } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';

interface AuditEntry {
  id: string;
  action: string;
  actorId: string | null;
  ip: string | null;
  hash: string;
  createdAt: string;
}
interface Paginated {
  data: AuditEntry[];
  total: number;
}

// D-25 (part 2) — Journal d'audit (registre append-only, hash SHA-256 chaîné).
export default function AdminAudit() {
  const { t } = useLocale();
  const { data, loading, error } = useApi<Paginated>(() => get('/admin/audit?pageSize=40'), []);

  return (
    <>
      <SpaceHeader title={t('admin.audit')} subtitle="Append-only · Loi N°2017-20" headerClass="bg-indigo-950" />
      <main className="px-6 -mt-10 relative z-20 space-y-2 pb-6 lg:max-w-2xl lg:mx-auto">
        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
        {(data?.data ?? []).map((e) => (
          <CardPagne key={e.id} className="p-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[12px] font-bold text-indigo-700 bg-indigo-50 card-pagne px-2 py-0.5">{e.action}</span>
              <span className="text-[11px] text-stone-400">{new Date(e.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })}</span>
            </div>
            <p className="text-[11px] text-stone-400 mt-1 font-mono truncate">
              {e.ip ?? '—'} · #{e.hash.slice(0, 12)}
            </p>
          </CardPagne>
        ))}
        </div>
        {!loading && (data?.data?.length ?? 0) === 0 && <p className="text-[13px] text-stone-400 text-center">{t('common.empty')}</p>}
      </main>
    </>
  );
}
