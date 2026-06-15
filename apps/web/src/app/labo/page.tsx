'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { Button, CardPagne } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { useLocale } from '@/i18n/LocaleProvider';
import { post } from '@/lib/api/client';

interface ValueRow {
  key: string;
  value: string;
}

interface SubmitResult {
  critical: { key: string; value: number; reason: string }[];
}

// D-23 — Laboratoire : saisie de résultat + détection de valeur critique.
export default function LaboPage() {
  return (
    <Suspense fallback={null}>
      <LaboResult />
    </Suspense>
  );
}

function LaboResult() {
  const { t } = useLocale();
  const params = useSearchParams();
  const [orderId, setOrderId] = useState(params.get('order') ?? '');
  const [rows, setRows] = useState<ValueRow[]>([{ key: 'troponine', value: '' }]);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function setRow(i: number, key: keyof ValueRow, val: string) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));
  }

  async function publish() {
    setError(null);
    setResult(null);
    const values: Record<string, number | string> = {};
    for (const r of rows) if (r.key) values[r.key] = Number(r.value) || r.value;
    try {
      const res = (await post(`/lab/orders/${orderId}/result`, { values })) as SubmitResult;
      setResult(res);
    } catch {
      setError(t('auth.error'));
    }
  }

  const inputCls = 'bg-white card-pagne border border-stone-300 px-3 py-2 text-[13px] focus:outline-none focus:border-ocre-500';

  return (
    <>
      <SpaceHeader title={t('labo.title')} subtitle={t('labo.result')} headerClass="bg-ocre-900" profileHref="/labo/profile" />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6">
        <Link href="/labo/orders" className="block w-full text-center bg-ocre-400 text-stone-900 font-display font-extrabold card-pagne py-3">
          📥 {t('labo.orders_title')}
        </Link>
        <input className={`${inputCls} w-full`} placeholder={t('labo.order')} value={orderId} onChange={(e) => setOrderId(e.target.value)} />

        <CardPagne className="p-4 space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-2 gap-2">
              <input className={inputCls} placeholder="Analyse (ex. glucose)" value={r.key} onChange={(e) => setRow(i, 'key', e.target.value)} />
              <input className={`${inputCls} border-2 border-sos-500`} placeholder="Valeur" value={r.value} onChange={(e) => setRow(i, 'value', e.target.value)} />
            </div>
          ))}
          <button type="button" onClick={() => setRows((rs) => [...rs, { key: '', value: '' }])} className="text-[13px] text-ocre-600 underline decoration-dotted underline-offset-4">
            + {t('labo.add_value')}
          </button>
        </CardPagne>

        {result && result.critical.length > 0 && (
          <div className="bg-sos-500 text-white card-pagne px-4 py-3 font-display font-extrabold text-[13px] text-center">
            ⚠ {t('labo.critical')}
            <p className="font-body font-normal text-[12px] mt-1">{result.critical.map((c) => `${c.key} ${c.reason}`).join(' · ')}</p>
          </div>
        )}
        {result && result.critical.length === 0 && <p className="text-center text-sante-700 font-bold">✓ Résultat publié</p>}
        {error && <p className="text-center text-sos-600 font-bold text-[13px]">{error}</p>}

        <Button variant="sos" full onClick={publish} disabled={!orderId}>
          {t('labo.publish')}
        </Button>
      </main>
    </>
  );
}
