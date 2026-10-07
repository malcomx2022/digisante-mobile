'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/auth/AuthProvider';
import { SyncActions } from '@/components/offline/SyncActions';
import { VaultControls } from '@/components/offline/VaultControls';
import { PatientHeader } from '@/components/patient/PatientHeader';
import { Button, CardPagne } from '@/components/ui';
import { formatDate, formatDateTime } from '@/i18n/format';
import { useLocale } from '@/i18n/LocaleProvider';
import { get } from '@/lib/api/client';
import { dmpApi } from '@/lib/api/dmp';
import { usersApi } from '@/lib/api/users';
import { useOnline } from '@/lib/offline/online';
import { readSnapshot, saveSnapshot, snapshotStatus, type OfflineSnapshot } from '@/lib/offline/snapshot';
import { useVault } from '@/lib/offline/useVault';
import { currentOwner, notifyLocal } from '@/lib/offline/vault';



export default function OfflinePage() {
  const { user } = useAuth(); const { t } = useLocale(); const online = useOnline(); const { open, tick } = useVault();
  const [data, setData] = useState<OfflineSnapshot | null>(null);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof snapshotStatus>>>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  useEffect(() => {
    let active = true; setData(null); setStatus(null);
    (async () => {
      const metadata = await snapshotStatus();
      if (active) setStatus(metadata);
      if (open) { const snapshot = await readSnapshot(); if (active && user?.id === currentOwner()) setData(snapshot); }
    })().catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [user?.id, open, tick]);
  useEffect(() => {
    if (!status || status.expired) return;
    const deadline = status.stale ? status.expiresAt : Math.min(status.expiresAt, status.syncedAt + 6 * 60 * 60_000);
    const timer = setTimeout(notifyLocal, Math.max(1, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [status]);
  async function sync() {
    const owner = currentOwner(); setBusy(true); setError(false);
    try {
      const [records, prescriptions, emergency] = await Promise.all([dmpApi.myRecords(), get<OfflineSnapshot['prescriptions']>('/prescriptions'), usersApi.medical()]);
      if (owner !== currentOwner()) throw new Error('Session changée');
      await saveSnapshot({ records, prescriptions, emergency });
    } catch { setError(true); } finally { setBusy(false); }
  }

  return <div className="flex-1 wax-ocre">
    <PatientHeader title={t('offline.title')} />
    <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto lg:w-full">
      <div className="bg-ocre-400 trame-tissee card-pagne px-4 py-2 text-center font-display font-bold">{t(online ? 'offline.online' : 'offline.banner')}</div>
      <VaultControls />
      <CardPagne className="p-4 space-y-3">
        <h2 className="font-display font-extrabold">{t('vault.snapshot_title')}</h2>
        <p className="text-[0.8125rem] text-stone-600">{t('vault.snapshot_scope')}</p>
        <Button variant="sante" disabled={!online || !open || busy} onClick={sync}>{t('vault.sync')}</Button>
        {status ? <p role="status" className="text-[0.8125rem]">{t('vault.synced', { date: formatDateTime(new Date(status.syncedAt), { dateStyle: 'medium', timeStyle: 'short' }) })} · {t(status.expired ? 'vault.expired' : status.stale ? 'vault.stale' : 'vault.fresh')}</p> : <p>{t('vault.no_snapshot')}</p>}
        {data && open && !status?.expired && <div className="space-y-3" data-testid="offline-medical">
          <h3 className="font-display font-bold">{t('dmp.title')}</h3>
          {data.records.map((r) => <p key={r.id} className="text-[0.8125rem]">{r.title} · {formatDate(r.createdAt)}</p>)}
          <h3 className="font-display font-bold">{t('prescriptions.title')}</h3>
          <p className="text-[0.75rem] text-stone-600">{t('vault.prescription_notice')}</p>
          {data.prescriptions.map((p) => <div key={p.id} className="border-b border-dashed border-stone-200 pb-2">
            <p className="text-[0.75rem] font-bold">{t(`prescription.status.${new Date(p.validUntil).getTime() <= Date.now() && p.status !== 'CANCELLED' ? 'EXPIRED' : p.status}`)}</p>
            <p className="text-[0.75rem]">{t('prescriptions.valid_until', { date: formatDate(p.validUntil) })}</p>
            {p.items.map((i, n) => <p key={n} className="text-[0.8125rem]">{i.medicationName} · {i.dosage} · {i.frequency} · {i.duration}</p>)}
          </div>)}
          <h3 className="font-display font-bold">{t('emergency.title')}</h3>
          <p>{t('emergency.blood_group')}: {data.emergency.bloodGroup || '—'}</p>
          <p>{t('emergency.allergies')}: {data.emergency.allergies.join(', ') || t('emergency.none')}</p>
          <p>{t('emergency.chronic')}: {data.emergency.chronicDiseases.join(', ') || t('emergency.none')}</p>
          {data.emergency.emergencyContact && <p>{t('emergency.contact')}: {data.emergency.emergencyContact}</p>}
        </div>}
      </CardPagne>
      <SyncActions />
      {error && <p role="alert" className="text-sos-600">{t('vault.error')}</p>}
      <CardPagne className="p-4 space-y-2">
        <h2 className="font-display font-extrabold">{t('offline.available')}</h2>
        <a href="/patient/triage" className="block underline decoration-dotted">{t('vault.triage')}</a>
        <p className="text-[0.8125rem]">{t('vault.network_only')}</p>
        <p className="text-[0.8125rem] font-bold text-sos-700">{t('offline.sos_active')}</p>
        <a href="tel:112" className="block min-h-11 underline decoration-dotted">{t('sos.samu')} · 112</a>
      </CardPagne>
    </main>

  </div>;
}
