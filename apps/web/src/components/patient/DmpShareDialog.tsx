'use client';

import { useState } from 'react';

import { Button, CardPagne } from '@/components/ui';
import { useLocale } from '@/i18n/LocaleProvider';
import { del, post } from '@/lib/api/client';
import { cn } from '@/lib/cn';

type ShareType = 'QR_CODE' | 'LINK' | 'TEMPORARY_ACCESS';

interface ShareResult {
  shareToken: string;
  shareType: ShareType;
  expiresAt: string;
}

// Durées proposées (heures) — conformité §4 : consentement TOUJOURS borné dans le temps.
const TTL_OPTIONS: { hours: number; key: string }[] = [
  { hours: 24, key: 'dmp.ttl_24h' },
  { hours: 72, key: 'dmp.ttl_72h' },
  { hours: 168, key: 'dmp.ttl_7d' },
];

/** Dialogue de partage consenti d'une entrée du DMP (génération token + expiration, révocation). */
export function DmpShareDialog({
  recordId,
  recordTitle,
  patientId,
  onClose,
}: {
  recordId: string;
  recordTitle: string;
  /** Id du patient propriétaire — encodé dans le lien profond pour le soignant. */
  patientId?: string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const [shareType, setShareType] = useState<ShareType>('QR_CODE');
  const [ttlHours, setTtlHours] = useState<number>(72);
  const [result, setResult] = useState<ShareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);

  async function grant() {
    setLoading(true);
    setError(null);
    try {
      const res = await post<ShareResult>(`/dmp/records/${recordId}/share`, { shareType, ttlHours });
      if ('queued' in res) {
        setError(t('dmp.share_needs_network'));
        return;
      }
      setResult(res);
    } catch {
      setError(t('dmp.share_error'));
    } finally {
      setLoading(false);
    }
  }

  async function revoke() {
    setLoading(true);
    setError(null);
    try {
      const res = await del<{ revoked: boolean }>(`/dmp/records/${recordId}/share`);
      if ('queued' in res) {
        setError(t('dmp.share_needs_network'));
        return;
      }
      setRevoked(true);
      setResult(null);
    } catch {
      setError(t('dmp.share_error'));
    } finally {
      setLoading(false);
    }
  }

  // Lien de partage : lien profond vers la vue soignant (patientId + token).
  // Le médecin l'ouvre (scan QR ou collage) → la vue pro présente x-share-token.
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const shareLink =
    result && patientId
      ? `${origin}/pro/patient?patientId=${encodeURIComponent(patientId)}&token=${encodeURIComponent(result.shareToken)}`
      : result
        ? `${origin}/pro/patient?token=${encodeURIComponent(result.shareToken)}`
        : '';
  // QR sans dépendance : data-URI via service public (rendu gracieux si hors-ligne → token texte affiché).
  const qrSrc = result
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(shareLink)}`
    : '';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-nuit/60 px-4 py-6" role="dialog" aria-modal="true">
      <CardPagne stitch className="w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display font-extrabold text-[15px] text-stone-800">{t('dmp.share_title')}</p>
            <p className="text-[12px] text-stone-500">{recordTitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="text-stone-400 font-display font-extrabold text-lg leading-none px-2">
            ✕
          </button>
        </div>

        <div className="nkyinkyim w-full my-3 opacity-30" />

        {result ? (
          <div className="text-center">
            <p className="text-[12px] text-stone-500 mb-3">{t('dmp.share_ready')}</p>
            {qrSrc && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrSrc}
                alt={t('dmp.share_qr_alt')}
                width={180}
                height={180}
                className="mx-auto card-pagne border border-stone-200 bg-white p-2 rotate-1"
              />
            )}
            <div className="mt-3 bg-creme-deep card-pagne border border-dashed border-stone-300 p-2 break-all text-[11px] font-mono text-stone-600">
              {result.shareToken}
            </div>
            <p className="text-[12px] text-terre-600 font-bold mt-3">
              {t('dmp.share_expires', {
                date: new Date(result.expiresAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }),
              })}
            </p>
            {error && <p className="text-sos-600 font-bold text-[13px] mt-2">{error}</p>}
            <Button variant="sos" full className="mt-4" disabled={loading} onClick={revoke}>
              {loading ? t('common.loading') : t('dmp.revoke')}
            </Button>
          </div>
        ) : revoked ? (
          <div className="text-center py-4">
            <p className="font-display font-extrabold text-[15px] text-stone-800">{t('dmp.revoked_title')}</p>
            <p className="text-[12px] text-stone-500 mt-1">{t('dmp.revoked_desc')}</p>
            <Button variant="sante" full className="mt-4" onClick={onClose}>
              {t('common.close')}
            </Button>
          </div>
        ) : (
          <>
            <p className="font-display font-bold text-[12px] text-stone-600 mb-2">{t('dmp.share_method')}</p>
            <div className="grid grid-cols-3 gap-2">
              {(['QR_CODE', 'LINK', 'TEMPORARY_ACCESS'] as ShareType[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setShareType(s)}
                  className={cn(
                    'card-pagne py-2 font-display font-bold text-[11px] border',
                    shareType === s ? 'bg-sante-600 text-white border-sante-700' : 'bg-white text-stone-700 border-stone-200',
                  )}
                >
                  {s === 'QR_CODE' ? t('dmp.method_qr') : s === 'LINK' ? t('dmp.method_link') : t('dmp.method_temp')}
                </button>
              ))}
            </div>

            <p className="font-display font-bold text-[12px] text-stone-600 mt-4 mb-2">{t('dmp.share_duration')}</p>
            <div className="grid grid-cols-3 gap-2">
              {TTL_OPTIONS.map((o) => (
                <button
                  key={o.hours}
                  type="button"
                  onClick={() => setTtlHours(o.hours)}
                  className={cn(
                    'card-pagne py-2 font-display font-bold text-[12px] border',
                    ttlHours === o.hours ? 'bg-sante-600 text-white border-sante-700' : 'bg-white text-stone-700 border-stone-200',
                  )}
                >
                  {t(o.key)}
                </button>
              ))}
            </div>

            <p className="text-[11px] text-stone-400 mt-3">{t('dmp.share_consent_note')}</p>
            {error && <p className="text-sos-600 font-bold text-[13px] mt-2">{error}</p>}

            <Button variant="terre" full className="mt-4" disabled={loading} onClick={grant}>
              {loading ? t('booking.submitting') : t('dmp.grant')}
            </Button>
          </>
        )}
      </CardPagne>
    </div>
  );
}
