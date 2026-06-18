'use client';

import { useMemo, useState } from 'react';

import { Badge, Button, CardPagne } from '@/components/ui';
import { useLocale } from '@/i18n/LocaleProvider';
import { ApiRequestError, post } from '@/lib/api/client';
import { cn } from '@/lib/cn';

export interface BookingDoctor {
  id: string;
  speciality: string;
  consultFee: string | number;
  profile: { firstName: string; lastName: string; spokenLangs?: string[] } | null;
}

type ApptType = 'PHYSICAL' | 'TELECONSULTATION';

interface BookedAppointment {
  id: string;
  status: string;
  scheduledAt: string;
  type: ApptType;
}

// Pas d'endpoint de disponibilité côté API : on propose des créneaux candidats
// (prochains jours ouvrés × heures de cabinet). Le backend valide l'absence de
// conflit (409) au moment de la réservation.
const SLOT_HOURS = [8, 9, 10, 11, 14, 15, 16, 17];
const DAYS_AHEAD = 5;

function buildDays(): Date[] {
  const days: Date[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  while (days.length < DAYS_AHEAD) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay();
    if (dow !== 0) days.push(new Date(cursor)); // exclut le dimanche
  }
  return days;
}

/** Parcours de réservation : créneau → type → confirmation (POST /appointments). */
export function BookingModal({
  doctor,
  onClose,
  onBooked,
}: {
  doctor: BookingDoctor;
  onClose: () => void;
  onBooked?: (appt: BookedAppointment) => void;
}) {
  const { t } = useLocale();
  const days = useMemo(() => buildDays(), []);
  const [day, setDay] = useState<Date>(days[0]);
  const [hour, setHour] = useState<number | null>(null);
  const [type, setType] = useState<ApptType>('PHYSICAL');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<BookedAppointment | null>(null);

  const scheduledAt = useMemo(() => {
    if (hour === null) return null;
    const d = new Date(day);
    d.setHours(hour, 0, 0, 0);
    return d;
  }, [day, hour]);

  async function confirm() {
    if (!scheduledAt) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await post<BookedAppointment>('/appointments', {
        doctorId: doctor.id,
        type,
        scheduledAt: scheduledAt.toISOString(),
      });
      if ('queued' in res) {
        // Hors-ligne : la réservation est mise en file et rejouée au retour réseau.
        setDone({ id: 'queued', status: 'QUEUED', scheduledAt: scheduledAt.toISOString(), type });
        onBooked?.({ id: 'queued', status: 'QUEUED', scheduledAt: scheduledAt.toISOString(), type });
        return;
      }
      setDone(res);
      onBooked?.(res);
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 409) {
        setError(t('booking.slot_taken'));
      } else {
        setError(t('booking.error'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-nuit/60 px-4 py-6" role="dialog" aria-modal="true">
      <CardPagne stitch className="w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display font-extrabold text-[0.9375rem] text-stone-800">
              Dr {doctor.profile?.firstName} {doctor.profile?.lastName}
            </p>
            <p className="text-[0.75rem] text-stone-500">{doctor.speciality}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-stone-400 font-display font-extrabold text-lg leading-none px-2"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        {done ? (
          <div className="mt-4 text-center py-4">
            <div className="w-14 h-14 card-pagne bg-sante-600 text-white rotate-2 mx-auto grid place-items-center font-display font-extrabold text-2xl" aria-hidden="true">✓</div>
            <p className="font-display font-extrabold text-[1rem] text-stone-800 mt-3">
              {done.status === 'QUEUED' ? t('booking.queued_title') : t('booking.success_title')}
            </p>
            <p className="text-[0.8125rem] text-stone-500 mt-1">
              {new Date(done.scheduledAt).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })}
            </p>
            <p className="text-[0.75rem] text-stone-400 mt-1">
              {done.type === 'TELECONSULTATION' ? t('booking.type_teleconsult') : t('booking.type_physical')}
              {' · '}
              {t('booking.status_pending')}
            </p>
            <Button variant="sante" full className="mt-4" onClick={onClose}>
              {t('common.close')}
            </Button>
          </div>
        ) : (
          <>
            <div className="nkyinkyim w-full my-3 opacity-30" />

            {/* Étape 1 — jour */}
            <p className="font-display font-bold text-[0.75rem] text-stone-600 mb-2">{t('booking.choose_day')}</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {days.map((d, i) => {
                const active = d.toDateString() === day.toDateString();
                return (
                  <button
                    key={d.toISOString()}
                    type="button"
                    onClick={() => {
                      setDay(d);
                      setHour(null);
                    }}
                    className={cn(
                      'shrink-0 card-pagne px-3 py-2 text-center min-w-[58px] border',
                      i % 2 === 0 ? 'rotate-1' : '-rotate-1',
                      active ? 'bg-sante-600 text-white border-sante-700' : 'bg-white text-stone-700 border-stone-200',
                    )}
                  >
                    <span className="block font-display font-extrabold text-[0.6875rem] uppercase">
                      {d.toLocaleDateString('fr-FR', { weekday: 'short' })}
                    </span>
                    <span className="block font-display font-extrabold text-[1rem] leading-tight">{d.getDate()}</span>
                  </button>
                );
              })}
            </div>

            {/* Étape 2 — heure */}
            <p className="font-display font-bold text-[0.75rem] text-stone-600 mt-4 mb-2">{t('booking.choose_slot')}</p>
            <div className="grid grid-cols-4 gap-2">
              {SLOT_HOURS.map((h) => {
                const active = hour === h;
                return (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setHour(h)}
                    className={cn(
                      'card-pagne py-2 font-display font-bold text-[0.8125rem] border',
                      active ? 'bg-sante-600 text-white border-sante-700' : 'bg-white text-stone-700 border-stone-200',
                    )}
                  >
                    {String(h).padStart(2, '0')}:00
                  </button>
                );
              })}
            </div>

            {/* Étape 3 — type */}
            <p className="font-display font-bold text-[0.75rem] text-stone-600 mt-4 mb-2">{t('booking.choose_type')}</p>
            <div className="grid grid-cols-2 gap-2">
              {(['PHYSICAL', 'TELECONSULTATION'] as ApptType[]).map((ty) => {
                const active = type === ty;
                return (
                  <button
                    key={ty}
                    type="button"
                    onClick={() => setType(ty)}
                    className={cn(
                      'card-pagne py-3 font-display font-bold text-[0.8125rem] border',
                      active ? 'bg-sante-600 text-white border-sante-700' : 'bg-white text-stone-700 border-stone-200',
                    )}
                  >
                    {ty === 'PHYSICAL' ? t('booking.type_physical') : t('booking.type_teleconsult')}
                  </button>
                );
              })}
            </div>

            <div className="nkyinkyim w-full my-4 opacity-30" />

            <div className="flex items-center justify-between">
              <span className="font-display font-bold text-sante-700 text-[0.8125rem]">
                {Number(doctor.consultFee).toLocaleString('fr-FR')} {t('common.fcfa')}
              </span>
              {scheduledAt && (
                <Badge variant="normal">
                  {scheduledAt.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </Badge>
              )}
            </div>

            {error && <p className="text-sos-600 font-bold text-[0.8125rem] mt-3 text-center">{error}</p>}

            <Button variant="terre" full className="mt-4" disabled={!scheduledAt || submitting} onClick={confirm}>
              {submitting ? t('booking.submitting') : t('booking.confirm')}
            </Button>
          </>
        )}
      </CardPagne>
    </div>
  );
}
