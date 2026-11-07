'use client';

import { KycDossier } from '@/components/kyc/KycDossier';
import { ProHeader } from '@/components/pro/ProHeader';
import { useLocale } from '@/i18n/LocaleProvider';

// D-19 — KYC professionnel du médecin (progression tissée + upload réel des pièces).
export default function ProKycPage() {
  const { t } = useLocale();
  return (
    <>
      <ProHeader title={t('pro.kyc')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto">
        <KycDossier accent="indigo" />
      </main>
    </>
  );
}
