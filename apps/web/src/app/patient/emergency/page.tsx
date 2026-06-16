'use client';

import { useEffect, useState } from 'react';

import { normalizeBeninPhone } from '@digisante/shared';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { Button, CardPagne, Nkyinkyim } from '@/components/ui';
import { ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { usersApi, type MedicalInfo } from '@/lib/api/users';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// Fiche médicale d'urgence — visible en un coup d'œil (groupe sanguin, allergies,
// maladies chroniques, contact d'urgence). Vitale en cas de SOS.
export default function EmergencyCardPage() {
  const { t } = useLocale();
  const { data, loading, error } = useApi<MedicalInfo>(() => usersApi.medical(), []);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const [bloodGroup, setBloodGroup] = useState('');
  const [allergies, setAllergies] = useState('');
  const [chronic, setChronic] = useState('');
  const [contact, setContact] = useState('');

  useEffect(() => {
    if (!data) return;
    setBloodGroup(data.bloodGroup ?? '');
    setAllergies(data.allergies.join(', '));
    setChronic(data.chronicDiseases.join(', '));
    setContact(data.emergencyContact ?? '');
  }, [data]);

  const toList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

  async function save() {
    setSaving(true);
    setSaved(false);
    setSaveError(false);
    try {
      await usersApi.updateMedical({
        ...(bloodGroup ? { bloodGroup } : {}),
        allergies: toList(allergies),
        chronicDiseases: toList(chronic),
        emergencyContact: normalizeBeninPhone(contact.trim()),
      });
      setSaved(true);
      setEditing(false);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  // Réouverture du formulaire : repartir d'un état propre (pas de « ✓ enregistré »
  // résiduel ni d'erreur précédente affichée).
  function openEditing() {
    setSaved(false);
    setSaveError(false);
    setEditing(true);
  }

  const chips = (items: string[], tone: 'sos' | 'ocre') =>
    items.length ? (
      <div className="flex flex-wrap gap-1.5 mt-1">
        {items.map((it) => (
          <span
            key={it}
            className={cn(
              'card-pagne px-2.5 py-1 text-[12px] font-display font-bold',
              tone === 'sos' ? 'bg-sos-50 text-sos-700' : 'bg-ocre-50 text-ocre-700',
            )}
          >
            {it}
          </span>
        ))}
      </div>
    ) : (
      <p className="text-[13px] text-stone-400 mt-0.5">{t('emergency.none')}</p>
    );

  return (
    <>
      <PatientHeader title={t('emergency.title')} subtitle={t('emergency.subtitle')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6">
        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}

        {!loading && !error && data && !editing && (
          <>
            {/* Carte d'urgence — groupe sanguin en évidence */}
            <CardPagne stitch className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[12px] text-stone-500 font-display font-bold uppercase tracking-wide">
                    {t('emergency.blood_group')}
                  </p>
                  <p className="font-display font-extrabold text-4xl text-sos-600 leading-none mt-1">
                    {data.bloodGroup || '—'}
                  </p>
                </div>
                <span className="text-3xl" aria-hidden>
                  🩸
                </span>
              </div>

              <Nkyinkyim className="my-4" />

              <p className="font-display font-extrabold text-[13px] text-stone-700">{t('emergency.allergies')}</p>
              {chips(data.allergies, 'sos')}

              <p className="font-display font-extrabold text-[13px] text-stone-700 mt-3">{t('emergency.chronic')}</p>
              {chips(data.chronicDiseases, 'ocre')}

              <p className="font-display font-extrabold text-[13px] text-stone-700 mt-3">{t('emergency.contact')}</p>
              {data.emergencyContact ? (
                <a href={`tel:${data.emergencyContact}`} className="text-[15px] font-display font-bold text-sante-700">
                  📞 {data.emergencyContact}
                </a>
              ) : (
                <p className="text-[13px] text-stone-400 mt-0.5">{t('emergency.none')}</p>
              )}
            </CardPagne>

            {saved && <p className="text-sante-700 font-display font-bold text-[13px] text-center">{t('emergency.saved')}</p>}
            <Button variant="sante" full onClick={openEditing}>
              {t('emergency.edit')}
            </Button>
          </>
        )}

        {!loading && !error && editing && (
          <CardPagne className="p-4 space-y-3">
            <div>
              <p className="font-display font-bold text-[12px] text-stone-600 mb-1">{t('emergency.blood_group')}</p>
              <div className="grid grid-cols-4 gap-2">
                {BLOOD_GROUPS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setBloodGroup(g === bloodGroup ? '' : g)}
                    className={cn(
                      'card-pagne py-2 font-display font-bold text-[13px] border',
                      g === bloodGroup ? 'bg-sos-600 text-white border-sos-700' : 'bg-white text-stone-700 border-stone-200',
                    )}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="font-display font-bold text-[12px] text-stone-600">{t('emergency.allergies')}</span>
              <input
                value={allergies}
                onChange={(e) => setAllergies(e.target.value)}
                placeholder={t('emergency.list_hint')}
                className="mt-1 w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-[14px] focus:outline-none focus:border-sante-600"
              />
            </label>

            <label className="block">
              <span className="font-display font-bold text-[12px] text-stone-600">{t('emergency.chronic')}</span>
              <input
                value={chronic}
                onChange={(e) => setChronic(e.target.value)}
                placeholder={t('emergency.list_hint')}
                className="mt-1 w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-[14px] focus:outline-none focus:border-sante-600"
              />
            </label>

            <label className="block">
              <span className="font-display font-bold text-[12px] text-stone-600">{t('emergency.contact')}</span>
              <input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="+229 01 96 46 67 77"
                className="mt-1 w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-[14px] focus:outline-none focus:border-sante-600"
              />
            </label>

            {saveError && <p className="text-sos-600 font-display font-bold text-[13px] text-center">{t('auth.error')}</p>}
            <Button variant="sante" full disabled={saving} onClick={save}>
              {saving ? t('common.loading') : t('emergency.save')}
            </Button>
            <button type="button" onClick={() => setEditing(false)} className="w-full text-center text-[13px] text-stone-500">
              {t('common.close')}
            </button>
          </CardPagne>
        )}
      </main>
    </>
  );
}
