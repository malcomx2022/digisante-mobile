'use client';

import { useState } from 'react';
import Link from 'next/link';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { Badge, Button, CardPagne } from '@/components/ui';
import { Empty, ErrorState, SkeletonCards } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { appointmentsApi, type PatientAppointment } from '@/lib/api/appointments';
import { ApiRequestError, post } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';
import { formatDateTime, formatNumber } from '@/i18n/format';

// Moyens de paiement d'une consultation (le montant est imposé par le serveur = tarif médecin).
//
// « Wallet » RÉTABLI au lot 8 (19/08/2026) : `payments.initiate` débite désormais
// réellement le portefeuille (débit atomique + `Payment` COMPLETED dans la MÊME
// transaction). Il avait été retiré le 18/08 parce qu'il n'ouvrait qu'un checkout
// FedaPay sans jamais toucher au solde — et verrouillait le RDV au passage.
const PAY_METHODS: { method: string; label: string; cls: string }[] = [
  { method: 'MTN_MOMO', label: 'MTN MoMo', cls: 'bg-sante-600 text-white' },
  { method: 'MOOV_MONEY', label: 'Moov Money', cls: 'bg-indigo-600 text-white' },
  { method: 'WALLET', label: 'Wallet 🇫🇷', cls: 'bg-ocre-400 text-stone-900' },
];

// Mes rendez-vous — liste (à venir / passés), annulation, rejoindre la téléconsult.
export default function AppointmentsPage() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  // Paiement de consultation (montant imposé serveur) : sélecteur de moyen + états.
  const [payOpen, setPayOpen] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState<string | null>(null);
  const [paidLocal, setPaidLocal] = useState<Set<string>>(new Set());
  const [queuedLocal, setQueuedLocal] = useState<Set<string>>(new Set());
  const [payError, setPayError] = useState<Set<string>>(new Set());
  const [payErrorMsg, setPayErrorMsg] = useState<Record<string, string>>({});
  const { data, loading, error } = useApi<PatientAppointment[]>(() => appointmentsApi.listMine(), [tick]);

  // Le montant N'EST PAS envoyé : le serveur impose le tarif du médecin du RDV (§5).
  async function pay(id: string, method: string) {
    if (payBusy) return;
    setPayBusy(id);
    setPayError((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    try {
      const res = await post<{ paymentUrl: string | null }>('/payments', {
        type: 'CONSULTATION',
        method,
        appointmentId: id,
      });
      if (res && typeof res === 'object' && 'queued' in res) {
        setQueuedLocal((s) => new Set(s).add(id));
        return;
      }
      // Mobile Money / carte : le paiement n'est PAS acquis ici, il l'est sur la
      // page hébergée FedaPay, puis confirmé par webhook. Rediriger est l'étape
      // qui manquait : sans elle le patient voyait « payé » alors que sa
      // transaction restait PENDING et qu'il n'avait jamais rien réglé.
      if (res.paymentUrl) {
        window.location.href = res.paymentUrl;
        return;
      }
      // Portefeuille : débité côté serveur, paiement terminal immédiatement.
      setPaidLocal((s) => new Set(s).add(id));
      setPayOpen(null);
    } catch (e) {
      // Solde insuffisant : message explicite plutôt qu'un « échec » opaque.
      setPayErrorMsg((s) => ({
        ...s,
        [id]: e instanceof ApiRequestError && e.status === 400 ? e.error.message : t('appt.pay_error'),
      }));
      setPayError((s) => new Set(s).add(id));
    } finally {
      setPayBusy(null);
    }
  }

  async function confirmCancel(id: string) {
    setCancelError(null);
    try {
      await appointmentsApi.cancel(id, reason.trim() || t('appt.cancel_default'));
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
    const payable = !a.paid && !paidLocal.has(a.id) && (a.status === 'PENDING' || a.status === 'CONFIRMED');
    return (
      <CardPagne key={a.id} className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-display font-bold text-[0.9375rem] text-stone-800 truncate">{a.doctorName}</p>
            <p className="text-[0.75rem] text-stone-500">{a.speciality}</p>
            <p className="text-[0.75rem] text-stone-400 mt-0.5">
              {formatDateTime(a.scheduledAt, { dateStyle: 'medium', timeStyle: 'short' })}
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
              <Link href={`/patient/teleconsult?id=${a.consultationId}`} className="card-pagne bg-sante-600 text-white font-display font-extrabold text-[0.75rem] px-3 py-1.5">
                {t('home.join')}
              </Link>
            )}
            {cancellable && cancelling !== a.id && (
              <button type="button" onClick={() => { setCancelling(a.id); setReason(''); setCancelError(null); }} className="card-pagne bg-sos-50 text-sos-700 font-display font-extrabold text-[0.75rem] px-3 py-1.5">
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
                aria-label={t('appt.reason')}
                className="flex-1 bg-white card-pagne border border-stone-300 px-3 py-2 text-base pagne-focus focus:outline-none focus:border-sos-600"
              />
              <Button variant="sos" className="text-[0.75rem] px-3 py-2" onClick={() => confirmCancel(a.id)}>
                {t('appt.confirm_cancel')}
              </Button>
            </div>
            {cancelError && <p className="text-sos-600 font-bold text-[0.75rem] mt-2">{cancelError}</p>}
          </div>
        )}

        {/* Paiement de la consultation — montant imposé par le serveur (tarif du médecin). */}
        {(a.paid || paidLocal.has(a.id)) ? (
          <p className="mt-3 text-[0.75rem] text-sante-700 font-bold"><span aria-hidden="true">✓</span> {t('prescriptions.paid')}</p>
        ) : queuedLocal.has(a.id) ? (
          <p className="mt-3 text-[0.75rem] text-ocre-600 font-bold"><span aria-hidden="true">⏳</span> {t('prescriptions.payment_queued')}</p>
        ) : payable ? (
          payOpen === a.id ? (
            <div className="mt-3">
              <div className="grid grid-cols-3 gap-2">
                {PAY_METHODS.map((m) => (
                  <button
                    key={m.method}
                    type="button"
                    onClick={() => pay(a.id, m.method)}
                    disabled={payBusy === a.id}
                    className={`card-pagne pagne-focus ${m.cls} font-display font-bold text-[0.6875rem] py-2 px-1 disabled:opacity-50`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {payError.has(a.id) && (
                <p className="mt-2 text-[0.75rem] text-sos-600 font-bold" role="alert">
                  {payErrorMsg[a.id] ?? t('appt.pay_error')}
                </p>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setPayOpen(a.id); setPayError((s) => { const n = new Set(s); n.delete(a.id); return n; }); }}
              className="mt-3 card-pagne pagne-focus bg-sante-600 text-white font-display font-extrabold text-[0.75rem] px-3 py-1.5"
            >
              {t('appt.pay')} · {formatNumber(a.fee)} XOF
            </button>
          )
        ) : null}
      </CardPagne>
    );
  };

  return (
    <>
      <PatientHeader title={t('appt.title')} wide />
      <main className="px-6 -mt-10 relative z-20 space-y-3 pb-6">
        {loading && <SkeletonCards label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && all.length === 0 && <Empty label={t('appt.empty')} />}

        {upcoming.length > 0 && (
          <>
            <p className="font-display font-extrabold text-[0.8125rem] text-stone-700">{t('appt.upcoming')}</p>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">{upcoming.map(card)}</div>
          </>
        )}
        {past.length > 0 && (
          <>
            <p className="font-display font-extrabold text-[0.8125rem] text-stone-700 pt-2">{t('appt.past')}</p>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">{past.map(card)}</div>
          </>
        )}
      </main>
    </>
  );
}
