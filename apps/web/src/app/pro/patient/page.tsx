'use client';

import { ProHeader } from '@/components/pro/ProHeader';
import { Badge, CardPagne, Nkyinkyim } from '@/components/ui';
import { useLocale } from '@/i18n/LocaleProvider';

// D-16 — Vue 360° patient. L'accès au DMP passe par le consentement (P2.3) ;
// cet écran de synthèse est présentationnel en attendant le flux de partage complet.
export default function Patient360Page() {
  const { t } = useLocale();
  return (
    <>
      <ProHeader title={t('pro.patient360')} subtitle="Koffi Dossou · 🗣 Fon" />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6">
        <CardPagne stitch="indigo" className="p-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="indigo">O+</Badge>
            <Badge variant="eleve">⚠ Pénicilline</Badge>
            <Badge variant="indigo">HTA</Badge>
          </div>
          <Nkyinkyim className="my-3" />
          <p className="text-[13px] text-stone-600">Tension 15,1/9,2 <span className="text-ocre-600">(offline)</span> — remontée via la file de synchronisation.</p>
        </CardPagne>

        <CardPagne className="p-4">
          <p className="font-display font-extrabold text-[13px] text-stone-700">Accès au dossier</p>
          <p className="text-[12px] text-stone-500 mt-1">
            Accès soumis à un <span className="font-bold">partage consenti</span> non expiré (DMP_ACCESS journalisé).
            L’administration ne peut jamais lire le contenu médical — conformité APDP (Loi N°2017-20).
          </p>
        </CardPagne>
      </main>
    </>
  );
}
