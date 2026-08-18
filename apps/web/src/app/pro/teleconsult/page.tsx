'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { ConsultationRoom, ConsultationRoomFallback } from '@/components/consult/ConsultationRoom';
import { ConfirmDialog } from '@/components/ui';
import { useLocale } from '@/i18n/LocaleProvider';
import { post } from '@/lib/api/client';

// D-06 (PRO) — Téléconsultation côté MÉDECIN. Même salle que le patient ; en plus,
// la clôture (`POST /consultations/:id/end`, médecin uniquement) qui passe la
// consultation en COMPLETED et le rendez-vous avec.
function ProTeleconsult() {
  const { t } = useLocale();
  const router = useRouter();
  const consultationId = useSearchParams().get('id');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busy, setBusy] = useState(false);

  async function end() {
    if (!consultationId || busy) return;
    setBusy(true);
    try {
      await post(`/consultations/${consultationId}/end`, {});
      router.push('/pro/agenda');
    } catch {
      // Échec de clôture : on reste dans la salle plutôt que de faire croire à une
      // consultation terminée côté médecin alors qu'elle reste ACTIVE en base.
      setBusy(false);
      setConfirmEnd(false);
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
      />
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
