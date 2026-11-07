'use client';

import { KycDossier } from '@/components/kyc/KycDossier';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { useLocale } from '@/i18n/LocaleProvider';

// Pièces exigées à l'approbation d'une officine (contrôle serveur) : identité du
// responsable + autorisation d'exercice ; la photo reste facultative.
const PHARMACY_DOC_TYPES = ['NATIONAL_ID', 'PRACTICE_LICENSE', 'PROFESSIONAL_PHOTO'] as const;

// Habilitation de la pharmacie : sans badge vérifié, scan et délivrance sont
// refusés et l'officine n'apparaît pas dans « médicament près de moi ».
export default function PharmacieKycPage() {
  const { t } = useLocale();
  return (
    <>
      <SpaceHeader title={t('pharmacie.kyc')} subtitle={t('pharmacie.kyc_required')} headerClass="bg-nuit" profileHref="/pharmacie/profile" />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto">
        <KycDossier accent="ocre" docTypes={PHARMACY_DOC_TYPES} />
      </main>
    </>
  );
}
