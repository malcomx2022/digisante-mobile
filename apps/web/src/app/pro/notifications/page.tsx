'use client';

import { NotificationList } from '@/components/notifications/NotificationList';
import { ProHeader } from '@/components/pro/ProHeader';
import { useLocale } from '@/i18n/LocaleProvider';

// Centre de notifications du médecin : signalements d'ASC, orientations reçues,
// résultats critiques… Sans cet écran, une notification in-app adressée à un
// médecin n'était visible nulle part (le signalement ASC était perdu).
export default function ProNotificationsPage() {
  const { t } = useLocale();
  return (
    <>
      <ProHeader title={t('notifications.title')} wide />
      <main className="px-6 -mt-10 relative z-20 space-y-3 pb-6 lg:max-w-5xl lg:mx-auto">
        <NotificationList accent="indigo" />
      </main>
    </>
  );
}
