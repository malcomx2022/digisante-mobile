'use client';

import { useRef, useState } from 'react';

import { Badge, Button, CardPagne } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { getBlob, postNow } from '@/lib/api/client';
import { laboratoryKycApi, type LabIdentity } from '@/lib/api/laboratoryKyc';
import { useApi } from '@/lib/api/useApi';
import { fileToBase64 } from '@/lib/file';

const TYPES = ['NATIONAL_ID', 'PRACTICE_LICENSE'] as const;
const MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export default function LaboratoryKycPage() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draft, setDraft] = useState<LabIdentity | null>(null);
  const [docType, setDocType] = useState<string>('NATIONAL_ID');
  const fileRef = useRef<HTMLInputElement>(null);
  const { data, loading, error } = useApi(async () => {
    const [profile, submission] = await Promise.all([laboratoryKycApi.profile(), laboratoryKycApi.submission()]);
    return { profile, submission };
  }, [tick]);
  const editable = Boolean(data?.submission && ['NOT_SUBMITTED', 'NEEDS_REVISION'].includes(data.submission.status));
  const identity = draft ?? (data ? { name: data.profile.name, address: data.profile.address, phone: data.profile.phone, licenseNumber: data.profile.licenseNumber ?? '' } : null);
  const documents = data?.submission?.documents ?? [];
  const complete = TYPES.every((type) => documents.some((d) => d.type === type));

  async function act(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try { await fn(); setTick((n) => n + 1); }
    catch { setActionError(t('auth.error')); }
    finally { setBusy(false); }
  }
  async function upload(file: File) {
    if (!MIMES.includes(file.type)) { setActionError(t('kyc.bad_format')); return; }
    if (file.size > 5 * 1024 * 1024) { setActionError(t('kyc.too_big')); return; }
    await act(async () => postNow('/kyc/documents', { type: docType, mimeType: file.type, fileName: file.name, dataBase64: await fileToBase64(file) }));
    if (fileRef.current) fileRef.current.value = '';
  }
  async function view(id: string) {
    await act(async () => {
      const url = URL.createObjectURL(await getBlob(`/kyc/documents/${id}/file`));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
  }
  return <>
    <SpaceHeader title={t('labkyc.title')} subtitle={t('labkyc.required')} headerClass="bg-ocre-900" profileHref="/labo/profile" />
    <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto">
      {loading && <Loading label={t('common.loading')} />}
      {error && <ErrorState label={t('auth.error')} />}
      {actionError && <p role="alert" className="text-sos-600 text-sm font-bold">{actionError}</p>}
      {data && identity && <>
        <CardPagne className="p-4 space-y-3" stitch="terre">
          <Badge variant={data.profile.canProcess ? 'normal' : 'eleve'}>{t(`kyc.status.${data.profile.kycStatus}`)}</Badge>
          <p className="text-sm text-stone-600">{data.profile.canProcess ? t('labkyc.active') : t('labkyc.blocked')}</p>
          {data.submission?.reviews?.[0]?.notes && <p className="text-sm">{data.submission.reviews[0].notes}</p>}
          {(!data.submission || data.submission.status === 'REJECTED' || (data.submission.status === 'APPROVED' && !data.profile.canProcess)) &&
            <Button variant="ocre" full disabled={busy} onClick={() => act(laboratoryKycApi.open)}>{t('labkyc.open')}</Button>}
        </CardPagne>
        <CardPagne className="p-4 space-y-3">
          {(['name', 'address', 'phone', 'licenseNumber'] as const).map((key) => <label key={key} className="block text-sm font-bold">
            {t(`labkyc.${key}`)}
            <input value={identity[key]} disabled={!editable || busy} onChange={(e) => setDraft({ ...identity, [key]: e.target.value })}
              className="mt-1 w-full card-pagne border border-stone-300 bg-white px-3 py-3 text-base pagne-focus focus:outline-none focus:border-ocre-500" />
          </label>)}
          {editable && <Button variant="ocre" full disabled={busy} onClick={() => act(async () => { await laboratoryKycApi.save(identity); setDraft(null); })}>{t('labkyc.save')}</Button>}
        </CardPagne>
        <CardPagne className="p-4 space-y-3">
          <p className="text-sm font-bold">{t('labkyc.documents')}</p>
          {documents.map((doc) => <div key={doc.id} className="flex items-center justify-between gap-3 border-b border-dashed border-stone-200">
            <button type="button" disabled={busy} onClick={() => view(doc.id)} className="min-h-[44px] text-ocre-700 underline decoration-dotted">{t(`kyc.doc.${doc.type}`)}</button>
            <span className="text-sm">{doc.verified ? t('kyc.doc_verified') : t('kyc.doc_pending')}</span>
          </div>)}
          {editable && <>
            <select value={docType} onChange={(e) => setDocType(e.target.value)} aria-label={t('kyc.doc_type')} className="w-full card-pagne border border-stone-300 bg-white px-3 py-3 text-base">
              {TYPES.map((type) => <option key={type} value={type}>{t(`kyc.doc.${type}`)}</option>)}
            </select>
            <input ref={fileRef} type="file" accept={MIMES.join(',')} aria-label={t('pro.kyc_add_doc')} className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); }} />
            <Button variant="ocre" full disabled={busy} onClick={() => fileRef.current?.click()}>{t('pro.kyc_add_doc')}</Button>
            <p className="text-xs text-stone-500">{t('kyc.upload_hint')}</p>
          </>}
        </CardPagne>
        {editable && <Button variant="sante" full disabled={busy || !complete} onClick={() => act(async () => { await laboratoryKycApi.save(identity); setDraft(null); await laboratoryKycApi.submit(); })}>{t('pro.kyc_submit')}</Button>}
      </>}
    </main>
  </>;
}
