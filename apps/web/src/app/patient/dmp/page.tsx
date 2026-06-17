'use client';

import Link from 'next/link';
import { useState } from 'react';

import { DmpShareDialog } from '@/components/patient/DmpShareDialog';
import { PatientHeader } from '@/components/patient/PatientHeader';
import { CardPagne } from '@/components/ui';
import { Empty, ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get } from '@/lib/api/client';
import { dmpApi, type DmpConsent, type DmpRecord } from '@/lib/api/dmp';
import { usersApi, type MeFull } from '@/lib/api/users';
import { useApi } from '@/lib/api/useApi';

// Couleur de la barre latérale selon le type d'entrée (cf. D-04).
const BAR: Record<string, string> = {
  LAB_RESULT: 'bg-indigo-500',
  VACCINATION: 'bg-ocre-400',
  DIAGNOSIS: 'bg-sante-500',
  VITAL_SIGNS: 'bg-sante-500',
};

// D-04 — Dossier médical (DMP).
export default function DmpPage() {
  const { t } = useLocale();
  const [sharing, setSharing] = useState<DmpRecord | null>(null);
  const [revokeTick, setRevokeTick] = useState(0);
  // §4 : un échec d'action de sécurité (révocation/ré-octroi/export) DOIT être visible.
  const [actionError, setActionError] = useState(false);
  const { data, loading, error } = useApi<DmpRecord[]>(() => dmpApi.myRecords(), []);
  const { data: me } = useApi<MeFull>(() => usersApi.me(), []);
  const { data: consents } = useApi<DmpConsent[]>(() => dmpApi.listConsents(), [revokeTick]);

  async function revoke(granteeId: string) {
    setActionError(false);
    try {
      await dmpApi.revokeConsent(granteeId);
      setRevokeTick((n) => n + 1);
    } catch {
      setActionError(true);
    }
  }

  async function regrant(granteeId: string) {
    setActionError(false);
    try {
      await dmpApi.regrantConsent(granteeId);
      setRevokeTick((n) => n + 1);
    } catch {
      setActionError(true);
    }
  }

  async function exportFhir() {
    setActionError(false);
    try {
      const bundle = await get<unknown>('/dmp/export');
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/fhir+json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dmp-export.fhir.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setActionError(true);
    }
  }

  return (
    <>
      <PatientHeader title={t('dmp.title')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-3xl lg:mx-auto lg:w-full">
        <Link
          href="/patient/vitals"
          className="flex items-center gap-2 bg-white card-pagne border border-stone-200 px-4 py-3 font-display font-bold text-[14px] text-sante-700"
        >
          <span aria-hidden>📈</span> {t('vitals.title')}
        </Link>

        <CardPagne className="p-4">
          <button
            type="button"
            onClick={exportFhir}
            className="w-full text-center text-[13px] font-display font-bold text-sante-700 underline decoration-dotted underline-offset-4"
          >
            {t('dmp.export')}
          </button>
        </CardPagne>

        {actionError && <ErrorState label={t('auth.error')} />}

        {(consents?.length ?? 0) > 0 && (
          <CardPagne className="p-4">
            <p className="font-display font-extrabold text-[13px] text-stone-700">{t('dmp.access_section_title')}</p>
            <div className="mt-2 space-y-2">
              {(consents ?? []).map((c) => (
                <div key={c.granteeId} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-display font-bold text-[13px] text-stone-800 truncate">
                      {c.name}
                      {c.speciality ? ` · ${c.speciality}` : ''}
                    </p>
                    <p className="text-[11px] text-stone-400">
                      {c.active
                        ? t('dmp.share_expires', { date: new Date(c.expiresAt).toLocaleDateString('fr-FR', { dateStyle: 'medium' }) })
                        : t('dmp.revoked_label')}
                    </p>
                  </div>
                  {c.active ? (
                    <button
                      type="button"
                      onClick={() => revoke(c.granteeId)}
                      className="shrink-0 card-pagne bg-sos-50 text-sos-700 font-display font-extrabold text-[11px] px-3 py-1.5"
                    >
                      {t('dmp.revoke')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => regrant(c.granteeId)}
                      className="shrink-0 card-pagne bg-sante-50 text-sante-700 font-display font-extrabold text-[11px] px-3 py-1.5"
                    >
                      {t('dmp.regrant')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </CardPagne>
        )}

        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && (data?.length ?? 0) === 0 && <Empty label={t('common.empty')} />}

        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {(data ?? []).map((r) => (
            <CardPagne key={r.id} className="p-4 flex gap-3">
              <span className={`w-1.5 rounded-full ${BAR[r.type] ?? 'bg-stone-300'}`} />
              <div className="flex-1">
                <p className="font-display font-bold text-[14px] text-stone-800">{r.title}</p>
                <p className="text-[12px] text-stone-400">
                  {r.type} · {new Date(r.createdAt).toLocaleDateString('fr-FR', { dateStyle: 'medium' })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSharing(r)}
                className="self-center shrink-0 card-pagne bg-sante-50 text-sante-700 font-display font-extrabold text-[11px] px-3 py-1.5"
              >
                {t('dmp.share')}
              </button>
            </CardPagne>
          ))}
        </div>
      </main>

      {sharing && (
        <DmpShareDialog
          recordId={sharing.id}
          recordTitle={sharing.title}
          patientId={me?.patient?.id}
          onClose={() => setSharing(null)}
        />
      )}
    </>
  );
}
