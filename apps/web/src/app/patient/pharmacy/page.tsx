'use client';

import { useState } from 'react';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { Badge, Button, CardPagne } from '@/components/ui';
import { Empty } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { type AvailabilityItem, pharmacyApi, type StockStatus } from '@/lib/api/pharmacy';
import { cn } from '@/lib/cn';

// D-24 — « Médicament près de moi » : le patient cherche un médicament et voit
// les pharmacies qui l'ont en stock, triées par distance (si géolocalisé). Évite
// les trajets inutiles en zone reculée. Inventaire (non médical, §4).
const STATUS: Record<StockStatus, { tone: 'normal' | 'priorite'; key: string }> = {
  IN_STOCK: { tone: 'normal', key: 'pharma_find.in_stock' },
  LOW: { tone: 'priorite', key: 'pharma_find.low' },
  OUT: { tone: 'priorite', key: 'pharma_find.low' },
};

export default function FindMedicationPage() {
  const { t } = useLocale();
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [items, setItems] = useState<AvailabilityItem[]>([]);
  const [err, setErr] = useState<string | null>(null);

  function locate() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
        setLocating(false);
      },
      () => setLocating(false),
      { timeout: 8000 },
    );
  }

  async function search() {
    if (q.trim().length < 2) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await pharmacyApi.availability(q.trim(), pos ?? undefined);
      setItems(res.items);
      setSearched(true);
    } catch {
      setErr(t('auth.error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PatientHeader title={t('pharma_find.title')} subtitle={t('pharma_find.subtitle')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto lg:w-full">
        <CardPagne stitch className="p-4 space-y-2">
          <label className="block">
            <span className="font-display font-bold text-[0.75rem] text-stone-600">{t('pharma_find.search')}</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              placeholder={t('pharma_find.search_ph')}
              className="mt-1 w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-base pagne-focus focus:outline-none focus:border-sante-600"
            />
          </label>
          <div className="flex items-center gap-2">
            <Button variant="sante" disabled={loading || q.trim().length < 2} onClick={search}>
              {loading ? t('common.loading') : t('pharma_find.go')}
            </Button>
            <button
              type="button"
              onClick={locate}
              className={cn(
                'text-[0.71875rem] font-display font-bold card-pagne px-2.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sante-600',
                pos ? 'bg-sante-50 text-sante-700' : 'bg-white border border-stone-300 text-stone-600',
              )}
            >
              <span aria-hidden="true">📍 </span>{locating ? t('common.loading') : pos ? t('pharma_find.located') : t('pharma_find.locate')}
            </button>
          </div>
          {err && <p className="text-[0.75rem] text-sos-600 font-bold">{err}</p>}
        </CardPagne>

        {searched && items.length === 0 && <Empty label={t('pharma_find.empty')} />}

        {items.map((it) => {
          const st = STATUS[it.status];
          return (
            <CardPagne key={it.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-display font-bold text-[0.9375rem] text-stone-900">{it.displayName}</p>
                  <p className="text-[0.8125rem] text-stone-600">{it.pharmacy.name}</p>
                  <p className="text-[0.75rem] text-stone-400">{it.pharmacy.address}</p>
                </div>
                <div className="text-right shrink-0">
                  <Badge variant={st.tone}>{t(st.key)}</Badge>
                  {it.distanceKm != null && <p className="mt-1 text-[0.6875rem] text-stone-500 font-bold">{t('pharma_find.km', { d: String(it.distanceKm) })}</p>}
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                {it.price != null ? (
                  <span className="text-[0.8125rem] font-display font-extrabold text-terre-600">{it.price} XOF</span>
                ) : (
                  <span />
                )}
                <a href={`tel:${it.pharmacy.phone}`} className="text-[0.75rem] font-display font-bold text-sante-700 card-pagne px-2.5 py-1 bg-sante-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sante-600">
                  <span aria-hidden="true">📞 </span>{t('pharma_find.call')}
                </a>
              </div>
            </CardPagne>
          );
        })}
      </main>
    </>
  );
}
