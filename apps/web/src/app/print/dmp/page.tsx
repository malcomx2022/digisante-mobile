'use client';

import Link from 'next/link';

import { Protected } from '@/components/auth/Protected';
import { Empty, ErrorState, SkeletonCards } from '@/components/ui/States';
import { formatDate } from '@/i18n/format';
import { useLocale } from '@/i18n/LocaleProvider';
import { dmpApi, type DmpRecord } from '@/lib/api/dmp';
import { useApi } from '@/lib/api/useApi';
import { usersApi, type MeFull } from '@/lib/api/users';

import { printableFields } from '@/lib/dmp-print';

// Export PDF du DMP (§4 Portabilité, décision du porteur du 19/11/2026) : page
// imprimable, le patient choisit « Enregistrer en PDF » dans son navigateur.
// Aucune dépendance ni génération côté serveur : le contenu ne quitte pas l'appareil
// au-delà de la lecture déjà faite par la page du dossier. Hors de la coquille
// AppShell pour que la navigation ne soit pas imprimée.
export default function DmpPrintPage() {
  return (
    <Protected role="PATIENT">
      <DmpPrint />
    </Protected>
  );
}

function DmpPrint() {
  const { t } = useLocale();
  const { data, loading, error } = useApi<DmpRecord[]>(() => dmpApi.myRecords(), []);
  const { data: me } = useApi<MeFull>(() => usersApi.me(), []);
  const name = me?.profile ? `${me.profile.firstName} ${me.profile.lastName}`.trim() : '';

  return (
    <main className="min-h-dvh-screen bg-white text-stone-900 px-6 py-6 max-w-2xl mx-auto print:p-0 print:max-w-none">
      <div className="print:hidden flex flex-wrap items-center gap-3 mb-6">
        <Link
          href="/patient/dmp"
          className="text-[0.8125rem] font-display font-bold text-sante-700 underline decoration-dotted underline-offset-4"
        >
          {t('dmp.print_back')}
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={loading || !!error}
          className="ml-auto card-pagne pagne-focus bg-sante-600 text-white font-display font-extrabold text-[0.8125rem] px-4 py-2 disabled:opacity-50"
        >
          {t('dmp.print_action')}
        </button>
        <p className="w-full text-[0.75rem] text-stone-500">{t('dmp.print_hint')}</p>
      </div>

      <header className="border-b border-stone-300 pb-3 mb-4">
        <h1 className="font-display font-extrabold text-[1.25rem]">{t('dmp.print_title')}</h1>
        {name && <p className="text-[0.875rem]">{t('dmp.print_patient', { name })}</p>}
        <p className="text-[0.75rem] text-stone-500">
          {t('dmp.print_generated', { date: formatDate(new Date().toISOString(), { dateStyle: 'long' }) })}
        </p>
      </header>

      {loading && <SkeletonCards label={t('common.loading')} />}
      {error && <ErrorState label={t('auth.error')} />}
      {!loading && !error && (data?.length ?? 0) === 0 && <Empty label={t('common.empty')} />}

      <ol className="space-y-4">
        {(data ?? []).map((r) => (
          <li key={r.id} className="break-inside-avoid border-b border-stone-200 pb-3">
            <p className="font-display font-bold text-[0.9375rem]">{r.title}</p>
            <p className="text-[0.75rem] text-stone-500">
              {t(`record.${r.type}`)} · {formatDate(r.createdAt, { dateStyle: 'medium' })}
              {r.authorRole ? ` · ${t('dmp.print_author', { role: t(`role.${r.authorRole}`) })}` : ''}
            </p>
            {printableFields(r.data).length > 0 && (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.8125rem]">
                {printableFields(r.data).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-stone-500">{k}</dt>
                    <dd className="whitespace-pre-wrap break-words">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ol>

      <footer className="mt-6 pt-3 border-t border-stone-300 text-[0.6875rem] text-stone-500">
        {t('dmp.print_disclaimer')}
      </footer>
    </main>
  );
}
