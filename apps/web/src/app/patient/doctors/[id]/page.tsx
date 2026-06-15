'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { BookingModal, type BookingDoctor } from '@/components/patient/BookingModal';
import { PatientHeader } from '@/components/patient/PatientHeader';
import { Badge, Button, CardPagne, Nkyinkyim } from '@/components/ui';
import { ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { professionalsApi, type DoctorDetail, type ReviewsResponse } from '@/lib/api/professionals';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';

const stars = (n: number) => '★★★★★☆☆☆☆☆'.slice(5 - Math.round(n), 10 - Math.round(n));

export default function DoctorDetailPage() {
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [booking, setBooking] = useState<BookingDoctor | null>(null);
  const [reviewTick, setReviewTick] = useState(0);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);

  const { data, loading, error } = useApi<DoctorDetail>(() => professionalsApi.getOne(id), [id, reviewTick]);
  const { data: reviews } = useApi<ReviewsResponse>(() => professionalsApi.reviews(id), [id, reviewTick]);

  async function submitReview() {
    try {
      await professionalsApi.addReview(id, { rating, comment: comment.trim() || undefined });
      setSent(true);
      setComment('');
      setReviewTick((n) => n + 1);
    } catch {
      /* best-effort */
    }
  }

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
                  {data.rating.average != null && (
                    <p className="text-[13px] text-ocre-600 font-bold mt-0.5">
                      {stars(data.rating.average)} {data.rating.average} · {t('reviews.count', { n: String(data.rating.count) })}
                    </p>
                  )}
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
              <Link href={`/patient/chat?doctor=${data.id}`} className="flex-1 text-center border border-sante-600 text-sante-700 card-pagne font-display font-bold py-3">
                {t('chat.message')}
              </Link>
              <Button variant="sante" className="flex-1 py-3" onClick={() => setBooking({ id: data.id, speciality: data.speciality, consultFee: data.consultFee, profile: data.profile })}>
                {t('doctors.book')}
              </Button>
            </div>

            {/* Formulaire de notation (si consultation terminée) */}
            {data.canReview && (
              <CardPagne className="p-4">
                <p className="font-display font-extrabold text-[13px] text-stone-700">{t('reviews.rate')}</p>
                <div className="flex gap-1 mt-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" onClick={() => setRating(n)} className={cn('text-2xl leading-none', n <= rating ? 'text-ocre-500' : 'text-stone-300')} aria-label={`${n}/5`}>
                      ★
                    </button>
                  ))}
                </div>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={t('reviews.comment')}
                  className="mt-2 w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-[14px] focus:outline-none focus:border-sante-600"
                  rows={2}
                />
                {sent && <p className="text-sante-700 font-display font-bold text-[13px] mt-1">{t('reviews.submitted')}</p>}
                <Button variant="sante" full className="mt-2" onClick={submitReview}>
                  {t('reviews.submit')}
                </Button>
              </CardPagne>
            )}

            {/* Liste des avis */}
            <CardPagne className="p-4">
              <p className="font-display font-extrabold text-[13px] text-stone-700">{t('reviews.title')}</p>
              <Nkyinkyim className="my-3" />
              {(reviews?.reviews.length ?? 0) === 0 ? (
                <p className="text-[13px] text-stone-400">{t('reviews.none')}</p>
              ) : (
                <div className="space-y-3">
                  {(reviews?.reviews ?? []).map((r, i) => (
                    <div key={i} className="border-b border-dashed border-stone-200 pb-2 last:border-0">
                      <div className="flex items-center justify-between">
                        <span className="font-display font-bold text-[13px] text-stone-800">{r.name}</span>
                        <span className="text-ocre-500 text-[13px]">{stars(r.rating)}</span>
                      </div>
                      {r.comment && <p className="text-[13px] text-stone-600 mt-0.5">{r.comment}</p>}
                    </div>
                  ))}
                </div>
              )}
            </CardPagne>
          </>
        )}
      </main>

      {booking && <BookingModal doctor={booking} onClose={() => setBooking(null)} />}
    </>
  );
}
