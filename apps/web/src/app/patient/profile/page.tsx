'use client';

import { useAuth } from '@/auth/AuthProvider';
import { PatientHeader } from '@/components/patient/PatientHeader';
import { Button, CardPagne, Nkyinkyim } from '@/components/ui';
import { useLocale } from '@/i18n/LocaleProvider';
import { LANGUAGE_LIST, type Lang } from '@digisante/shared';
import { get } from '@/lib/api/client';
import { cn } from '@/lib/cn';

// D-12 — Profil & paramètres (langue, export FHIR, déconnexion).
export default function ProfilePage() {
  const { t, lang, setLang } = useLocale();
  const { user, logout } = useAuth();

  async function exportFhir() {
    try {
      const bundle = await get<unknown>('/dmp/export');
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/fhir+json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dmp-export.fhir.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <PatientHeader title={t('profile.title')} subtitle={user?.phone} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6">
        <CardPagne className="p-4">
          <p className="font-display font-extrabold text-[13px] text-stone-700 mb-2">{t('common.language')}</p>
          <div className="flex flex-wrap gap-2">
            {LANGUAGE_LIST.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => setLang(l.code as Lang)}
                className={cn('card-pagne px-3 py-1.5 text-[13px] font-display font-bold', l.code === lang ? 'bg-sante-600 text-white' : 'bg-creme-deep text-stone-600')}
              >
                {l.code} {l.hasAudio ? '🔊' : ''}
              </button>
            ))}
          </div>
        </CardPagne>

        <CardPagne className="p-4">
          <Nkyinkyim className="mb-3" />
          <button type="button" onClick={exportFhir} className="w-full text-left text-[14px] font-display font-bold text-sante-700">
            {t('profile.export')}
          </button>
          <p className="text-[11px] text-stone-400 mt-1">Portabilité — Loi N°2017-20 (APDP)</p>
        </CardPagne>

        <Button variant="outline" full onClick={logout}>
          {t('profile.logout')}
        </Button>
      </main>
    </>
  );
}
