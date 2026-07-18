'use client';

import Link from 'next/link';
import { useState } from 'react';

import { HeaderLogout } from '@/components/auth/HeaderLogout';
import { Button, LangSwitcher, StatusBar } from '@/components/ui';
import { Empty, ErrorState, SkeletonCards } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { pharmacyApi, type StockItem, type StockStatus } from '@/lib/api/pharmacy';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';

// D-22c — Pharmacie : gestion du stock (disponibilité des médicaments). Alimente
// la recherche patient « médicament près de moi ». Inventaire, non médical.
const STATUSES: StockStatus[] = ['IN_STOCK', 'LOW', 'OUT'];

export default function PharmacieStockPage() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const { data, loading, error } = useApi<StockItem[]>(() => pharmacyApi.listStock(), [tick]);
  const refresh = () => setTick((n) => n + 1);

  const [name, setName] = useState('');
  const [status, setStatus] = useState<StockStatus>('IN_STOCK');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await pharmacyApi.saveStock({ displayName: name.trim(), status, price: price.trim() ? Number(price) : null });
      setName('');
      setPrice('');
      setStatus('IN_STOCK');
      refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 bg-nuit bogolan-dark text-white flex flex-col">
      <div className="lg:hidden">
        <StatusBar dark right={<div className="flex items-center gap-2"><LangSwitcher dark /><HeaderLogout /></div>} />
      </div>
      <div className="px-6 pt-2 pb-4 flex items-start justify-between gap-2 lg:max-w-5xl lg:mx-auto lg:w-full">
        <div>
          <h1 className="font-display font-extrabold text-2xl">{t('stock.title')}</h1>
          <p className="text-[0.75rem] text-white/80">{t('stock.subtitle')}</p>
        </div>
        <Link href="/pharmacie" className="card-pagne bg-white/15 border border-white/20 px-3 py-1.5 text-[0.75rem] font-display font-bold">
          {t('common.back')}
        </Link>
      </div>

      <div className="px-6 flex-1 space-y-3 pb-6 lg:max-w-5xl lg:mx-auto lg:w-full">
        {/* Ajout / mise à jour */}
        <div className="bg-creme text-nuit card-pagne p-4 space-y-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('stock.name_ph')}
            className="w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-base pagne-focus focus:outline-none focus:border-ocre-500"
          />
          <div className="flex items-center gap-2">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as StockStatus)}
              className="flex-1 bg-white card-pagne border border-stone-300 px-2 py-2 text-base focus:outline-none focus:border-ocre-500"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{t(`stock.status.${s}`)}</option>
              ))}
            </select>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="numeric"
              placeholder={t('stock.price_ph')}
              className="w-28 bg-white card-pagne border border-stone-300 px-3 py-2 text-base focus:outline-none focus:border-ocre-500"
            />
          </div>
          <Button variant="ocre" full disabled={saving || !name.trim()} onClick={save}>
            {saving ? t('common.loading') : t('stock.save')}
          </Button>
        </div>

        {loading && <SkeletonCards label={t('common.loading')} count={3} />}
        {error && <ErrorState label={t('common.load_error')} />}
        {!loading && !error && (data?.length ?? 0) === 0 && <Empty label={t('stock.empty')} />}

        {(data ?? []).map((s) => (
          <div key={s.id} className="bg-creme text-nuit card-pagne p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-display font-bold text-[0.875rem]">{s.displayName}</p>
              <p className="text-[0.71875rem] text-stone-500">
                <span className={cn('font-bold', s.status === 'IN_STOCK' ? 'text-sante-600' : s.status === 'LOW' ? 'text-ocre-600' : 'text-sos-600')}>
                  {t(`stock.status.${s.status}`)}
                </span>
                {s.price != null && <span> · {s.price} XOF</span>}
              </p>
            </div>
            <button
              type="button"
              onClick={async () => { await pharmacyApi.removeStock(s.id); refresh(); }}
              aria-label={t('common.delete')}
              className="shrink-0 text-stone-400 hover:text-sos-600 card-pagne px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ocre-500"
            >
              <span aria-hidden="true">🗑</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
