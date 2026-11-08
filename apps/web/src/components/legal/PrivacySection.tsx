'use client';

import { useState } from 'react';

import { CardPagne, ConfirmDialog } from '@/components/ui';
import { LegalLinks } from '@/components/legal/LegalDocument';
import { useLocale } from '@/i18n/LocaleProvider';
import { get, postNow } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';

interface DeletionRequest {
  id?: string;
  status: 'PENDING' | 'COMPLETED' | 'REJECTED' | null;
  requestedAt?: string;
}

/**
 * « Mes données » (APDP) : liens vers les textes légaux et demande de
 * suppression du compte. La demande est traitée par l'équipe DigiSanté (aucune
 * destruction automatique) ; l'export FHIR reste dans l'espace dossier patient.
 */
export function PrivacySection() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const current = useApi<DeletionRequest>(() => get<DeletionRequest>('/users/me/deletion-request'), [tick]);
  const status = current.data?.status ?? null;

  async function request() {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await postNow('/users/me/deletion-request');
      setConfirm(false);
      setTick((n) => n + 1);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <CardPagne className="p-4 space-y-2">
      <p className="font-display font-extrabold text-[0.8125rem] text-stone-700">{t('privacy.title')}</p>
      <LegalLinks className="text-[0.75rem] text-stone-600" />
      {status === 'PENDING' && <p className="text-[0.75rem] font-bold text-ocre-600" role="status">{t('privacy.delete_pending')}</p>}
      {status === 'REJECTED' && <p className="text-[0.75rem] font-bold text-sos-600">{t('privacy.delete_rejected')}</p>}
      {status !== 'PENDING' && (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          className="pagne-focus text-[0.75rem] font-display font-bold text-sos-600 underline decoration-dotted underline-offset-4"
        >
          {t('privacy.delete_request')}
        </button>
      )}
      {error && <p className="text-[0.75rem] text-sos-600 font-bold" role="alert">{t('auth.error')}</p>}
      <ConfirmDialog
        open={confirm}
        title={t('privacy.delete_request')}
        message={t('privacy.delete_confirm')}
        confirmLabel={t('privacy.delete_request')}
        busy={busy}
        onConfirm={() => void request()}
        onCancel={() => setConfirm(false)}
      />
    </CardPagne>
  );
}
