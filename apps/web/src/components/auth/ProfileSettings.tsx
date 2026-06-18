'use client';

import { useEffect, useMemo, useState } from 'react';

import { LANGUAGE_LIST, type Lang } from '@digisante/shared';

import { Button, CardPagne, Nkyinkyim } from '@/components/ui';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { useAuth } from '@/auth/AuthProvider';
import { useLocale } from '@/i18n/LocaleProvider';
import { usersApi, type MeFull } from '@/lib/api/users';
import { cn } from '@/lib/cn';

type LogoutVariant = 'outline' | 'terre' | 'indigo' | 'sante' | 'ocre' | 'sos';

/**
 * Bloc profil & paramètres réutilisable par tous les espaces.
 * - affiche les infos /users/me
 * - édite nom + langues parlées (🗣) + langue d'UI via PATCH /users/me
 * - bouton de déconnexion (thème via `accent`)
 *
 * `accent` colore l'état actif des pills selon l'espace.
 */
export function ProfileSettings({
  accent = 'sante',
  logoutVariant = 'outline',
  children,
  columns = false,
}: {
  accent?: 'sante' | 'indigo' | 'ocre';
  logoutVariant?: LogoutVariant;
  children?: React.ReactNode;
  /** Densité desktop : dispose les cartes de réglages en 2 colonnes (≥lg). */
  columns?: boolean;
}) {
  const { t, lang, setLang } = useLocale();
  const { user } = useAuth();

  const [me, setMe] = useState<MeFull | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [spoken, setSpoken] = useState<Lang[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await usersApi.me();
        if (!active) return;
        setMe(data);
        setFirstName(data.profile?.firstName ?? '');
        setLastName(data.profile?.lastName ?? '');
        setSpoken(data.profile?.spokenLangs ?? []);
      } catch {
        /* repli sur l'utilisateur de session si /users/me échoue */
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Classe d'état actif des pills selon le thème de l'espace (texte inclus).
  const activePill = useMemo(
    () => ({ sante: 'bg-sante-600 text-white', indigo: 'bg-indigo-600 text-white', ocre: 'bg-ocre-400 text-stone-900' }[accent]),
    [accent],
  );
  const linkColor = { sante: 'text-sante-700', indigo: 'text-indigo-700', ocre: 'text-ocre-600' }[accent];

  function toggleSpoken(code: Lang) {
    setSpoken((s) => (s.includes(code) ? s.filter((c) => c !== code) : [...s, code]));
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const updated = await usersApi.update({
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        spokenLangs: spoken,
        lang,
      });
      setMe(updated);
      setSaved(true);
    } catch {
      setError(t('profile.save_error'));
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'w-full bg-white card-pagne border border-stone-300 px-4 py-3 font-body text-[0.9375rem] focus:outline-none focus:border-stone-500';
  const displayPhone = me?.phone ?? user?.phone ?? '';

  return (
    <div className="space-y-4">
      {children}

      <div className={cn('space-y-4', columns && 'lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-4 lg:items-start')}>
      {/* Identité */}
      <CardPagne className="p-4 space-y-3">
        <p className="font-display font-extrabold text-[0.8125rem] text-stone-700">{t('profile.identity')}</p>
        <p className="text-[0.75rem] text-stone-400">{displayPhone}</p>
        <Nkyinkyim className="opacity-30" />
        <div className="flex gap-2">
          <input className={inputCls} placeholder={t('auth.firstname')} aria-label={t('auth.firstname')} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <input className={inputCls} placeholder={t('auth.lastname')} aria-label={t('auth.lastname')} value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
      </CardPagne>

      {/* Langues parlées 🗣 */}
      <CardPagne className="p-4">
        <p className="font-display font-extrabold text-[0.8125rem] text-stone-700 mb-2"><span aria-hidden="true">🗣 </span>{t('common.spoken')}</p>
        <div className="flex flex-wrap gap-2">
          {LANGUAGE_LIST.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => toggleSpoken(l.code as Lang)}
              className={cn('card-pagne px-3 py-1.5 text-[0.8125rem] font-display font-bold', spoken.includes(l.code as Lang) ? activePill : 'bg-creme-deep text-stone-600')}
            >
              {l.code} {l.hasAudio ? '🔊' : ''}
            </button>
          ))}
        </div>
      </CardPagne>

      {/* Langue d'interface */}
      <CardPagne className="p-4">
        <p className="font-display font-extrabold text-[0.8125rem] text-stone-700 mb-2">{t('common.language')}</p>
        <div className="flex flex-wrap gap-2">
          {LANGUAGE_LIST.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => setLang(l.code as Lang)}
              className={cn('card-pagne px-3 py-1.5 text-[0.8125rem] font-display font-bold', l.code === lang ? activePill : 'bg-creme-deep text-stone-600')}
            >
              {l.code} {l.hasAudio ? '🔊' : ''}
            </button>
          ))}
        </div>
      </CardPagne>
      </div>

      {saved && <p className={cn('text-[0.8125rem] font-bold', linkColor)}>✓ {t('profile.saved')}</p>}
      {error && <p className="text-[0.8125rem] text-sos-600 font-bold">{error}</p>}

      <Button variant={accent === 'ocre' ? 'ocre' : accent === 'indigo' ? 'indigo' : 'sante'} full onClick={save} disabled={saving || loading}>
        {t('profile.save')}
      </Button>

      <LogoutButton variant={logoutVariant} />
    </div>
  );
}
