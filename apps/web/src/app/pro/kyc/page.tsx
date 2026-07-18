'use client';

import { KYC_DOCUMENT_TYPES } from '@digisante/shared';
import { useRef, useState } from 'react';

import { ProHeader } from '@/components/pro/ProHeader';
import { Badge, Button, CardPagne } from '@/components/ui';
import { ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { ApiRequestError, get, getBlob, post } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';

interface Submission {
  id: string;
  status: string;
  documents: { id: string; type: string; verified: boolean; fileName?: string | null }[];
}

const FILL: Record<string, string> = {
  NOT_SUBMITTED: 'w-1/4',
  UNDER_REVIEW: 'w-2/3',
  APPROVED: 'w-full',
  REJECTED: 'w-1/3',
  NEEDS_REVISION: 'w-1/2',
};

// Upload réel (P1) : ≤ 5 Mo, image/PDF — chiffré côté serveur (§4).
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result); // data:<mime>;base64,<data>
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// D-19 — KYC professionnel (progression tissée + upload réel des pièces).
export default function ProKycPage() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [docType, setDocType] = useState<string>('NATIONAL_ID');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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

  // Le dossier n'est éditable qu'avant soumission (aligné sur le serveur).
  const editable = data ? ['NOT_SUBMITTED', 'NEEDS_REVISION'].includes(data.status) : false;

  async function upload(file: File) {
    if (busy) return;
    setUploadError(null);
    if (!ACCEPTED_MIMES.includes(file.type)) {
      setUploadError(t('kyc.bad_format'));
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setUploadError(t('kyc.too_big'));
      return;
    }
    setBusy(true);
    try {
      const dataBase64 = await fileToBase64(file);
      await post('/kyc/documents', { type: docType, mimeType: file.type, fileName: file.name, dataBase64 });
      setTick((x) => x + 1);
    } catch {
      setUploadError(t('auth.error'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // Aperçu de sa propre pièce (blob authentifié — jamais d'URL publique, §4).
  async function view(docId: string) {
    try {
      const blob = await getBlob(`/kyc/documents/${docId}/file`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setUploadError(t('auth.error'));
    }
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
                  <div key={d.id} className="flex items-center justify-between gap-2 text-[0.8125rem] border-b border-dashed border-stone-200 py-1.5">
                    <span className="min-w-0 truncate">{t(`kyc.doc.${d.type}`)}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => view(d.id)}
                        className="text-[0.75rem] text-indigo-700 font-display font-bold underline decoration-dotted underline-offset-4"
                      >
                        {t('kyc.view')}
                      </button>
                      <span aria-label={d.verified ? t('kyc.doc_verified') : t('kyc.doc_pending')}>
                        <span aria-hidden="true">{d.verified ? '✓' : '⏳'}</span>
                      </span>
                    </span>
                  </div>
                ))
              )}

              {editable && (
                <div className="pt-2 space-y-2">
                  <select
                    value={docType}
                    onChange={(e) => setDocType(e.target.value)}
                    aria-label={t('kyc.doc_type')}
                    className="w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-base pagne-focus focus:outline-none focus:border-indigo-600"
                  >
                    {KYC_DOCUMENT_TYPES.map((ty) => (
                      <option key={ty} value={ty}>{t(`kyc.doc.${ty}`)}</option>
                    ))}
                  </select>
                  <input
                    ref={fileRef}
                    type="file"
                    accept={ACCEPTED_MIMES.join(',')}
                    aria-label={t('pro.kyc_add_doc')}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void upload(f);
                    }}
                    className="hidden"
                  />
                  <Button variant="outline" className="w-full text-[0.8125rem]" onClick={() => fileRef.current?.click()} disabled={busy}>
                    {busy ? t('kyc.uploading') : `+ ${t('pro.kyc_add_doc')}`}
                  </Button>
                  <p className="text-[0.6875rem] text-stone-400">{t('kyc.upload_hint')}</p>
                </div>
              )}
              {uploadError && <p className="text-[0.75rem] text-sos-600 font-bold">{uploadError}</p>}
            </CardPagne>

            <Button variant="indigo" full onClick={submit} disabled={busy || data.documents.length === 0 || !editable}>
              {t('pro.kyc_submit')}
            </Button>
          </>
        )}
      </main>
    </>
  );
}
