'use client';

import { useEffect, useState } from 'react';

import { Button, CardPagne } from '@/components/ui';
import { useLocale } from '@/i18n/LocaleProvider';
import { professionalsApi } from '@/lib/api/professionals';
import { usersApi } from '@/lib/api/users';

/**
 * Fiche professionnelle éditable du médecin (écart D4).
 *
 * `PATCH /professionals/me` existait sans aucun appelant : spécialité, durée de
 * créneau, biographie et surtout **tarif de consultation** étaient figés à la
 * valeur saisie au KYC, sans moyen de correction. Or `consultFee` est le montant
 * IMPOSÉ PAR LE SERVEUR au paiement d'une consultation (durcissement CSO) : un
 * médecin ne pouvait donc pas changer son tarif, jamais.
 *
 * Les langues parlées ne sont PAS ici : elles vivent sur `Profile.spokenLangs` et
 * sont déjà éditables via `ProfileSettings` (PATCH /users/me), juste au-dessus.
 */
export function DoctorProfileCard() {
  const { t } = useLocale();
  const [speciality, setSpeciality] = useState('');
  const [fee, setFee] = useState('');
  const [slot, setSlot] = useState('');
  const [bio, setBio] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    usersApi
      .me()
      .then((me) => {
        if (!active || !me.doctor) return;
        setSpeciality(me.doctor.speciality ?? '');
        setFee(me.doctor.consultFee != null ? String(Number(me.doctor.consultFee)) : '');
        setSlot(me.doctor.slotDuration != null ? String(me.doctor.slotDuration) : '');
        setBio(me.doctor.bio ?? '');
      })
      .catch(() => active && setError(t('auth.error')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      // Champs vides = non modifiés (le schéma serveur les traite en optionnels)
      // plutôt qu'écrasés par une chaîne vide ou un 0 involontaire.
      await professionalsApi.updateMe({
        ...(speciality.trim() ? { speciality: speciality.trim() } : {}),
        ...(fee.trim() ? { consultFee: Number(fee) } : {}),
        ...(slot.trim() ? { slotDuration: Number(slot) } : {}),
        bio: bio.trim(),
      });
      setSaved(true);
    } catch {
      setError(t('auth.error'));
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    'w-full card-pagne bg-creme-deep px-3 py-2 text-[1rem] border border-stone-200 focus-visible:ring-inset';

  return (
    <CardPagne className="p-4 space-y-3">
      <p className="font-display font-extrabold text-[0.8125rem] text-stone-700">{t('proprofile.title')}</p>
      {loading ? (
        <p className="text-[0.8125rem] text-stone-400">{t('common.loading')}</p>
      ) : (
        <>
          <label className="block">
            <span className="text-[0.75rem] text-stone-500">{t('proprofile.speciality')}</span>
            <input className={inputCls} value={speciality} onChange={(e) => setSpeciality(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[0.75rem] text-stone-500">{t('proprofile.fee')}</span>
              <input className={inputCls} inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-[0.75rem] text-stone-500">{t('proprofile.slot')}</span>
              <input className={inputCls} inputMode="numeric" value={slot} onChange={(e) => setSlot(e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="text-[0.75rem] text-stone-500">{t('proprofile.bio')}</span>
            <textarea className={inputCls} rows={3} value={bio} onChange={(e) => setBio(e.target.value)} />
          </label>
          <div className="flex items-center gap-3">
            <Button variant="indigo" onClick={() => void save()} disabled={saving}>
              {t('proprofile.save')}
            </Button>
            {saved && <span className="text-[0.75rem] text-sante-700 font-bold">{t('proprofile.saved')}</span>}
            {error && <span className="text-[0.75rem] text-sos-600 font-bold" role="alert">{error}</span>}
          </div>
        </>
      )}
    </CardPagne>
  );
}
