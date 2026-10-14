'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Badge, KenteBar, LangSwitcher, StatusBar } from '@/components/ui';
import { QrScanner } from '@/components/ui/QrScanner';
import { HeaderLogout } from '@/components/auth/HeaderLogout';
import { useLocale } from '@/i18n/LocaleProvider';
import { pharmacyApi, type LineStatus, type ScanResult } from '@/lib/api/pharmacy';
import { cn } from '@/lib/cn';

const STATUSES: LineStatus[] = ['DISPENSED', 'PARTIALLY_DISPENSED', 'UNAVAILABLE'];

// D-22 — Pharmacie : scan QR + vérification + délivrance granulaire (thème nuit).
export default function PharmaciePage() {
  const { t } = useLocale();
  const [qr, setQr] = useState('');
  // Le QR reste lié au résultat obtenu, même si la saisie change ensuite.
  const [scanned, setScanned] = useState<{ result: ScanResult; qrCode: string } | null>(null);
  const result = scanned?.result ?? null;
  const [lineStatus, setLineStatus] = useState<Record<string, LineStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [dispensed, setDispensed] = useState(false);
  const [scanning, setScanning] = useState(false);
  // Garde in-flight : un double-tap sur « délivrer » créerait DEUX journaux
  // Dispensation (idem double-scan) — on verrouille pendant la requête.
  const [busy, setBusy] = useState(false);

  // Erreur réseau / 403 (profil absent) / hors-ligne → message réel ; sinon QR non reconnu.
  function errorMessage(e: unknown): string {
    return e instanceof Error && e.message ? e.message : t('pharmacie.invalid');
  }

  async function scan(code: string = qr) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setScanned(null);
    setDispensed(false);
    try {
      const r = await pharmacyApi.scan(code);
      setScanned({ result: r, qrCode: code });
      // Par défaut chaque ligne est marquée « délivrée » ; le pharmacien ajuste.
      setLineStatus(Object.fromEntries(r.items.map((it) => [it.id, 'DISPENSED' as LineStatus])));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function dispense() {
    if (!scanned || !result || !result.authentic || result.expired || busy) return;
    const items = result.items.filter((item) => item.status !== 'DISPENSED');
    if (!items.length) return;
    setBusy(true);
    try {
      await pharmacyApi.dispense(
        result.id,
        items.map((it) => ({ itemId: it.id, status: lineStatus[it.id] ?? 'DISPENSED' })),
        scanned.qrCode,
      );
      setDispensed(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 bg-nuit bogolan-dark text-white flex flex-col">
      {/* StatusBar mobile uniquement ; sur desktop, langue/déconnexion via la TopNav. */}
      <div className="lg:hidden">
        <StatusBar dark right={<div className="flex items-center gap-2"><LangSwitcher dark /><HeaderLogout /></div>} />
      </div>
      <div className="px-6 pt-2 pb-4 flex items-start justify-between gap-2 lg:max-w-2xl lg:mx-auto lg:w-full">
        <div>
          <h1 className="font-display font-extrabold text-2xl">{t('pharmacie.title')}</h1>
          <p className="text-[0.75rem] text-white/80">{t('pharmacie.scan')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/pharmacie/history" className="card-pagne bg-white/15 border border-white/20 px-3 py-1.5 text-[0.75rem] font-display font-bold">
            {t('pharmacie.history')}
          </Link>
          <Link href="/pharmacie/profile" className="card-pagne bg-white/15 border border-white/20 px-3 py-1.5 text-[0.75rem] font-display font-bold">
            {t('profile.title')}
          </Link>
        </div>
      </div>

      <div className="px-6 flex-1 space-y-4 lg:max-w-2xl lg:mx-auto lg:w-full">
        {/* Viseur — toucher pour scanner à la caméra */}
        <button
          type="button"
          onClick={() => setScanning(true)}
          aria-label={t('scan.title')}
          className="relative w-full wax-dark card-pagne stitch-light border-2 border-ocre-400 h-44 grid place-items-center overflow-hidden"
        >
          <div className="absolute left-0 right-0 h-0.5 bg-ocre-400 scan-line" />
          <span className="text-white/80 text-[0.8125rem] font-display font-bold"><span aria-hidden="true">📷</span> {t('scan.tap')}</span>
        </button>

        <input
          value={qr}
          onChange={(e) => setQr(e.target.value)}
          placeholder={t('pharmacie.qr')}
          aria-label={t('pharmacie.qr')}
          className="w-full bg-white/10 border border-white/20 card-pagne pagne-focus px-3 py-2 text-white text-base focus:outline-none focus:border-ocre-400"
        />
        <button type="button" onClick={() => scan()} className="w-full bg-ocre-400 text-stone-900 font-display font-extrabold card-pagne py-3 disabled:opacity-50 pagne-focus" disabled={busy || qr.length < 16}>
          {t('pharmacie.verify')}
        </button>

        {error && <p className="text-sos-100 bg-sos-700/40 card-pagne px-3 py-2 text-[0.8125rem]">{error}</p>}

        {result && (
          <div className="bg-creme text-nuit card-pagne relative overflow-hidden">
            <div className="bg-sante-900 bogolan-dark text-white p-3 relative">
              <p className="font-display font-extrabold">{result.authentic ? t('pharmacie.authentic') : t('pharmacie.suspicious')}</p>
              {result.patient && <p className="text-[0.75rem] text-white/80">{result.patient.firstName} {result.patient.lastName}</p>}
              <KenteBar className="absolute bottom-0 left-0 right-0" />
            </div>
            <div className="p-4 space-y-3">
              {result.items.map((it) => (
                <div key={it.id} className="border-b border-dashed border-stone-200 pb-2.5">
                  <span className="font-display font-bold text-[0.875rem]">{it.medicationName}</span>
                  {it.genericSuggestion && <p className="text-[0.75rem] text-ocre-600"><span aria-hidden="true">↳</span> {t('pharmacie.generic')} : {it.genericSuggestion}</p>}
                  {/* Choix du statut de délivrance par ligne (rupture de stock, partiel…) */}
                  {!dispensed && (
                    <div className="flex gap-1.5 mt-1.5">
                      {STATUSES.map((s) => (
                        <button
                          key={s}
                          type="button"
                          disabled={busy || it.status === 'DISPENSED'}
                          aria-pressed={(lineStatus[it.id] ?? 'DISPENSED') === s}
                          onClick={() => setLineStatus((m) => ({ ...m, [it.id]: s }))}
                          className={cn(
                            'card-pagne px-2 py-1 text-[0.6875rem] font-display font-bold border',
                            (lineStatus[it.id] ?? 'DISPENSED') === s ? 'bg-sante-600 text-white border-stone-900' : 'bg-white text-stone-500 border-stone-200',
                          )}
                        >
                          {t(`pharmacie.line.${s}`)}
                        </button>
                      ))}
                    </div>
                  )}
                  {dispensed && (
                    <Badge variant={(lineStatus[it.id] ?? 'DISPENSED') === 'DISPENSED' ? 'normal' : 'eleve'} className="mt-1">
                      {t(`pharmacie.line.${lineStatus[it.id] ?? 'DISPENSED'}`)}
                    </Badge>
                  )}
                </div>
              ))}
              {dispensed ? (
                <p className="text-sante-700 font-display font-bold text-center"><span aria-hidden="true">✓</span> {t('pharmacie.dispensed_ok')}</p>
              ) : (
                <>
                  {result.expired && (
                    <p className="bg-sos-100 text-sos-700 card-pagne px-3 py-2 text-[0.75rem] font-bold mb-1">
                      {t('pharmacie.expired')}
                    </p>
                  )}
                  <button type="button" onClick={dispense} className="w-full bg-sante-600 text-white font-display font-extrabold card-pagne py-2.5 mt-1 disabled:opacity-50 pagne-focus" disabled={busy || !result.authentic || result.expired || result.items.every((item) => item.status === 'DISPENSED')}>
                    {t('pharmacie.dispense')}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {scanning && (
        <QrScanner
          onResult={(v) => {
            setScanning(false);
            setQr(v);
            void scan(v);
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  );
}
