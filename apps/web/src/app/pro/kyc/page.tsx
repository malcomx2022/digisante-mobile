'use client';

import { useState } from 'react';

import { ProHeader } from '@/components/pro/ProHeader';
import { Badge, Button, CardPagne } from '@/components/ui';
import { Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get, post } from '@/lib/api/client';
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
  const { data, loading } = useApi<Submission>(async () => {
    try {
      return await get<Submission>('/kyc/me');
    } catch {
      return (await post<Submission>('/kyc')) as Submission;
    }
  }, [tick]);

  async function addDoc() {
    await post('/kyc/documents', { type: 'MEDICAL_DEGREE', fileUrl: 'https://files.example.bj/diplome.pdf' }).catch(() => {});
    setTick((x) => x + 1);
  }
  async function submit() {
    await post('/kyc/submit').catch(() => {});
    setTick((x) => x + 1);
  }

  return (
    <>
      <ProHeader title={t('pro.kyc')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6">
        {loading && <Loading label={t('common.loading')} />}
        {data && (
          <>
            <CardPagne className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="font-display font-extrabold text-[13px] text-stone-700">{t('pro.kyc_status')}</p>
                <Badge variant={data.status === 'APPROVED' ? 'normal' : 'eleve'}>{data.status}</Badge>
              </div>
              {/* Progression tissée */}
              <div className="h-3 card-pagne bg-stone-200 overflow-hidden">
                <div className={`h-full fill-tisse-indigo ${FILL[data.status] ?? 'w-1/4'}`} />
              </div>
              <p className="text-[11px] text-stone-400 mt-2">Délai de revue : 48h ouvrées.</p>
            </CardPagne>

            <CardPagne className="p-4 space-y-2">
              {data.documents.length === 0 ? (
                <p className="text-[13px] text-stone-400">Aucune pièce</p>
              ) : (
                data.documents.map((d) => (
                  <div key={d.id} className="flex items-center justify-between text-[13px] border-b border-dashed border-stone-200 py-1.5">
                    <span>{d.type}</span>
                    <span>{d.verified ? '✓' : '⏳'}</span>
                  </div>
                ))
              )}
              <Button variant="outline" className="w-full mt-2 text-[13px]" onClick={addDoc}>
                {t('pro.kyc_add_doc')}
              </Button>
            </CardPagne>

            <Button variant="indigo" full onClick={submit} disabled={data.documents.length === 0 || data.status === 'UNDER_REVIEW' || data.status === 'APPROVED'}>
              {t('pro.kyc_submit')}
            </Button>
          </>
        )}
      </main>
    </>
  );
}
