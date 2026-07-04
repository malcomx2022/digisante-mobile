'use client';

import { useState } from 'react';

import { Button, CardPagne, Nkyinkyim } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { useLocale } from '@/i18n/LocaleProvider';
import { get, post } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';
import { formatDate, formatNumber } from '@/i18n/format';

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
      setMsg(`✓ ${t('wallet.topup_initiated')}`);
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
          <p className="text-[0.75rem] text-white/80">{t('wallet.balance')}</p>
          <p className="font-display font-extrabold text-3xl">
            {formatNumber(data?.balance ?? 0)} <span className="text-base">{data?.currency ?? 'XOF'}</span>
          </p>
          <Nkyinkyim className="my-3 opacity-50" />
          <div className="flex items-center gap-2">
            <input
              value={eur}
              onChange={(e) => setEur(e.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
              className="w-24 bg-white/15 border border-white/20 card-pagne px-3 py-2 text-white text-[0.9375rem] focus:outline-none"
              placeholder={t('wallet.topup_eur')}
              aria-label={t('wallet.topup_eur')}
            />
            <span className="text-[0.8125rem] text-white/80">€ → {t('wallet.converted', { xof: formatNumber(xof) })}</span>
          </div>
          <Button variant="ocre" full className="mt-3" onClick={topup} disabled={busy || !Number(eur)}>
            {t('wallet.topup')} {t('wallet.card_hint')}
          </Button>
          {msg && <p className="mt-2 text-[0.75rem] text-white">{msg}</p>}
        </CardPagne>

        <h2 className="font-display font-extrabold text-[0.875rem] text-stone-700">{t('wallet.history')}</h2>
        <CardPagne className="p-4">
          {(data?.transactions ?? []).length === 0 ? (
            <p className="text-[0.8125rem] text-stone-400">{t('common.empty')}</p>
          ) : (
            (data?.transactions ?? []).map((tx) => (
              <div key={tx.id} className="flex justify-between py-1.5 border-b border-dashed border-stone-200 text-[0.8125rem]">
                <span className="text-stone-500">
                  {t(`wallet.tx.${tx.type}`)} · {formatDate(tx.createdAt)}
                </span>
                <span className={`font-display font-bold ${tx.type === 'TOPUP' ? 'text-sante-700' : 'text-sos-600'}`}>
                  {tx.type === 'TOPUP' ? '+' : '−'}
                  {formatNumber(tx.amount)}
                </span>
              </div>
            ))
          )}
        </CardPagne>
      </main>
    </>
  );
}
