'use client';

import { useState } from 'react';

import { ProHeader } from '@/components/pro/ProHeader';
import { Badge, Button, CardPagne } from '@/components/ui';
import { ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { ApiRequestError, get, post } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';

interface Submission {
  id: string;
  status: string;
  documents: { id: string; type: string; verified: boolean }[];
}

const FILL: Record<string, string> = {
  NOT_SUBMITTED: 'w-1/4',
  UNDER_REVIEW: 'w-2/3',
  APPROVED: 'w-full',
  REJECTED: 'w-1/3',
  NEEDS_REVISION: 'w-1/2',
};

// D-19 — KYC professionnel (progression tissée).
export default function ProKycPage() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const { data, loading, error } = useApi<Submission>(async () => {
    try {
      return await get<Submission>('/kyc/me');
    } catch (e) {
      // Ne créer un dossier QUE si aucun n'existe (404) — surtout pas sur une
      // erreur réseau/serveur (5xx) qui créerait des dossiers fantômes / masquerait
      // l'incident. Toute autre erreur est propagée à l'état d'erreur de useApi.
      if (e instanceof ApiRequestError && e.status === 404) {
        return (await post<Submission>('/kyc')) as Submission;
      }
      throw e;
    }
  }, [tick]);

  async function addDoc() {
    // TODO: brancher le vrai upload de pièce (sélection de fichier + stockage) —
    // hors périmètre. Bouton désactivé pour ne PAS envoyer un faux fichier.
    if (busy) return;
  }
  async function submit() {
    if (busy) return; // anti-double-clic
    setBusy(true);
    try {
      await post('/kyc/submit');
      setTick((x) => x + 1);
    } catch {
      /* feedback : l'état est rafraîchi ; le statut reflètera l'échec côté serveur */
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ProHeader title={t('pro.kyc')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto">
        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && data && (
          <>
            <CardPagne className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="font-display font-extrabold text-[0.8125rem] text-stone-700">{t('pro.kyc_status')}</p>
                <Badge variant={data.status === 'APPROVED' ? 'normal' : 'eleve'}>{t(`kyc.status.${data.status}`)}</Badge>
              </div>
              {/* Progression tissée */}
              <div className="h-3 card-pagne bg-stone-200 overflow-hidden">
                <div className={`h-full fill-tisse-indigo ${FILL[data.status] ?? 'w-1/4'}`} />
              </div>
              <p className="text-[0.6875rem] text-stone-400 mt-2">{t('kyc.review_delay')}</p>
            </CardPagne>

            <CardPagne className="p-4 space-y-2">
              {data.documents.length === 0 ? (
                <p className="text-[0.8125rem] text-stone-400">{t('kyc.no_docs')}</p>
              ) : (
                data.documents.map((d) => (
                  <div key={d.id} className="flex items-center justify-between text-[0.8125rem] border-b border-dashed border-stone-200 py-1.5">
                    <span>{t(`kyc.doc.${d.type}`)}</span>
                    
                    <span aria-label={d.verified ? t('kyc.doc_verified') : t('kyc.doc_pending')}>
                      <span aria-hidden="true">{d.verified ? '✓' : '⏳'}</span>
                    </span>
                  </div>
                ))
              )}
              {/* TODO: upload réel d'une pièce (hors périmètre) — bouton désactivé
                  plutôt que d'envoyer une URL factice. */}
              <Button variant="outline" className="w-full mt-2 text-[0.8125rem]" onClick={addDoc} disabled title={t('kyc.upload_soon')}>
                {t('pro.kyc_add_doc')}
              </Button>
              <p className="text-[0.6875rem] text-stone-400">{t('pro.kyc_upload_soon')}</p>
            </CardPagne>

            <Button variant="indigo" full onClick={submit} disabled={busy || data.documents.length === 0 || data.status === 'UNDER_REVIEW' || data.status === 'APPROVED'}>
              {t('pro.kyc_submit')}
            </Button>
          </>
        )}
      </main>
    </>
  );
}
