'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { BookingModal, type BookingDoctor } from '@/components/patient/BookingModal';
import { PatientHeader } from '@/components/patient/PatientHeader';
import { Badge, Button, CardPagne } from '@/components/ui';
import { Empty, ErrorState, SkeletonCards } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { LANGUAGE_LIST } from '@digisante/shared';
import { professionalsApi, type DoctorListItem } from '@/lib/api/professionals';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/i18n/format';

// Liste des langues dérivée de l'enum canonique partagé (source de vérité, parité garantie).
const LANGS = LANGUAGE_LIST.map((l) => l.code);

// D-05 — Recherche de médecin (annuaire vérifié) : recherche texte + filtre langue.
export default function DoctorsPage() {
  const { t } = useLocale();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [lang, setLang] = useState<string | null>(null);
  const [booking, setBooking] = useState<BookingDoctor | null>(null);

  // Debounce de la recherche : évite une requête par frappe (réseaux 2G/rural).
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  const { data, loading, error } = useApi(
    () => professionalsApi.list({ q: debouncedQ || undefined, lang: lang ?? undefined }),
    [debouncedQ, lang],
  );
  const doctors: DoctorListItem[] = data?.data ?? [];

  return (
    <>
      <PatientHeader title={t('doctors.title')} wide />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('doctors.search')}
          aria-label={t('doctors.search')}
          className="w-full lg:max-w-md bg-white card-pagne border-2 border-stone-900 px-4 py-3 font-body text-[0.9375rem] shadow-[4px_4px_0_rgba(33,28,22,.15)] focus:outline-none focus:border-sante-600 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sante-600"
        />

        {/* Filtre par langue parlée (barrière linguistique) */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            type="button"
            onClick={() => setLang(null)}
            className={cn('shrink-0 card-pagne px-3 py-1.5 text-[0.75rem] font-display font-bold', lang === null ? 'bg-sante-600 text-white' : 'bg-creme-deep text-stone-600')}
          >
<span aria-hidden="true">🗣</span> {t('doctors.all_langs')}
          </button>
          {LANGS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l === lang ? null : l)}
              className={cn('shrink-0 card-pagne px-3 py-1.5 text-[0.75rem] font-display font-bold', l === lang ? 'bg-sante-600 text-white' : 'bg-creme-deep text-stone-600')}
            >
              {l}
            </button>
          ))}
        </div>

        {loading && <SkeletonCards label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && doctors.length === 0 && <Empty label={t('common.empty')} />}

        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
          {doctors.map((d) => (
            <CardPagne key={d.id} className="p-4">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 card-pagne bg-sante-900 bogolan-dark rotate-2 shrink-0" />
                <div className="flex-1">
                  <Link href={`/patient/doctors/${d.id}`} className="flex items-center gap-2">
                    <p className="font-display font-extrabold text-[0.875rem] text-stone-800">
                      Dr {d.profile?.firstName} {d.profile?.lastName}
                    </p>
                    {d.isVerified && <Badge variant="normal"><span aria-hidden="true">✓</span> {t('doctors.verified')}</Badge>}
                  </Link>
                  <p className="text-[0.8125rem] text-stone-500">{d.speciality}</p>
                  {d.profile?.spokenLangs?.length ? (
                    <p className="text-[0.75rem] text-stone-400 mt-0.5"><span aria-hidden="true">🗣</span> {d.profile.spokenLangs.join(' · ')}</p>
                  ) : null}
                  {d.rating.average != null && (
                    <p className="text-[0.75rem] text-ocre-600 font-bold mt-0.5"><span aria-hidden="true">★</span> {d.rating.average} ({d.rating.count})</p>
                  )}
                  <div className="flex items-center justify-between mt-2">
                    <span className="font-display font-bold text-sante-700 text-[0.8125rem]">
                      {formatNumber(d.consultFee)} {t('common.fcfa')}
                    </span>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/patient/chat?doctor=${d.id}`}
                        className="text-[0.8125rem] px-3 py-1.5 border border-sante-600 text-sante-700 card-pagne font-display font-bold"
                      >
                        {t('chat.message')}
                      </Link>
                      <Button
                        variant="sante"
                        className="text-[0.8125rem] px-3 py-1.5"
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
