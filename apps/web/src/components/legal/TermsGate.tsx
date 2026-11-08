'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { TERMS_VERSION } from '@digisante/shared';

import { Button, CardPagne } from '@/components/ui';
import { LegalLinks } from '@/components/legal/LegalDocument';
import { useAuth } from '@/auth/AuthProvider';
import { useLocale } from '@/i18n/LocaleProvider';
import { postNow } from '@/lib/api/client';
import { isOnline } from '@/lib/offline/online';

// Écrans vitaux jamais bloqués par la ré-acceptation (urgence, hors-ligne compris).
const NEVER_BLOCK = ['/patient/sos', '/patient/emergency', '/patient/triage'];

/**
 * Consentement versionné (APDP) : un compte qui n'a pas accepté la version
 * COURANTE des CGU la voit avant tout autre écran. Jamais bloquant hors-ligne
 * (acceptation impossible sans réseau) ni sur les écrans d'urgence.
 */
export function TermsGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { t } = useLocale();
  const pathname = usePathname() ?? '';
  const [acceptedFor, setAcceptedFor] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  // Le serveur renvoie toujours `termsVersion` (null = jamais acceptée). Un objet
  // sans ce champ (ancien cache hors-ligne) est « inconnu » : pas de blocage, la
  // reprise de session en ligne le remplace. Les comptes admin (personnel) relèvent
  // de règles internes, pas des CGU utilisateurs.
  const outdated = !!user && user.role !== 'ADMIN' && 'termsVersion' in user && user.termsVersion !== TERMS_VERSION;
  if (!user || !outdated || acceptedFor === user.id || NEVER_BLOCK.some((p) => pathname.startsWith(p)) || !isOnline()) return <>{children}</>;

  async function accept() {
    if (!user || busy || !checked) return;
    setBusy(true);
    setError(false);
    try {
      await postNow('/users/me/terms', { version: TERMS_VERSION });
      setAcceptedFor(user.id);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh-screen bg-creme flex items-center justify-center px-6 py-10">
      <CardPagne stitch className="w-full max-w-md p-5 space-y-3">
        <p className="font-display font-extrabold text-[1rem] text-stone-800">{t('legal.gate_title')}</p>
        <p className="text-[0.8125rem] text-stone-600">{t('legal.gate_desc')}</p>
        <LegalLinks className="text-[0.8125rem] text-sante-700" />
        <label className="flex items-start gap-2 text-[0.8125rem] text-stone-700">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-1 h-5 w-5 accent-sante-600" />
          <span>{t('legal.accept_label')}</span>
        </label>
        {error && <p className="text-[0.75rem] text-sos-600 font-bold" role="alert">{t('auth.error')}</p>}
        <Button variant="sante" full disabled={!checked || busy} onClick={() => void accept()}>{t('legal.gate_accept')}</Button>
      </CardPagne>
    </div>
  );
}
