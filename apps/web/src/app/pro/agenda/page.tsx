'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { ProHeader } from '@/components/pro/ProHeader';
import { Button, CardPagne } from '@/components/ui';
import { Empty, ErrorState , SkeletonCards } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get, post } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';
import { formatDate, formatTime } from '@/i18n/format';

interface AgendaItem {
  id: string;
  type: string;
  status: string;
  scheduledAt: string;
  patient?: { user?: { profile?: { firstName: string; lastName: string } | null } | null };
  /** Salle déjà ouverte pour ce RDV (sinon `null`) → rejoindre au lieu de démarrer. */
  consultation?: { id: string; status: string } | null;
  /** Priorisation posée par le médecin (écart D5) — `null` tant qu'aucun tri. */
  triage?: { level: TriageLevel; note?: string } | null;
}

const TRIAGE_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
type TriageLevel = (typeof TRIAGE_LEVELS)[number];

// Le tri se lit d'un coup d'œil sur une file : une pastille par niveau.
const TRIAGE_CLS: Record<TriageLevel, string> = {
  LOW: 'bg-stone-100 text-stone-600',
  MEDIUM: 'bg-ocre-50 text-ocre-600',
  HIGH: 'bg-ocre-400 text-stone-900',
  URGENT: 'bg-sos-500 text-white',
};

// D-15 — Agenda (7 jours) + démarrage de la téléconsultation.
export default function AgendaPage() {
  const { t } = useLocale();
  const router = useRouter();
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  // Tri appliqué localement après un POST réussi : évite de recharger tout
  // l'agenda pour une pastille (réseaux lents).
  const [triaged, setTriaged] = useState<Record<string, TriageLevel>>({});
  const [triageOpen, setTriageOpen] = useState<string | null>(null);
  // Fenêtre 7 jours calculée à chaque montage (et non figée au chargement du
  // bundle) — sinon en PWA persistante l'agenda resterait bloqué sur le jour
  // d'ouverture de l'app.
  const { from, to } = useMemo(() => {
    const f = new Date();
    f.setHours(0, 0, 0, 0);
    const t2 = new Date(f);
    t2.setDate(t2.getDate() + 7);
    return { from: f.toISOString(), to: t2.toISOString() };
  }, []);
  const { data, loading, error } = useApi<AgendaItem[]>(
    () => get(`/appointments/agenda?from=${from}&to=${to}`),
    [from, to],
  );

  // Ouvre la salle Daily puis y entre. Le patient est notifié côté serveur —
  // sans quoi la salle s'ouvrirait dans le vide (il ne surveille pas son agenda).
  async function startConsultation(appointmentId: string) {
    if (startingId) return;
    setStartingId(appointmentId);
    setStartError(null);
    try {
      const res = await post<{ consultation: { id: string } }>('/consultations', { appointmentId });
      if ('queued' in res) {
        setStartError(t('teleconsult.needs_network'));
        return;
      }
      router.push(`/pro/teleconsult?id=${res.consultation.id}`);
    } catch {
      setStartError(t('teleconsult.start_error'));
    } finally {
      setStartingId(null);
    }
  }

  // Priorisation d'une demande (écart D5) : l'endpoint existait sans appelant.
  async function setTriage(appointmentId: string, level: TriageLevel) {
    setTriageOpen(null);
    const previous = triaged[appointmentId];
    setTriaged((s) => ({ ...s, [appointmentId]: level })); // optimiste
    try {
      await post(`/appointments/${appointmentId}/triage`, { level });
    } catch {
      // Rollback : ne pas laisser une pastille qui ment sur l'état serveur.
      setTriaged((s) => {
        const next = { ...s };
        if (previous) next[appointmentId] = previous;
        else delete next[appointmentId];
        return next;
      });
      setStartError(t('triage.error'));
    }
  }

  return (
    <>
      <ProHeader title={t('pro.agenda')} wide />
      <main className="px-6 -mt-10 relative z-20 space-y-3 pb-6 lg:max-w-5xl lg:mx-auto lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
        {loading && <SkeletonCards columns={false} label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && (data?.length ?? 0) === 0 && <Empty label={t('common.empty')} />}

        {(data ?? []).map((a) => {
          const p = a.patient?.user?.profile;
          // Salle ouvrable : téléconsultation confirmée, pas encore de consultation.
          const canStart = a.type === 'TELECONSULTATION' && a.status === 'CONFIRMED' && !a.consultation;
          // Salle déjà ouverte et toujours active → le médecin la rejoint.
          const canRejoin = a.consultation?.status === 'ACTIVE';
          const level = triaged[a.id] ?? a.triage?.level ?? null;
          return (
            <CardPagne key={a.id} className="p-4 flex items-center gap-3 flex-wrap">
              <div className="text-center w-14 shrink-0">
                <p className="font-display font-extrabold text-indigo-700 text-[0.9375rem]">{formatTime(a.scheduledAt, { hour: '2-digit', minute: '2-digit' })}</p>
                <p className="text-[0.625rem] text-stone-400">{formatDate(a.scheduledAt, { day: '2-digit', month: '2-digit' })}</p>
              </div>
              <span className={`w-1 self-stretch rounded-full ${a.status === 'CONFIRMED' ? 'bg-indigo-500' : 'bg-ocre-400'}`} />
              <div className="flex-1 min-w-0">
                <p className="font-display font-bold text-[0.875rem] truncate">{p ? `${p.firstName} ${p.lastName}` : t('role.PATIENT')}</p>
                <p className="text-[0.75rem] text-stone-400">{t(`appt.type.${a.type}`)} · {t(`appt.status.${a.status}`)}</p>
              </div>
              {(canStart || canRejoin) && (
                <Button
                  variant="indigo"
                  className="text-[0.6875rem] px-2.5 py-1.5 shrink-0"
                  disabled={startingId === a.id}
                  onClick={() =>
                    canRejoin
                      ? router.push(`/pro/teleconsult?id=${a.consultation!.id}`)
                      : void startConsultation(a.id)
                  }
                >
                  {canRejoin ? t('teleconsult.rejoin') : t('teleconsult.start')}
                </Button>
              )}

              {/* Priorisation (écart D5) : le niveau courant sert de bouton. */}
              <div className="w-full">
                <button
                  type="button"
                  onClick={() => setTriageOpen((id) => (id === a.id ? null : a.id))}
                  aria-expanded={triageOpen === a.id}
                  className={`card-pagne px-2 py-0.5 font-display font-extrabold text-[0.59375rem] focus-visible:ring-inset ${
                    level ? TRIAGE_CLS[level] : 'bg-white border border-dashed border-stone-300 text-stone-500'
                  }`}
                >
                  {level ? t(`triage.level.${level}`) : t('triage.set')}
                </button>
                {triageOpen === a.id && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {TRIAGE_LEVELS.map((l) => (
                      <button
                        key={l}
                        type="button"
                        onClick={() => void setTriage(a.id, l)}
                        className={`card-pagne px-2 py-0.5 font-display font-extrabold text-[0.59375rem] focus-visible:ring-inset ${TRIAGE_CLS[l]}`}
                      >
                        {t(`triage.level.${l}`)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </CardPagne>
          );
        })}
        {startError && (
          <p className="text-[0.75rem] text-sos-500 font-bold lg:col-span-2" role="alert">
            {startError}
          </p>
        )}
      </main>
    </>
  );
}
