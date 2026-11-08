'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { ConsultationRoom, ConsultationRoomFallback } from '@/components/consult/ConsultationRoom';
import { ConfirmDialog } from '@/components/ui';
import { useLocale } from '@/i18n/LocaleProvider';
import { ApiRequestError, postNow } from '@/lib/api/client';

// D-06 (PRO) — Téléconsultation côté MÉDECIN. Même salle que le patient ; en plus,
// la clôture (`POST /consultations/:id/end`, médecin uniquement) qui passe la
// consultation en COMPLETED et le rendez-vous avec.
function ProTeleconsult() {
  const { t } = useLocale();
  const router = useRouter();
  const consultationId = useSearchParams().get('id');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busy, setBusy] = useState(false);
  // Compte rendu facultatif : enregistré côté serveur comme entrée DMP chiffrée
  // (auteur = médecin authentifié), seulement si le patient a partagé son dossier.
  const [report, setReport] = useState('');
  const [endError, setEndError] = useState<string | null>(null);

  async function end() {
    if (!consultationId || busy) return;
    setBusy(true);
    setEndError(null);
    try {
      const text = report.trim();
      // Effet immédiat, jamais mis en file (clôture + écriture clinique).
      await postNow(`/consultations/${consultationId}/end`, text ? { report: text } : {});
      router.push('/pro/agenda');
    } catch (e) {
      // Échec : on reste dans la salle (consultation toujours ACTIVE en base) et le
      // texte saisi est conservé. 403 = pas de partage DMP : clore sans compte rendu.
      setBusy(false);
      setEndError(e instanceof ApiRequestError && e.status === 403 ? t('teleconsult.report_denied') : t('auth.error'));
    }
  }

  return (
    <>
      <ConsultationRoom
        consultationId={consultationId}
        homePath="/pro/agenda"
        chatPath="/pro/messages"
        onEnd={() => setConfirmEnd(true)}
        endLabel={t('teleconsult.end')}
        endBusy={busy}
      />
      <ConfirmDialog
        open={confirmEnd}
        title={t('teleconsult.end')}
        message={t('teleconsult.end_confirm')}
        confirmLabel={t('teleconsult.end')}
        busy={busy}
        onConfirm={() => void end()}
        onCancel={() => setConfirmEnd(false)}
      >
        <label className="block">
          <span className="block font-display font-bold text-[0.75rem] text-stone-600 mb-1">{t('teleconsult.report_label')}</span>
          <textarea
            value={report}
            onChange={(e) => setReport(e.target.value)}
            maxLength={5000}
            rows={4}
            className="w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-base pagne-focus focus:outline-none focus:border-indigo-600"
          />
        </label>
        {endError && <p className="mt-2 text-[0.75rem] text-sos-600 font-bold" role="alert">{endError}</p>}
      </ConfirmDialog>
    </>
  );
}

export default function ProTeleconsultPage() {
  return (
    <Suspense fallback={<ConsultationRoomFallback />}>
      <ProTeleconsult />
    </Suspense>
  );
}
