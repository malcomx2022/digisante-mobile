'use client';

import { useState } from 'react';
import Link from 'next/link';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { Badge, Button, CardPagne } from '@/components/ui';
import { Empty, ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { appointmentsApi, type PatientAppointment } from '@/lib/api/appointments';
import { useApi } from '@/lib/api/useApi';

// Mes rendez-vous — liste (à venir / passés), annulation, rejoindre la téléconsult.
export default function AppointmentsPage() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const { data, loading, error } = useApi<PatientAppointment[]>(() => appointmentsApi.listMine(), [tick]);

  async function confirmCancel(id: string) {
    setCancelError(null);
    try {
      await appointmentsApi.cancel(id, reason.trim() || 'Annulé par le patient');
      setCancelling(null);
      setReason('');
      setTick((n) => n + 1);
    } catch (e) {
      // L'annulation a échoué : on garde le formulaire ouvert avec un message visible.
      setCancelError(e instanceof Error ? e.message : t('auth.error'));
    }
  }

  const all = data ?? [];
  const now = Date.now();
  const upcoming = all
    .filter((a) => new Date(a.scheduledAt).getTime() > now && !['CANCELLED', 'COMPLETED'].includes(a.status))
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const past = all
    .filter((a) => !upcoming.includes(a))
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

  const card = (a: PatientAppointment) => {
    const future = new Date(a.scheduledAt).getTime() > now;
    const cancellable = future && (a.status === 'PENDING' || a.status === 'CONFIRMED');
    const joinable = a.status === 'CONFIRMED' && a.type === 'TELECONSULTATION' && a.consultationId;
    return (
      <CardPagne key={a.id} className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-display font-bold text-[15px] text-stone-800 truncate">{a.doctorName}</p>
            <p className="text-[12px] text-stone-500">{a.speciality}</p>
            <p className="text-[12px] text-stone-400 mt-0.5">
              {new Date(a.scheduledAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
              {a.type === 'TELECONSULTATION' ? ` · ${t('booking.type_teleconsult')}` : ` · ${t('booking.type_physical')}`}
            </p>
          </div>
          <Badge variant={a.status === 'CONFIRMED' ? 'normal' : a.status === 'CANCELLED' ? 'eleve' : 'priorite'}>
            {t(`appt.status.${a.status}`)}
          </Badge>
        </div>

        {(cancellable || joinable) && (
          <div className="mt-3 flex items-center gap-2">
            {joinable && (
              <Link href={`/patient/teleconsult?id=${a.consultationId}`} className="card-pagne bg-sante-600 text-white font-display font-extrabold text-[12px] px-3 py-1.5">
                {t('home.join')}
              </Link>
            )}
            {cancellable && cancelling !== a.id && (
              <button type="button" onClick={() => { setCancelling(a.id); setReason(''); setCancelError(null); }} className="card-pagne bg-sos-50 text-sos-700 font-display font-extrabold text-[12px] px-3 py-1.5">
                {t('appt.cancel')}
              </button>
            )}
          </div>
        )}

        {cancelling === a.id && (
          <div className="mt-3">
            <div className="flex items-center gap-2">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('appt.reason')}
                className="flex-1 bg-white card-pagne border border-stone-300 px-3 py-2 text-[13px] focus:outline-none focus:border-sos-600"
              />
              <Button variant="sos" className="text-[12px] px-3 py-2" onClick={() => confirmCancel(a.id)}>
                {t('appt.confirm_cancel')}
              </Button>
            </div>
            {cancelError && <p className="text-sos-600 font-bold text-[12px] mt-2">{cancelError}</p>}
          </div>
        )}
      </CardPagne>
    );
  };

  return (
    <>
      <PatientHeader title={t('appt.title')} />
      <main className="px-6 -mt-10 relative z-20 space-y-3 pb-6">
        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && all.length === 0 && <Empty label={t('appt.empty')} />}

        {upcoming.length > 0 && (
          <>
            <p className="font-display font-extrabold text-[13px] text-stone-700">{t('appt.upcoming')}</p>
            {upcoming.map(card)}
          </>
        )}
        {past.length > 0 && (
          <>
            <p className="font-display font-extrabold text-[13px] text-stone-700 pt-2">{t('appt.past')}</p>
            {past.map(card)}
          </>
        )}
      </main>
    </>
  );
}
