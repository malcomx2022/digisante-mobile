'use client';

import { useState } from 'react';

import { ProHeader } from '@/components/pro/ProHeader';
import { Badge, Button, CardPagne } from '@/components/ui';
import { Empty, ErrorState, SkeletonCards } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { formatDateTime } from '@/i18n/format';
import { educationApi, type AdminContent, type ManageList } from '@/lib/api/education';
import { useApi } from '@/lib/api/useApi';

/**
 * Relecture médicale des contenus d'éducation à la santé (écart D3).
 *
 * Le pipeline éditorial admin s'arrêtait ici : l'admin soumettait un contenu,
 * `MEDICAL_REVIEW` s'affichait « en attente de relecture » et plus personne ne
 * pouvait avancer — l'endpoint existait, aucun écran ne l'appelait, et la liste
 * de gestion est réservée à l'admin.
 *
 * §4 : la validation d'un contenu MÉDICAL revient à un médecin VÉRIFIÉ, jamais à
 * l'admin. Le serveur le vérifie (403 sinon) ; un médecin non vérifié voit donc
 * ici l'état d'erreur, pas une file inutilisable.
 */
export default function ProEducationPage() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState(false);
  // Un contenu ne se relit pas sur son titre : le corps est déplié à la demande
  // (réseaux 2G — on ne charge pas 20 articles ouverts d'un coup).
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, loading, error } = useApi<ManageList>(() => educationApi.reviewQueue(), [tick]);
  const items: AdminContent[] = data?.data ?? [];

  async function review(id: string, approve: boolean) {
    if (busyId) return;
    setBusyId(id);
    setActionError(false);
    try {
      await educationApi.medicalReview(id, approve);
      setTick((n) => n + 1);
    } catch {
      setActionError(true);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <ProHeader title={t('edureview.title')} subtitle={t('edureview.subtitle')} wide />
      <main className="px-6 -mt-10 relative z-20 space-y-3 pb-6 lg:max-w-5xl lg:mx-auto">
        {actionError && <p className="text-sos-600 font-bold text-[0.75rem]" role="alert">{t('auth.error')}</p>}
        {loading && <SkeletonCards label={t('common.loading')} />}
        {error && <ErrorState label={t('edureview.error')} />}
        {!loading && !error && items.length === 0 && <Empty label={t('edureview.empty')} />}

        {items.map((c) => (
          <CardPagne key={c.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-display font-bold text-[0.875rem]">{c.title}</p>
                <p className="text-[0.6875rem] text-stone-400">
                  {c.category} · {formatDateTime(c.updatedAt, { dateStyle: 'short', timeStyle: 'short' })}
                </p>
              </div>
              <Badge variant="priorite">{t('edu.status_MEDICAL_REVIEW')}</Badge>
            </div>

            <button
              type="button"
              onClick={() => setOpenId((id) => (id === c.id ? null : c.id))}
              className="mt-2 text-indigo-700 underline decoration-dotted underline-offset-4 text-[0.75rem] font-bold focus-visible:ring-inset"
              aria-expanded={openId === c.id}
            >
              {openId === c.id ? t('edureview.hide') : t('edureview.read')}
            </button>

            {openId === c.id && (
              <p className="mt-2 text-[0.8125rem] text-stone-700 whitespace-pre-wrap">{c.body}</p>
            )}

            <div className="flex flex-wrap gap-2 mt-3">
              <Button
                variant="indigo"
                className="text-[0.6875rem] px-2.5 py-1"
                disabled={busyId === c.id}
                onClick={() => void review(c.id, true)}
              >
                {t('edureview.approve')}
              </Button>
              <Button
                variant="outline"
                className="text-[0.6875rem] px-2.5 py-1"
                disabled={busyId === c.id}
                onClick={() => void review(c.id, false)}
              >
                {t('edureview.reject')}
              </Button>
            </div>
          </CardPagne>
        ))}
      </main>
    </>
  );
}
