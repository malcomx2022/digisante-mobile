'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { BookingModal, type BookingDoctor } from '@/components/patient/BookingModal';
import { PatientHeader } from '@/components/patient/PatientHeader';
import { Badge, Button, CardPagne, Nkyinkyim } from '@/components/ui';
import { ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { professionalsApi, type DoctorDetail } from '@/lib/api/professionals';
import { useApi } from '@/lib/api/useApi';

// Fiche détaillée d'un médecin (bio, langues parlées, tarif) avant réservation.
export default function DoctorDetailPage() {
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [booking, setBooking] = useState<BookingDoctor | null>(null);
  const { data, loading, error } = useApi<DoctorDetail>(() => professionalsApi.getOne(id), [id]);

  return (
    <>
      <PatientHeader title={t('doctors.profile')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6">
        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}

        {data && (
          <>
            <CardPagne stitch className="p-5">
              <div className="flex items-start gap-3">
                <div className="w-16 h-16 card-pagne bg-sante-900 bogolan-dark rotate-2 shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-display font-extrabold text-[17px] text-stone-800">
                      Dr {data.profile?.firstName} {data.profile?.lastName}
                    </p>
                    {data.isVerified && <Badge variant="normal">✓ {t('doctors.verified')}</Badge>}
                  </div>
                  <p className="text-[13px] text-stone-500">{data.speciality}</p>
                  <p className="font-display font-bold text-sante-700 text-[14px] mt-1">
                    {Number(data.consultFee).toLocaleString('fr-FR')} {t('common.fcfa')}
                  </p>
                </div>
              </div>

              {data.profile?.spokenLangs?.length ? (
                <p className="text-[12px] text-stone-500 mt-3">🗣 {data.profile.spokenLangs.join(' · ')}</p>
              ) : null}

              {data.bio ? (
                <>
                  <Nkyinkyim className="my-3" />
                  <p className="text-[13px] text-stone-600 whitespace-pre-line">{data.bio}</p>
                </>
              ) : null}
            </CardPagne>

            <div className="flex gap-2">
              <Link
                href={`/patient/chat?doctor=${data.id}`}
                className="flex-1 text-center border border-sante-600 text-sante-700 card-pagne font-display font-bold py-3"
              >
                {t('chat.message')}
              </Link>
              <Button
                variant="sante"
                className="flex-1 py-3"
                onClick={() => setBooking({ id: data.id, speciality: data.speciality, consultFee: data.consultFee, profile: data.profile })}
              >
                {t('doctors.book')}
              </Button>
            </div>
          </>
        )}
      </main>

      {booking && <BookingModal doctor={booking} onClose={() => setBooking(null)} />}
    </>
  );
}
