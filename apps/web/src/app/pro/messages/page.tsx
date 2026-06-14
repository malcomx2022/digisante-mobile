'use client';

import { Suspense } from 'react';

import { ChatRoom } from '@/components/chat/ChatRoom';
import { ProHeader } from '@/components/pro/ProHeader';
import { Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';

// Messagerie côté médecin : fils avec ses patients. Ouverture directe via
// ?patient=<id> (depuis la vue 360°) ou ?thread=<id>.
export default function ProMessagesPage() {
  const { t } = useLocale();
  return (
    <>
      <ProHeader title={t('chat.title')} />
      <main className="px-4 -mt-10 relative z-20 flex-1 flex flex-col pb-6">
        <Suspense fallback={<Loading label={t('common.loading')} />}>
          <ChatRoom theme="pro" counterpartParam="patient" />
        </Suspense>
      </main>
    </>
  );
}
