'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/auth/AuthProvider';
import { Button, CardPagne, ConfirmDialog } from '@/components/ui';
import { useLocale } from '@/i18n/LocaleProvider';
import { flushQueue } from '@/lib/api/client';
import { legacyCount, legacyPresent, migrateLegacy, purgeUnownedLegacy } from '@/lib/offline/queue';
import { useVault } from '@/lib/offline/useVault';
import { createVault, hasVault, lockVault, purgeLocal, unlockVault, vaultSupport } from '@/lib/offline/vault';

export function VaultControls({ accent = 'sante' }: { accent?: 'sante' | 'indigo' | 'ocre' }) {
  const { user } = useAuth(); const { t } = useLocale(); const { open, tick } = useVault();
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported(vaultSupport()), []);
  const [exists, setExists] = useState(false); const [legacy, setLegacy] = useState(0);
  const [legacyDevice, setLegacyDevice] = useState(false);
  const [phrase, setPhrase] = useState(''); const [confirmation, setConfirmation] = useState('');
  const [consent, setConsent] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  const [discard, setDiscard] = useState<'all' | 'unowned' | null>(null);
  useEffect(() => {
    let active = true; setPhrase(''); setConfirmation(''); setExists(false); setLegacy(0);
    Promise.all([hasVault(), legacyCount(), legacyPresent()]).then(([value, count, present]) => { if (active) { setExists(value); setLegacy(count); setLegacyDevice(present); } }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [user?.id, tick]);
  async function unlock() {
    setBusy(true); setError(false);
    try {
      if (exists) await unlockVault(phrase); else await createVault(phrase);
      await migrateLegacy(); if (navigator.onLine) await flushQueue();
    } catch { setError(true); } finally { setPhrase(''); setConfirmation(''); setBusy(false); }
  }
  async function discardConfirmed() {
    setBusy(true); setError(false);
    try { if (discard === 'all') await purgeLocal(); else await purgeUnownedLegacy(); setDiscard(null); }
    catch { setError(true); } finally { setBusy(false); }
  }
  return <CardPagne className="p-4 space-y-3">
    <h2 className="font-display font-extrabold text-stone-800">{t('vault.title')}</h2>
    <p className="text-[0.8125rem] text-stone-600">{t('vault.policy')}</p>
    <p className="text-[0.8125rem] font-bold" role="status">{t(open ? 'vault.open' : exists ? 'vault.locked' : 'vault.disabled')}</p>
    {!supported && <p role="alert" className="text-sos-600">{t('vault.unsupported')}</p>}
    {legacy > 0 && <p role="alert" className="text-[0.8125rem] text-sos-700">{t('vault.legacy', { n: legacy })}</p>}
    {legacyDevice && <p role="alert" className="text-[0.8125rem] text-sos-700">{t('vault.legacy_device')}</p>}
    {!open && supported && <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void unlock(); }}>
      {!exists && <label className="flex gap-2 text-[0.8125rem]"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />{t('vault.optin')}</label>}
      <label className="block font-display font-bold text-[0.8125rem]">{t('vault.phrase')}
        <input type="password" autoComplete="off" maxLength={256} value={phrase} onChange={(e) => setPhrase(e.target.value)} className="mt-1 block w-full card-pagne border border-stone-300 bg-white p-3 text-base pagne-focus" />
      </label>
      {!exists && <label className="block font-display font-bold text-[0.8125rem]">{t('vault.confirm')}
        <input type="password" autoComplete="off" maxLength={256} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="mt-1 block w-full card-pagne border border-stone-300 bg-white p-3 text-base pagne-focus" />
      </label>}
      <p className="text-[0.75rem] text-stone-600">{t('vault.phrase_hint')}</p>
      <Button type="submit" variant={accent} disabled={busy || !phrase || (!exists && (!consent || phrase.trim().length < 12 || phrase !== confirmation))}>{t(exists ? 'vault.unlock' : 'vault.enable')}</Button>
    </form>}
    {open && <Button variant="outline" onClick={() => lockVault()}>{t('vault.lock')}</Button>}
    {error && <p role="alert" className="text-sos-600 text-[0.8125rem]">{t('vault.error')}</p>}
    <p className="text-[0.75rem] text-stone-500">{t('vault.limits')}</p>
    <Button variant="outline" disabled={busy} onClick={() => setDiscard('all')}>{t('vault.erase')}</Button>
    {open && legacy > 0 && <Button variant="outline" disabled={busy} onClick={() => setDiscard('unowned')}>{t('vault.erase_unowned')}</Button>}
    <ConfirmDialog busy={busy} confirmLabel={t('vault.erase')} open={discard !== null} danger title={t('vault.erase')} message={t(discard === 'unowned' ? 'vault.erase_unowned_warning' : 'vault.erase_warning')} onConfirm={discardConfirmed} onCancel={() => setDiscard(null)} />
  </CardPagne>;
}
