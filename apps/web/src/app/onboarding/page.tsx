'use client';

import { useRouter } from 'next/navigation';

import { LANGUAGE_LIST, type Lang } from '@digisante/shared';

import { Button, KenteBar, StatusBar } from '@/components/ui';
import { useLocale } from '@/i18n/LocaleProvider';
import { cn } from '@/lib/cn';

// D-01 — Onboarding : choix de la langue.
export default function OnboardingPage() {
  const { lang, setLang, t } = useLocale();
  const router = useRouter();

  return (
    <div className="min-h-screen wax-light">
      <div className="mx-auto max-w-[420px] min-h-screen bg-creme flex flex-col shadow-xl">
        <header className="bg-sante-900 bogolan-dark relative pb-14 text-white">
          <StatusBar dark />
          <div className="px-6 pt-4">
            <h1 className="font-display font-extrabold text-2xl">{t('onboarding.welcome')}</h1>
            <p className="text-[13px] text-white/80 mt-1"><span aria-hidden="true">🇧🇯 </span>{t('onboarding.choose_language')}</p>
          </div>
          <KenteBar className="absolute bottom-0 left-0 right-0" />
        </header>

        <main className="px-6 -mt-8 relative z-20 flex-1 space-y-3 pb-6">
          {LANGUAGE_LIST.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => setLang(l.code as Lang)}
              className={cn(
                'w-full bg-white card-pagne border p-4 flex items-center justify-between text-left',
                l.code === lang ? 'border-sante-600 ring-2 ring-sante-600/30' : 'border-stone-200',
              )}
            >
              <span>
                <span className="font-display font-extrabold text-[15px] mr-2">{l.code}</span>
                <span className="text-stone-600">{l.nativeName}</span>
              </span>
              {l.hasAudio && <span role="img" aria-label="Audio Fɔ̀ngbè" title="Audio Fɔ̀ngbè">🔊</span>}
            </button>
          ))}

          <Button variant="sante" full className="mt-4" onClick={() => router.push('/login')}>
            {t('common.continue')}
          </Button>
        </main>
      </div>
    </div>
  );
}
