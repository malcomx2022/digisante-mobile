'use client';

import { useState } from 'react';

import { Button, CardPagne, Nkyinkyim } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { useLocale } from '@/i18n/LocaleProvider';
import { get, post } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';

interface WalletData {
  balance: string | number;
  currency: string;
  transactions: { id: string; type: string; amount: string | number; createdAt: string }[];
}

const EUR_XOF = 655.957;

// D-21 — Wallet : solde, recharge € → FCFA, historique.
export default function WalletPage() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const { data } = useApi<WalletData>(() => get('/wallet'), [tick]);
  const [eur, setEur] = useState('10');
  const [msg, setMsg] = useState<string | null>(null);
  // Garde front-only contre la double-soumission (double recharge) — §5 : aucune logique de paiement modifiée.
  const [busy, setBusy] = useState(false);

  const xof = Math.round((Number(eur) || 0) * EUR_XOF);

  async function topup() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await post('/wallet/topup', { amountEur: Number(eur), method: 'VISA_MC' });
      setMsg('✓ Recharge initiée (FedaPay)');
      setTick((x) => x + 1);
    } catch {
      setMsg(t('auth.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SpaceHeader title={t('wallet.title')} headerClass="bg-ocre-900" />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto">
        <CardPagne stitch className="p-5 bg-ocre-900 bogolan-dark text-white">
          <p className="text-[12px] text-white/70">{t('wallet.balance')}</p>
          <p className="font-display font-extrabold text-3xl">
            {Number(data?.balance ?? 0).toLocaleString('fr-FR')} <span className="text-base">{data?.currency ?? 'XOF'}</span>
          </p>
          <Nkyinkyim className="my-3 opacity-50" />
          <div className="flex items-center gap-2">
            <input
              value={eur}
              onChange={(e) => setEur(e.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
              className="w-24 bg-white/15 border border-white/20 card-pagne px-3 py-2 text-white text-[15px] focus:outline-none"
              placeholder={t('wallet.topup_eur')}
            />
            <span className="text-[13px] text-white/80">€ → {t('wallet.converted', { xof: xof.toLocaleString('fr-FR') })}</span>
          </div>
          <Button variant="ocre" full className="mt-3" onClick={topup} disabled={busy || !Number(eur)}>
            {t('wallet.topup')} (Visa · 3-D Secure)
          </Button>
          {msg && <p className="mt-2 text-[12px] text-white">{msg}</p>}
        </CardPagne>

        <h2 className="font-display font-extrabold text-[14px] text-stone-700">{t('wallet.history')}</h2>
        <CardPagne className="p-4">
          {(data?.transactions ?? []).length === 0 ? (
            <p className="text-[13px] text-stone-400">{t('common.empty')}</p>
          ) : (
            (data?.transactions ?? []).map((tx) => (
              <div key={tx.id} className="flex justify-between py-1.5 border-b border-dashed border-stone-200 text-[13px]">
                <span className="text-stone-500">
                  {tx.type} · {new Date(tx.createdAt).toLocaleDateString('fr-FR')}
                </span>
                <span className={`font-display font-bold ${tx.type === 'TOPUP' ? 'text-sante-700' : 'text-sos-600'}`}>
                  {tx.type === 'TOPUP' ? '+' : '−'}
                  {Number(tx.amount).toLocaleString('fr-FR')}
                </span>
              </div>
            ))
          )}
        </CardPagne>
      </main>
    </>
  );
}
