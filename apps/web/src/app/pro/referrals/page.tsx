'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { ProHeader } from '@/components/pro/ProHeader';
import { Badge, Button, CardPagne, ConfirmDialog, Nkyinkyim } from '@/components/ui';
import { Empty, ErrorState, SkeletonCards } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { formatDate } from '@/i18n/format';
import { professionalsApi, type DoctorListItem } from '@/lib/api/professionals';
import { referralsApi, type Referral, type ReferralAction } from '@/lib/api/referrals';
import { useApi } from '@/lib/api/useApi';

// Couleur de la barre latérale par statut (repère visuel avant lecture).
const BAR: Record<Referral['status'], string> = {
  PENDING: 'bg-ocre-400',
  ACCEPTED: 'bg-indigo-500',
  COMPLETED: 'bg-sante-500',
  CANCELLED: 'bg-stone-300',
};

/**
 * Orientation d'un patient vers un confrère (espace MÉDECIN PRO).
 *
 * §4 — l'orientation ne donne AUCUN accès au DMP du patient : elle transmet le
 * motif et l'identité au confrère, rien d'autre. Le destinataire qui veut lire
 * le dossier doit obtenir un partage consenti, comme n'importe quel soignant.
 *
 * Le `patientId` arrive de la vue 360° (`/pro/referrals?patientId=…`), seul
 * endroit où le médecin dispose de l'identifiant du patient (via son partage).
 */
