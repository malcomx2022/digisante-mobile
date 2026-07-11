'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Button, CardPagne, Nkyinkyim } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { Empty, ErrorState, SkeletonCards } from '@/components/ui/States';
import { formatDate } from '@/i18n/format';
import { useLocale } from '@/i18n/LocaleProvider';
import { type AscBeneficiary, ascApi } from '@/lib/api/asc';
import { useApi } from '@/lib/api/useApi';

// Espace ASC — roster du village : habitants suivis par l'agent (modèle A, relais).
// Journal opérationnel, PAS un DMP (§4). Cloisonné par ASC côté serveur.
export default function AscRosterPage() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const { data, loading, error } = useApi<AscBeneficiary[]>(() => ascApi.list(), [tick]);

  const [name, setName] = useState('');
  const [village, setVillage] = useState('');
  const [phone, setPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await ascApi.add({ name: name.trim(), village: village.trim() || undefined, phone: phone.trim() || undefined, birthDate: birthDate || undefined });
      setName('');
      setVillage('');
      setPhone('');
      setBirthDate('');
      setTick((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SpaceHeader title={t('asc.title')} subtitle={t('asc.subtitle')} headerClass="bg-sante-900" />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto lg:w-full">
        <CardPagne stitch className="p-4">
          <h2 className="font-display font-extrabold text-[0.9375rem] text-sante-800">{t('asc.add')}</h2>
          <Nkyinkyim className="my-2" />
          <div className="space-y-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('asc.name_ph')} className="w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-base pagne-focus focus:outline-none focus:border-sante-600" />
            <div className="flex gap-2">
              <input value={village} onChange={(e) => setVillage(e.target.value)} placeholder={t('asc.village_ph')} className="flex-1 bg-white card-pagne border border-stone-300 px-3 py-2 text-base focus:outline-none focus:border-sante-600" />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder={t('asc.phone_ph')} className="flex-1 bg-white card-pagne border border-stone-300 px-3 py-2 text-base focus:outline-none focus:border-sante-600" />
            </div>
            <label className="block">
              <span className="text-[0.6875rem] text-stone-500">{t('asc.birthdate')}</span>
              <input type="date" value={birthDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBirthDate(e.target.value)} className="mt-1 w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-base focus:outline-none focus:border-sante-600" />
            </label>
            <Button variant="sante" full disabled={saving || !name.trim()} onClick={add}>
              {saving ? t('common.loading') : t('asc.add_btn')}
            </Button>
          </div>
        </CardPagne>

        {loading && !data && <SkeletonCards label={t('common.loading')} />}
        {error && <ErrorState label={t('common.load_error')} />}
        {!loading && !error && (data?.length ?? 0) === 0 && <Empty label={t('asc.empty')} />}

        {(data ?? []).map((b) => (
          <Link key={b.id} href={`/asc/beneficiary/${b.id}`} className="block card-pagne focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sante-600">
            <CardPagne className="p-4 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-display font-bold text-[0.9375rem] text-stone-900">{b.name}</p>
                <p className="text-[0.75rem] text-stone-500">
                  {[b.village, b.birthDate ? formatDate(b.birthDate) : null].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <span aria-hidden="true" className="text-sante-600">›</span>
            </CardPagne>
          </Link>
        ))}
      </main>
    </>
  );
}
