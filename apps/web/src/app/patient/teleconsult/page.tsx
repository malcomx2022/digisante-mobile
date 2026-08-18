'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

import { ConsultationRoom, ConsultationRoomFallback } from '@/components/consult/ConsultationRoom';

// D-06 — Téléconsultation côté PATIENT (salle Daily.co). La salle elle-même est
// partagée avec le médecin (`components/consult/ConsultationRoom`) : même endpoint
// de join, même bascule chat automatique en réseau faible.
// L'id de consultation est fourni en query (?id=…), depuis /patient/appointments.
function PatientTeleconsult() {
  const consultationId = useSearchParams().get('id');
  return <ConsultationRoom consultationId={consultationId} homePath="/patient" chatPath="/patient/chat" />;
}

export default function TeleconsultPage() {
  return (
    <Suspense fallback={<ConsultationRoomFallback />}>
      <PatientTeleconsult />
    </Suspense>
  );
}