function ReferralsInner() {
  const { t } = useLocale();
  const params = useSearchParams();
  const patientId = params.get('patientId');

  const [tick, setTick] = useState(0);
  const [reason, setReason] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<DoctorListItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState(false);
  const [toCancel, setToCancel] = useState<Referral | null>(null);

  const { data, loading, error } = useApi<Referral[]>(() => referralsApi.list(), [tick]);
  // L'annuaire n'est interrogé qu'une fois une recherche saisie : inutile de
  // charger toute la liste des confrères sur un réseau 2G.
  const { data: doctors } = useApi<{ data: DoctorListItem[] }>(
    () => (query.trim().length >= 2 ? professionalsApi.list({ q: query.trim() }) : Promise.resolve({ data: [], total: 0 })),
    [query],
  );

  const list = data ?? [];
  const received = list.filter((r) => r.direction === 'RECEIVED');
  const sent = list.filter((r) => r.direction === 'SENT');

  async function create() {
    if (!patientId || !picked || reason.trim().length < 3) return;
    setBusy('create');
    setFormError(false);
    try {
      await referralsApi.create({ toDoctorId: picked.id, patientId, reason: reason.trim() });
      setReason('');
      setPicked(null);
      setQuery('');
      setTick((n) => n + 1);
    } catch {
      setFormError(true);
    } finally {
      setBusy(null);
    }
  }

  async function respond(id: string, action: ReferralAction) {
    setBusy(id);
    try {
      await referralsApi.respond(id, action);
      setTick((n) => n + 1);
    } catch {
      setFormError(true);
    } finally {
      setBusy(null);
      setToCancel(null);
    }
  }

  function card(r: Referral) {
    const isReceived = r.direction === 'RECEIVED';
    const other = isReceived
      ? `${r.fromDoctorName} · ${r.fromSpeciality}`
      : `${r.toDoctorName} · ${r.toSpeciality}`;

    return (
      <CardPagne key={r.id} className="p-4 flex gap-3">
        <span className={`w-1.5 self-stretch rounded-full ${BAR[r.status]}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-display font-extrabold text-[0.875rem] text-stone-800 truncate">{r.patientName}</p>
              <p className="text-[0.8125rem] text-stone-500 truncate">
                {t(isReceived ? 'referrals.from' : 'referrals.to')} {other}
              </p>
            </div>
            <Badge variant={r.status === 'PENDING' ? 'eleve' : 'indigo'}>{t(`referrals.status.${r.status}`)}</Badge>
          </div>

          <p className="mt-2 text-[0.8125rem] text-stone-700 whitespace-pre-line">{r.reason}</p>
          <p className="mt-1 text-[0.75rem] text-stone-400">{formatDate(r.createdAt, { dateStyle: 'medium' })}</p>

          {/* Seul le destinataire agit (l'API refuse l'expéditeur en 403). */}
          {isReceived && (r.status === 'PENDING' || r.status === 'ACCEPTED') && (
            <div className="mt-3 flex flex-wrap gap-2">
              {r.status === 'PENDING' && (
                <Button variant="indigo" className="text-[0.75rem] px-3 py-1.5" disabled={busy === r.id} onClick={() => respond(r.id, 'ACCEPT')}>
                  {t('referrals.accept')}
                </Button>
              )}
              {r.status === 'ACCEPTED' && (
                <Button variant="sante" className="text-[0.75rem] px-3 py-1.5" disabled={busy === r.id} onClick={() => respond(r.id, 'COMPLETE')}>
                  {t('referrals.complete')}
                </Button>
              )}
              <Button variant="outline" className="text-[0.75rem] px-3 py-1.5" disabled={busy === r.id} onClick={() => setToCancel(r)}>
                {t('referrals.cancel')}
              </Button>
            </div>
          )}
        </div>
      </CardPagne>
    );
  }

  return (
    <>
      <ProHeader title={t('referrals.title')} subtitle={t('referrals.sub')} wide />
      <main className="px-6 -mt-10 relative z-20 space-y-5 pb-6 lg:max-w-5xl lg:mx-auto">
        {/* ── Nouvelle orientation (seulement avec un patient en contexte) ── */}
        {patientId ? (
          <CardPagne stitch="indigo" className="p-4">
            <p className="font-display font-extrabold text-[0.875rem] text-stone-800">{t('referrals.new')}</p>
            <p className="text-[0.75rem] text-stone-400 mt-0.5">{t('referrals.no_dmp_note')}</p>
            <Nkyinkyim className="my-3" />

            <label htmlFor="ref-doctor" className="block font-display font-bold text-[0.8125rem] text-stone-700">
              {t('referrals.pick_doctor')}
            </label>
            <input
              id="ref-doctor"
              value={picked ? `${picked.profile?.firstName ?? ''} ${picked.profile?.lastName ?? ''}`.trim() : query}
              onChange={(e) => {
                setPicked(null);
                setQuery(e.target.value);
              }}
              placeholder={t('referrals.search_doctor')}
              className="mt-1 w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-base pagne-focus focus:outline-none focus:border-indigo-600"
            />

            {!picked && (doctors?.data.length ?? 0) > 0 && (
              <ul className="mt-2 space-y-1">
                {(doctors?.data ?? []).map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => setPicked(d)}
                      className="w-full text-left bg-white card-pagne border border-stone-200 px-3 py-2 text-[0.8125rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600"
                    >
                      <span className="font-display font-bold text-stone-800">
                        {d.profile?.firstName} {d.profile?.lastName}
                      </span>
                      <span className="text-stone-500"> · {d.speciality}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <label htmlFor="ref-reason" className="mt-3 block font-display font-bold text-[0.8125rem] text-stone-700">
              {t('referrals.reason')}
            </label>
            <textarea
              id="ref-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('referrals.reason_placeholder')}
              rows={3}
              className="mt-1 w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-base pagne-focus focus:outline-none focus:border-indigo-600"
            />

            <Button
              variant="indigo"
              full
              className="mt-3"
              disabled={busy === 'create' || !picked || reason.trim().length < 3}
              onClick={create}
            >
              {t('referrals.send')}
            </Button>
            {formError && <p className="text-sos-600 font-bold text-[0.75rem] mt-2">{t('auth.error')}</p>}
          </CardPagne>
        ) : (
          <CardPagne className="p-4">
            <p className="font-display font-extrabold text-[0.8125rem] text-stone-700">{t('referrals.new')}</p>
            <p className="text-[0.8125rem] text-stone-500 mt-1">{t('referrals.need_patient')}</p>
          </CardPagne>
        )}

        {loading && <SkeletonCards label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}

        {!loading && !error && (
          <>
            <h2 className="font-display font-extrabold text-[0.875rem] text-stone-700">{t('referrals.received')}</h2>
            {received.length === 0 ? <Empty label={t('referrals.empty_received')} /> : <div className="space-y-3">{received.map(card)}</div>}

            <h2 className="font-display font-extrabold text-[0.875rem] text-stone-700">{t('referrals.sent')}</h2>
            {sent.length === 0 ? <Empty label={t('referrals.empty_sent')} /> : <div className="space-y-3">{sent.map(card)}</div>}
          </>
        )}
      </main>

      <ConfirmDialog
        open={toCancel !== null}
        danger
        title={t('referrals.cancel_title')}
        message={t('referrals.cancel_desc')}
        confirmLabel={t('referrals.cancel')}
        busy={busy === toCancel?.id}
        onConfirm={() => toCancel && respond(toCancel.id, 'CANCEL')}
        onCancel={() => setToCancel(null)}
      />
    </>
  );
}

export default function ReferralsPage() {
  return (
    <Suspense fallback={null}>
      <ReferralsInner />
    </Suspense>
  );
}
