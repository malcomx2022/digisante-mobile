'use client';

import { Suspense } from 'react';

import { ChatRoom } from '@/components/chat/ChatRoom';
import { PatientHeader } from '@/components/patient/PatientHeader';
import { Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';

// D-10 — Messagerie patient ↔ médecin (faible connexion : file offline + chiffrement
// au repos côté serveur). Ouverture directe d'un fil via ?doctor=<id> ou ?thread=<id>.
export default function ChatPage() {
  const { t } = useLocale();
  return (
    <>
      <PatientHeader title={t('chat.title')} />
      <main className="px-4 -mt-8 relative z-20 flex-1 flex flex-col pb-4">
        <Suspense fallback={<Loading label={t('common.loading')} />}>
          <ChatRoom theme="patient" counterpartParam="doctor" />
        </Suspense>
      </main>
    </>
  );
}
