'use client';

import { useState } from 'react';

import { Badge, Button, CardPagne, Nkyinkyim } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { Empty, ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { adminKycApi, type KycDetail, type KycQueueItem } from '@/lib/api/adminKyc';
import { useApi } from '@/lib/api/useApi';

// D-25b — Admin : file KYC enrichie (pièces justificatives + checklist + décision).
export default function AdminKycPage() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  const queue = useApi(() => adminKycApi.queue(), [tick]);
  const items: KycQueueItem[] = queue.data?.data ?? [];

  return (
    <>
      <SpaceHeader title={t('adminkyc.title')} subtitle={t('adminkyc.sub')} headerClass="bg-indigo-950" profileHref="/admin/profile" />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6">
        {selected ? (
          <KycDetailPanel
            id={selected}
            onBack={() => setSelected(null)}
            onDone={() => {
              setSelected(null);
              setTick((n) => n + 1);
            }}
          />
        ) : (
          <>
            {queue.loading && <Loading label={t('common.loading')} />}
            {queue.error && <ErrorState label={t('auth.error')} />}
            {!queue.loading && items.length === 0 && <Empty label={t('adminkyc.empty')} />}
            {items.map((k) => (
              <CardPagne key={k.id} className="p-4 flex items-center justify-between gap-2">
                <div>
                  <p className="font-display font-bold text-[14px]">
                    {k.user.profile ? `${k.user.profile.firstName} ${k.user.profile.lastName}` : k.user.phone}
                  </p>
                  <p className="text-[12px] text-stone-400">{k.user.role}</p>
                </div>
                <Button variant="indigo" className="text-[12px] px-3 py-1.5" onClick={() => setSelected(k.id)}>
                  {t('adminkyc.review')}
                </Button>
              </CardPagne>
            ))}
          </>
        )}
      </main>
    </>
  );
}

function KycDetailPanel({ id, onBack, onDone }: { id: string; onBack: () => void; onDone: () => void }) {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data, loading, error } = useApi<KycDetail>(() => adminKycApi.detail(id), [id, tick]);

  async function toggleDoc(docId: string, verified: boolean) {
    setActionError(null);
    try {
      await adminKycApi.verifyDocument(docId, verified);
      setTick((n) => n + 1);
    } catch {
      setActionError(t('auth.error'));
    }
  }

  async function decide(decision: 'APPROVED' | 'REJECTED' | 'NEEDS_REVISION') {
    setBusy(true);
    setActionError(null);
    try {
      await adminKycApi.review(id, { decision, notes: notes.trim() || undefined });
      onDone();
    } catch {
      setActionError(t('auth.error'));
    } finally {
      setBusy(false);
    }
  }

  const allVerified = (data?.documents.length ?? 0) > 0 && (data?.documents ?? []).every((d) => d.verified);

  return (
    <>
      <button type="button" onClick={onBack} className="text-[13px] text-indigo-700 font-display font-bold">
        ← {t('common.back')}
      </button>

      {loading && <Loading label={t('common.loading')} />}
      {error && <ErrorState label={t('auth.error')} />}

      {data && (
        <>
          <CardPagne stitch="indigo" className="p-4">
            <p className="font-display font-extrabold text-[15px] text-stone-800">
              {data.user.profile ? `${data.user.profile.firstName} ${data.user.profile.lastName}` : data.user.phone}
            </p>
            <p className="text-[12px] text-stone-400">{data.user.role} · {data.user.phone}</p>
            {data.user.doctor && (
              <p className="text-[12px] mt-1">
                {t('adminkyc.license')} : <span className="font-mono">{data.user.doctor.licenseNumber}</span>{' '}
                <Badge variant={data.cnom?.verified ? 'normal' : 'pro'}>
                  {data.cnom?.verified ? t('adminkyc.cnom_ok') : t('adminkyc.cnom_ko')}
                </Badge>
              </p>
            )}
          </CardPagne>

          {/* Pièces justificatives + checklist de vérification */}
          <CardPagne className="p-4">
            <p className="font-display font-extrabold text-[13px] text-stone-700">{t('adminkyc.documents')}</p>
            <Nkyinkyim className="my-3" />
            <div className="space-y-2">
              {data.documents.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-2">
                  <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="text-[13px] text-indigo-700 underline decoration-dotted underline-offset-4 truncate">
                    {t(`kycdoc.${d.type}`)}
                  </a>
                  <button
                    type="button"
                    onClick={() => toggleDoc(d.id, !d.verified)}
                    className={`shrink-0 card-pagne px-2.5 py-1 text-[11px] font-display font-bold border ${d.verified ? 'bg-terre-500 text-white border-stone-900' : 'bg-white text-stone-500 border-stone-300'}`}
                  >
                    {d.verified ? `✓ ${t('adminkyc.verified')}` : t('adminkyc.to_verify')}
                  </button>
                </div>
              ))}
              {data.documents.length === 0 && <p className="text-[13px] text-stone-400">{t('adminkyc.no_docs')}</p>}
            </div>
          </CardPagne>

          {/* Décision */}
          <CardPagne className="p-4">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('adminkyc.notes')}
              rows={2}
              className="w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-[14px] focus:outline-none focus:border-indigo-600"
            />
            {!allVerified && <p className="text-[12px] text-ocre-600 mt-1">⚠ {t('adminkyc.warn_unverified')}</p>}
            {actionError && <p className="text-[12px] text-sos-600 font-bold mt-1">{actionError}</p>}
            <div className="grid grid-cols-3 gap-2 mt-3">
              <Button variant="terre" className="text-[12px] px-2 py-2" onClick={() => decide('APPROVED')} disabled={busy}>
                {t('admin.approve')}
              </Button>
              <Button variant="ocre" className="text-[12px] px-2 py-2" onClick={() => decide('NEEDS_REVISION')} disabled={busy}>
                {t('adminkyc.revision')}
              </Button>
              <Button variant="sos" className="text-[12px] px-2 py-2" onClick={() => decide('REJECTED')} disabled={busy}>
                {t('admin.reject')}
              </Button>
            </div>
          </CardPagne>
        </>
      )}
    </>
  );
}
