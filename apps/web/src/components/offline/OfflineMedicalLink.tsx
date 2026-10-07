'use client';
import { useLocale } from '@/i18n/LocaleProvider';
import { useOnline } from '@/lib/offline/online';
export function OfflineMedicalLink() {
  const { t } = useLocale(); const online = useOnline();
  return online ? null : <a href="/patient/offline" className="block bg-ocre-50 card-pagne px-4 py-3 text-[0.8125rem] font-bold text-stone-800">{t('vault.open_snapshot')}</a>;
}
