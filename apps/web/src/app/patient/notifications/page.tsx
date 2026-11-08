'use client';

import { NotificationList } from '@/components/notifications/NotificationList';
import { PatientHeader } from '@/components/patient/PatientHeader';
import { useLocale } from '@/i18n/LocaleProvider';

// Centre de notifications du patient (rappels, RDV, résultats, paiements…).
export default function NotificationsPage() {
  const { t } = useLocale();
  return (
    <>
      <PatientHeader title={t('notifications.title')} wide />
      <main className="px-6 -mt-10 relative z-20 space-y-3 pb-6">
        <NotificationList />
      </main>
    </>
  );
}
