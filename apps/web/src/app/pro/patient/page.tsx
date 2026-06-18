'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { ProHeader } from '@/components/pro/ProHeader';
import { Badge, Button, CardPagne, Nkyinkyim } from '@/components/ui';
import { QrScanner } from '@/components/ui/QrScanner';
import { Empty, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { dmpApi, type DmpRecord } from '@/lib/api/dmp';
import { useApi } from '@/lib/api/useApi';

const BAR: Record<string, string> = {
  LAB_RESULT: 'bg-indigo-500',
  VACCINATION: 'bg-ocre-400',
  DIAGNOSIS: 'bg-indigo-400',
  VITAL_SIGNS: 'bg-indigo-300',
  ALLERGY: 'bg-sos-500',
};

// D-16 — Vue 360° patient (espace MÉDECIN PRO). L'accès au DMP passe par un
// partage consenti actif (CLAUDE.md §4) : le médecin présente le jeton du patient
// dans l'en-tête x-share-token. patientId + token sont fournis par le lien/QR de
// partage (/pro/patient?patientId=...&token=...). AUCUNE donnée codée en dur.
function Patient360Inner() {
  const { t } = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const patientId = params.get('patientId');

  const [token, setToken] = useState(params.get('token') ?? '');
  const [linkInput, setLinkInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const { data, loading, error, errorStatus } = useApi<DmpRecord[]>(
    () => (patientId && token ? dmpApi.recordsForPatient(patientId, token) : Promise.resolve([])),
    [patientId, token],
  );

  /** Traite un lien de partage (collé OU scanné) contenant patientId + token. */
  function handleSharePayload(raw: string) {
    setParseError(null);
    const value = raw.trim();
    if (!value) return;
    try {
      const url = new URL(value, window.location.origin);
      const pid = url.searchParams.get('patientId');
      const tok = url.searchParams.get('token');
      if (pid && tok) {
        router.push(`/pro/patient?patientId=${encodeURIComponent(pid)}&token=${encodeURIComponent(tok)}`);
        return;
      }
    } catch {
      /* lien non parsable → message ci-dessous */
    }
    setParseError(t('pro.invalid_link'));
  }

  // ── Aucun patient : invite à scanner/coller le lien de partage ──
  if (!patientId) {
    return (
      <>
        <ProHeader title={t('pro.patient360')} />
        <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto">
          <CardPagne stitch="indigo" className="p-5">
            <p className="font-display font-extrabold text-[0.9375rem] text-stone-800 text-center">{t('pro.no_patient_title')}</p>
            <p className="text-[0.8125rem] text-stone-500 mt-2 text-center">{t('pro.no_patient_desc')}</p>
            <Nkyinkyim className="my-4" />
            <Button variant="indigo" full onClick={() => setScanning(true)}>
              <span aria-hidden="true">📷</span> {t('pro.scan_share')}
            </Button>
            <p className="text-[0.75rem] text-stone-400 my-3 text-center">{t('scan.or_paste')}</p>
            <input
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              placeholder={t('pro.paste_link')}
              aria-label={t('pro.paste_link')}
              className="w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-[0.8125rem] focus:outline-none focus:border-indigo-600"
            />
            {parseError && <p className="text-sos-600 font-bold text-[0.75rem] mt-2">{parseError}</p>}
            <Button variant="indigo" full className="mt-3" onClick={() => handleSharePayload(linkInput)}>
              {t('pro.open_share')}
            </Button>
          </CardPagne>
          <ConsentNote />
        </main>
        {scanning && (
          <QrScanner
            title={t('pro.scan_share')}
            onResult={(v) => {
              setScanning(false);
              handleSharePayload(v);
            }}
            onClose={() => setScanning(false)}
          />
        )}
      </>
    );
  }

  // 403 → partage absent/expiré. Le statut HTTP (errorStatus) est désormais la
  // source PRIMAIRE (point 3, exposé par useApi via ApiRequestError.status). On
  // conserve le parsing du message en REPLI pour les cas où le statut ne remonte
  // pas (variantes API DMP : NO_CONSENT « partage consenti », NOT_OWNER « propre
  // dossier », FORBIDDEN « accès refusé/interdit »).
  const msg = error?.toLowerCase() ?? '';
  const isForbidden =
    errorStatus === 403 ||
    (errorStatus === undefined &&
      (msg.includes('consent') ||
        msg.includes('partage') ||
        msg.includes('propre dossier') ||
        msg.includes('accès limité') ||
        msg.includes('refusé') ||
        msg.includes('interdit') ||
        msg.includes('forbidden') ||
        msg.includes('403')));

  return (
    <>
      <ProHeader title={t('pro.patient360')} subtitle={patientId} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto">
        {/* La messagerie ne dépend pas du partage DMP : joignable dès qu'on a le patient. */}
        <div className="grid grid-cols-2 gap-2">
          <Link
            href={`/pro/messages?patient=${encodeURIComponent(patientId)}`}
            className="flex items-center justify-center gap-2 bg-indigo-600 text-white card-pagne px-4 py-2.5 font-display font-bold text-[0.875rem]"
          >
            <span aria-hidden>💬</span> {t('pro.message_patient')}
          </Link>
          {/* Pré-remplit le patient dans le formulaire d'ordonnance (point 6a). */}
          <Link
            href={`/pro/prescribe?patientId=${encodeURIComponent(patientId)}`}
            className="flex items-center justify-center gap-2 bg-white border border-indigo-600 text-indigo-700 card-pagne px-4 py-2.5 font-display font-bold text-[0.875rem]"
          >
            <span aria-hidden>℞</span> {t('pro.prescribe')}
          </Link>
        </div>

        {/* Partage requis (pas de jeton) OU refusé (jeton invalide/expiré) → saisie du jeton. */}
        {(!token || (!loading && error && isForbidden)) && (
          <CardPagne stitch="indigo" className="p-5">
            <p className="font-display font-extrabold text-[0.875rem] text-stone-800 text-center">
              {token ? t('pro.access_denied_title') : t('pro.need_token_title')}
            </p>
            <p className="text-[0.8125rem] text-stone-500 mt-2 text-center">
              {token ? t('pro.access_denied_desc') : t('pro.need_token_desc')}
            </p>
            <Nkyinkyim className="my-4" />
            <input
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={t('pro.paste_token')}
              aria-label={t('pro.paste_token')}
              className="w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-[0.8125rem] font-mono focus:outline-none focus:border-indigo-600"
            />
            <Button variant="indigo" full className="mt-3" onClick={() => tokenInput.trim() && setToken(tokenInput.trim())}>
              {t('pro.apply_token')}
            </Button>
          </CardPagne>
        )}

        {token && loading && <Loading label={t('common.loading')} />}

        {token && !loading && error && !isForbidden && (
          <CardPagne stitch="indigo" className="p-5 text-center">
            <p className="font-display font-extrabold text-[0.875rem] text-stone-800">{t('common.empty')}</p>
            <p className="text-[0.8125rem] text-stone-500 mt-2">{t('pro.load_error')}</p>
          </CardPagne>
        )}

        {token && !loading && !error && (data?.length ?? 0) === 0 && <Empty label={t('pro.empty_dmp')} />}

        {token && !loading && !error && (data?.length ?? 0) > 0 && (
          <CardPagne stitch="indigo" className="p-4">
            <p className="font-display font-extrabold text-[0.8125rem] text-stone-700">{t('pro.dmp_records')}</p>
            <Nkyinkyim className="my-3" />
            <div className="space-y-3">
              {(data ?? []).map((r) => (
                <div key={r.id} className="flex gap-3">
                  <span className={`w-1.5 rounded-full ${BAR[r.type] ?? 'bg-stone-300'}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-display font-bold text-[0.875rem] text-stone-800">{r.title}</p>
                      <Badge variant="indigo">{r.type}</Badge>
                    </div>
                    <p className="text-[0.75rem] text-stone-400">
                      {new Date(r.createdAt).toLocaleDateString('fr-FR', { dateStyle: 'medium' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardPagne>
        )}

        <ConsentNote />
      </main>
    </>
  );
}

function ConsentNote() {
  const { t } = useLocale();
  return (
    <CardPagne className="p-4">
      <p className="font-display font-extrabold text-[0.8125rem] text-stone-700">{t('pro.access_section')}</p>
      <p className="text-[0.75rem] text-stone-500 mt-1">{t('pro.access_note')}</p>
    </CardPagne>
  );
}

export default function Patient360Page() {
  return (
    <Suspense fallback={null}>
      <Patient360Inner />
    </Suspense>
  );
}
