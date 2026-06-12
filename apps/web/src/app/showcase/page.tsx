'use client';

import { Badge, BottomNav, Button, CardPagne, KenteBar, LangSwitcher, Nkyinkyim, StatusBar } from '@/components/ui';
import { useLocale } from '@/i18n/LocaleProvider';

// Vitrine du design system « Wax & Terre » (thème PATIENT) + i18n.
// Aucune chaîne en dur : tout passe par t(). Remplacée par D-01→D-26 ensuite.
export default function Home() {
  const { t } = useLocale();
  return (
    <div className="min-h-screen wax-light">
      <div className="mx-auto max-w-[420px] min-h-screen bg-creme flex flex-col shadow-xl">
        {/* Header sombre patient : bogolan + kenté en bas */}
        <header className="bg-sante-900 bogolan-dark relative pb-16 text-white">
          <StatusBar dark right={<LangSwitcher dark />} />
          <div className="px-6 pt-2">
            <p className="text-[12px] text-white/70 font-body">{t('common.greeting')} 👋</p>
            <h1 className="font-display font-extrabold text-2xl">{t('home.hello', { name: 'Koffi' })}</h1>
            <p className="text-[12px] text-white/70 mt-1">🗣 Fon · Français</p>
          </div>
          <KenteBar className="absolute bottom-0 left-0 right-0" />
        </header>

        {/* Carte flottante */}
        <main className="px-6 -mt-10 relative z-20 flex-1 space-y-5 pb-6">
          <CardPagne stitch className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-extrabold text-[15px] text-sante-800">{t('home.next_appointment')}</h2>
              <Badge variant="normal">{t('home.confirmed')}</Badge>
            </div>
            <Nkyinkyim className="my-3" />
            <p className="text-sm text-stone-600">
              Dr Awa Koffi — <span className="font-bold">{t('home.doctor_specialty')}</span>
            </p>
            <p className="text-[13px] text-stone-500">{t('home.appointment_when')}</p>
            <div className="mt-4 flex gap-2">
              <Button variant="sante" full>
                {t('home.join')}
              </Button>
              <Button variant="outline">{t('home.details')}</Button>
            </div>
          </CardPagne>

          <section>
            <div className="flex items-center gap-2 mb-2">
              <Nkyinkyim className="flex-1 opacity-50" />
              <h3 className="font-display font-extrabold text-[12px] text-stone-500 uppercase tracking-wide">{t('showcase.components')}</h3>
              <Nkyinkyim className="flex-1 opacity-50" />
            </div>

            <CardPagne className="p-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="normal">{t('badge.normal')}</Badge>
                <Badge variant="eleve">{t('badge.eleve')}</Badge>
                <Badge variant="priorite">{t('badge.priorite')}</Badge>
                <Badge variant="pro">{t('badge.pro')}</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="terre">Terre</Button>
                <Button variant="indigo">Indigo</Button>
                <Button variant="ocre">Or</Button>
                <Button variant="sos">SOS</Button>
              </div>
            </CardPagne>
          </section>
        </main>

        <BottomNav />
      </div>
    </div>
  );
}
