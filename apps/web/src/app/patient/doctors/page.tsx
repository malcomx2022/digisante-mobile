'use client';

import Link from 'next/link';
import { useState } from 'react';

import { BookingModal, type BookingDoctor } from '@/components/patient/BookingModal';
import { PatientHeader } from '@/components/patient/PatientHeader';
import { Badge, Button, CardPagne } from '@/components/ui';
import { Empty, ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { professionalsApi, type DoctorListItem } from '@/lib/api/professionals';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';

const LANGS = ['FR', 'EN', 'FON', 'BARIBA', 'DENDI'];

// D-05 — Recherche de médecin (annuaire vérifié) : recherche texte + filtre langue.
export default function DoctorsPage() {
  const { t } = useLocale();
  const [q, setQ] = useState('');
  const [lang, setLang] = useState<string | null>(null);
  const [booking, setBooking] = useState<BookingDoctor | null>(null);
  const { data, loading, error } = useApi(() => professionalsApi.list({ q: q || undefined, lang: lang ?? undefined }), [q, lang]);
  const doctors: DoctorListItem[] = data?.data ?? [];

  return (
    <>
      <PatientHeader title={t('doctors.title')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('doctors.search')}
          className="w-full bg-white card-pagne border-2 border-stone-900 px-4 py-3 font-body text-[15px] shadow-[4px_4px_0_rgba(33,28,22,.15)] focus:outline-none"
        />

        {/* Filtre par langue parlée (barrière linguistique) */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            type="button"
            onClick={() => setLang(null)}
            className={cn('shrink-0 card-pagne px-3 py-1.5 text-[12px] font-display font-bold', lang === null ? 'bg-sante-600 text-white' : 'bg-creme-deep text-stone-600')}
          >
            🗣 {t('doctors.all_langs')}
          </button>
          {LANGS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l === lang ? null : l)}
              className={cn('shrink-0 card-pagne px-3 py-1.5 text-[12px] font-display font-bold', l === lang ? 'bg-sante-600 text-white' : 'bg-creme-deep text-stone-600')}
            >
              {l}
            </button>
          ))}
        </div>

        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && doctors.length === 0 && <Empty label={t('common.empty')} />}

        <div className="space-y-3">
          {doctors.map((d) => (
            <CardPagne key={d.id} className="p-4">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 card-pagne bg-sante-900 bogolan-dark rotate-2 shrink-0" />
                <div className="flex-1">
                  <Link href={`/patient/doctors/${d.id}`} className="flex items-center gap-2">
                    <p className="font-display font-extrabold text-[14px] text-stone-800">
                      Dr {d.profile?.firstName} {d.profile?.lastName}
                    </p>
                    {d.isVerified && <Badge variant="normal">✓ {t('doctors.verified')}</Badge>}
                  </Link>
                  <p className="text-[13px] text-stone-500">{d.speciality}</p>
                  {d.profile?.spokenLangs?.length ? (
                    <p className="text-[12px] text-stone-400 mt-0.5">🗣 {d.profile.spokenLangs.join(' · ')}</p>
                  ) : null}
                  <div className="flex items-center justify-between mt-2">
                    <span className="font-display font-bold text-sante-700 text-[13px]">
                      {Number(d.consultFee).toLocaleString('fr-FR')} {t('common.fcfa')}
                    </span>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/patient/chat?doctor=${d.id}`}
                        className="text-[13px] px-3 py-1.5 border border-sante-600 text-sante-700 card-pagne font-display font-bold"
                      >
                        {t('chat.message')}
                      </Link>
                      <Button
                        variant="sante"
                        className="text-[13px] px-3 py-1.5"
                        onClick={() =>
                          setBooking({ id: d.id, speciality: d.speciality, consultFee: d.consultFee, profile: d.profile })
                        }
                      >
                        {t('doctors.book')}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </CardPagne>
          ))}
        </div>
      </main>

      {booking && <BookingModal doctor={booking} onClose={() => setBooking(null)} />}
    </>
  );
}
