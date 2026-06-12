'use client';

import { useState } from 'react';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { Badge, CardPagne, KenteBar } from '@/components/ui';
import { Empty, ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get, post } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';

interface Item {
  id: string;
  medicationName: string;
  dosage: string;
  frequency: string;
  duration: string;
  status: string;
}
interface Prescription {
  id: string;
  status: string;
  validUntil: string;
  qrCode: string | null;
  items: Item[];
}

const PAY_METHODS: { method: string; label: string; cls: string }[] = [
  { method: 'MTN_MOMO', label: 'MTN MoMo', cls: 'bg-sante-600 text-white' },
  { method: 'MOOV_MONEY', label: 'Moov Money', cls: 'bg-indigo-600 text-white' },
  { method: 'WALLET', label: 'Wallet Diaspora 🇫🇷', cls: 'bg-ocre-400 text-stone-900' },
];

// D-08 — Ordonnance + paiement.
export default function PrescriptionsPage() {
  const { t } = useLocale();
  const { data, loading, error } = useApi<Prescription[]>(() => get('/prescriptions'), []);
  const [paid, setPaid] = useState<string | null>(null);

  async function pay(method: string) {
    try {
      await post('/payments', { type: 'CONSULTATION', method, amount: 2000 });
      setPaid(method);
    } catch {
      /* hors-ligne → mis en file ; un toast réseau viendra plus tard */
      setPaid(method);
    }
  }

  return (
    <>
      <PatientHeader title={t('prescriptions.title')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6">
        {loading && <Loading label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && (data?.length ?? 0) === 0 && <Empty label={t('common.empty')} />}

        {(data ?? []).map((p) => (
          <CardPagne key={p.id} stitch className="overflow-hidden">
            {/* Header ticket bogolan + kenté + QR */}
            <div className="bg-sante-900 bogolan-dark relative p-4 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-display font-extrabold">ORD · {p.id.slice(-6).toUpperCase()}</p>
                  <p className="text-[12px] text-white/70">
                    {t('prescriptions.valid_until', { date: new Date(p.validUntil).toLocaleDateString('fr-FR') })}
                  </p>
                </div>
                <div className="w-12 h-12 bg-creme card-pagne rotate-2 grid place-items-center text-[8px] text-stone-700">QR</div>
              </div>
              <KenteBar className="absolute bottom-0 left-0 right-0" />
            </div>

            <div className="p-4">
              {p.items.map((it) => (
                <div key={it.id} className="flex gap-3 py-2 border-b border-dashed border-stone-200 last:border-0">
                  <span className={`w-1.5 rounded-full ${it.status === 'DISPENSED' ? 'bg-sante-500' : 'bg-ocre-400'}`} />
                  <div className="flex-1">
                    <p className="font-display font-bold text-[14px]">{it.medicationName}</p>
                    <p className="text-[12px] text-stone-500">
                      {it.dosage} · {it.frequency} · {it.duration}
                    </p>
                  </div>
                  <Badge variant={it.status === 'DISPENSED' ? 'normal' : 'eleve'}>{it.status}</Badge>
                </div>
              ))}

              {/* Paiement */}
              <div className="mt-4 grid grid-cols-3 gap-2">
                {PAY_METHODS.map((m) => (
                  <button
                    key={m.method}
                    type="button"
                    onClick={() => pay(m.method)}
                    className={`card-pagne ${m.cls} font-display font-bold text-[11px] py-2 px-1`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {paid && <p className="mt-2 text-[12px] text-sante-700 font-bold">✓ {t('prescriptions.paid')}</p>}
            </div>
          </CardPagne>
        ))}
      </main>
    </>
  );
}
