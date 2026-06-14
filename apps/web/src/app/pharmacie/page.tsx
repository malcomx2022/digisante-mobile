'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Badge, KenteBar, LangSwitcher, StatusBar } from '@/components/ui';
import { QrScanner } from '@/components/ui/QrScanner';
import { HeaderLogout } from '@/components/auth/HeaderLogout';
import { useLocale } from '@/i18n/LocaleProvider';
import { post } from '@/lib/api/client';

interface ScanResult {
  authentic: boolean;
  id: string;
  expired: boolean;
  items: { id: string; medicationName: string; status: string; genericSuggestion: string | null }[];
}

// D-22 — Pharmacie : scan QR + vérification + délivrance (thème nuit).
export default function PharmaciePage() {
  const { t } = useLocale();
  const [qr, setQr] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dispensed, setDispensed] = useState(false);
  const [scanning, setScanning] = useState(false);

  async function scan(code: string = qr) {
    setError(null);
    setResult(null);
    setDispensed(false);
    try {
      const r = (await post('/pharmacy/scan', { qrCode: code })) as ScanResult;
      setResult(r);
    } catch {
      setError(t('pharmacie.invalid'));
    }
  }

  async function dispense() {
    if (!result) return;
    await post(`/pharmacy/prescriptions/${result.id}/dispense`, {
      items: result.items.map((it) => ({ itemId: it.id, status: 'DISPENSED' as const })),
    }).catch(() => {});
    setDispensed(true);
  }

  return (
    <div className="flex-1 bg-nuit bogolan-dark text-white flex flex-col">
      <StatusBar dark right={<div className="flex items-center gap-2"><LangSwitcher dark /><HeaderLogout /></div>} />
      <div className="px-6 pt-2 pb-4 flex items-start justify-between gap-2">
        <div>
          <h1 className="font-display font-extrabold text-2xl">{t('pharmacie.title')}</h1>
          <p className="text-[12px] text-white/60">{t('pharmacie.scan')}</p>
        </div>
        <Link href="/pharmacie/profile" className="card-pagne bg-white/15 border border-white/20 px-3 py-1.5 text-[12px] font-display font-bold">
          {t('profile.title')}
        </Link>
      </div>

      <div className="px-6 flex-1 space-y-4">
        {/* Viseur — toucher pour scanner à la caméra */}
        <button
          type="button"
          onClick={() => setScanning(true)}
          aria-label={t('scan.title')}
          className="relative w-full wax-dark card-pagne stitch-light border-2 border-ocre-400 h-44 grid place-items-center overflow-hidden"
        >
          <div className="absolute left-0 right-0 h-0.5 bg-ocre-400 scan-line" />
          <span className="text-white/60 text-[13px] font-display font-bold">📷 {t('scan.tap')}</span>
        </button>

        <input
          value={qr}
          onChange={(e) => setQr(e.target.value)}
          placeholder={t('pharmacie.qr')}
          className="w-full bg-white/10 border border-white/20 card-pagne px-3 py-2 text-white text-[13px] focus:outline-none"
        />
        <button type="button" onClick={() => scan()} className="w-full bg-ocre-400 text-stone-900 font-display font-extrabold card-pagne py-3" disabled={qr.length < 16}>
          {t('pharmacie.verify')}
        </button>

        {error && <p className="text-sos-100 bg-sos-700/40 card-pagne px-3 py-2 text-[13px]">{error}</p>}

        {result && (
          <div className="bg-creme text-nuit card-pagne relative overflow-hidden">
            <div className="bg-sante-900 bogolan-dark text-white p-3 relative">
              <p className="font-display font-extrabold">{result.authentic ? t('pharmacie.authentic') : 'Signature douteuse'}</p>
              <KenteBar className="absolute bottom-0 left-0 right-0" />
            </div>
            <div className="p-4 space-y-2">
              {result.items.map((it) => (
                <div key={it.id} className="border-b border-dashed border-stone-200 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-display font-bold text-[14px]">{it.medicationName}</span>
                    <Badge variant={it.status === 'DISPENSED' ? 'normal' : 'eleve'}>{it.status}</Badge>
                  </div>
                  {it.genericSuggestion && <p className="text-[12px] text-ocre-600">↳ {t('pharmacie.generic')} : {it.genericSuggestion}</p>}
                </div>
              ))}
              {dispensed ? (
                <p className="text-sante-700 font-display font-bold text-center">✓ Délivré</p>
              ) : (
                <button type="button" onClick={dispense} className="w-full bg-sante-600 text-white font-display font-extrabold card-pagne py-2.5 mt-2" disabled={result.expired}>
                  {t('pharmacie.dispense')}
                </button>
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
