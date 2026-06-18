'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge, Button, CardPagne, Nkyinkyim } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { Empty, ErrorState, SkeletonCards } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { labApi, type AvailableOrder, type IncomingOrder } from '@/lib/api/laboratory';
import { useApi } from '@/lib/api/useApi';

const STATUS_VARIANT: Record<string, 'eleve' | 'indigo' | 'normal'> = {
  SAMPLE_COLLECTED: 'eleve',
  PROCESSING: 'indigo',
  COMPLETED: 'normal',
};

// D-24 — Laboratoire : file des demandes (pool disponible + prises en charge).
export default function LabOrdersPage() {
  const { t } = useLocale();
  const router = useRouter();
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const available = useApi<AvailableOrder[]>(() => labApi.available(), [tick]);
  const incoming = useApi<IncomingOrder[]>(() => labApi.incoming(), [tick]);

  async function claim(id: string) {
    setBusy(id);
    setActionError(null);
    try {
      await labApi.claim(id);
      setTick((n) => n + 1);
    } catch (e) {
      // Échec courant : commande déjà prise par un autre labo (403), réseau, hors-ligne.
      setActionError(e instanceof Error ? e.message : t('auth.error'));
    } finally {
      setBusy(null);
    }
  }

  async function advance(id: string) {
    setBusy(id);
    setActionError(null);
    try {
      await labApi.advance(id);
      setTick((n) => n + 1);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('auth.error'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <SpaceHeader title={t('labo.orders_title')} subtitle={t('labo.orders_sub')} headerClass="bg-ocre-900" profileHref="/labo/profile" wide />
      <main className="px-6 -mt-10 relative z-20 space-y-5 pb-6 lg:max-w-5xl lg:mx-auto">
        <Link href="/labo" className="inline-block text-[0.8125rem] text-ocre-700 font-display font-bold"><span aria-hidden="true">←</span> {t('labo.title')}</Link>

        {actionError && (
          <p className="bg-sos-100 text-sos-700 card-pagne px-3 py-2 text-[0.8125rem] font-bold">{actionError}</p>
        )}

        {/* Demandes prises en charge */}
        <section className="space-y-3">
          <h2 className="font-display font-extrabold text-[0.9375rem] text-stone-800">{t('labo.in_progress')}</h2>
          {incoming.loading && <SkeletonCards label={t('common.loading')} count={3} />}
          {incoming.error && <ErrorState label={t('auth.error')} />}
          {!incoming.loading && !incoming.error && (incoming.data?.length ?? 0) === 0 && <Empty label={t('labo.no_incoming')} />}
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 items-start">
          {(incoming.data ?? []).map((o) => (
            <CardPagne key={o.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display font-extrabold text-[0.875rem] text-stone-800">{o.testType}</p>
                  <p className="text-[0.8125rem] text-stone-500">{o.patient ? `${o.patient.firstName} ${o.patient.lastName}` : '—'}</p>
                </div>
                <Badge variant={STATUS_VARIANT[o.status] ?? 'eleve'}>{t(`labo.status.${o.status}`)}</Badge>
              </div>
              <Nkyinkyim className="my-3" />
              <div className="flex gap-2">
                {o.status === 'SAMPLE_COLLECTED' && (
                  <Button variant="outline" className="text-[0.8125rem] px-3 py-2" onClick={() => advance(o.id)} disabled={busy === o.id}>
                    {t('labo.to_processing')}
                  </Button>
                )}
                {!o.hasResult && (
                  <Button variant="sos" className="text-[0.8125rem] px-3 py-2" onClick={() => router.push(`/labo?order=${o.id}`)}>
                    {t('labo.enter_result')}
                  </Button>
                )}
                {o.hasResult && <span className="text-sante-700 font-display font-bold text-[0.8125rem] self-center"><span aria-hidden="true">✓</span> {t('labo.status.COMPLETED')}</span>}
              </div>
            </CardPagne>
          ))}
          </div>
        </section>

        {/* Pool des demandes disponibles (anonymisé) */}
        <section className="space-y-3">
          <h2 className="font-display font-extrabold text-[0.9375rem] text-stone-800">{t('labo.available')}</h2>
          <p className="text-[0.75rem] text-stone-400">{t('labo.available_hint')}</p>
          {available.loading && <SkeletonCards label={t('common.loading')} count={3} />}
          {available.error && <ErrorState label={t('auth.error')} />}
          {!available.loading && !available.error && (available.data?.length ?? 0) === 0 && <Empty label={t('labo.no_available')} />}
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 items-start">
          {(available.data ?? []).map((o) => (
            <CardPagne key={o.id} className="p-4 flex items-center justify-between gap-2">
              <div>
                <p className="font-display font-extrabold text-[0.875rem] text-stone-800">{o.testType}</p>
                <p className="text-[0.75rem] text-stone-400">{new Date(o.createdAt).toLocaleDateString('fr-FR', { dateStyle: 'medium' })}</p>
              </div>
              <Button variant="ocre" className="text-[0.8125rem] px-3 py-2" onClick={() => claim(o.id)} disabled={busy === o.id}>
                {t('labo.claim')}
              </Button>
            </CardPagne>
          ))}
          </div>
        </section>
      </main>
    </>
  );
}
