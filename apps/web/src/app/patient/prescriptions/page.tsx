'use client';

import { useState } from 'react';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { Badge, CardPagne, KenteBar } from '@/components/ui';
import { QrImage } from '@/components/ui/QrImage';
import { Empty, ErrorState, SkeletonCards } from '@/components/ui/States';
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
  // État de paiement PAR ordonnance : succès / mis en file (hors-ligne) / erreur.
  const [paid, setPaid] = useState<Set<string>>(new Set());
  const [queued, setQueued] = useState<Set<string>>(new Set());
  const [payError, setPayError] = useState<Set<string>>(new Set());
  // Garde in-flight : un double-tap initierait DEUX paiements (argent réel).
  const [busyId, setBusyId] = useState<string | null>(null);

  // ⚠️ §5 : montant/type/appel paiement inchangés — seul le feedback UI est corrigé.
  async function pay(prescriptionId: string, method: string) {
    if (busyId || paid.has(prescriptionId) || queued.has(prescriptionId)) return;
    setBusyId(prescriptionId);
    setPayError((s) => {
      const n = new Set(s);
      n.delete(prescriptionId);
      return n;
    });
    try {
      const res = await post('/payments', { type: 'CONSULTATION', method, amount: 2000 });
      if (res && typeof res === 'object' && 'queued' in res) {
        // Hors-ligne → mutation mise en file (rejouée au retour réseau) : pas encore « payé ».
        setQueued((s) => new Set(s).add(prescriptionId));
      } else {
        setPaid((s) => new Set(s).add(prescriptionId));
      }
    } catch {
      // Vraie erreur (réseau/serveur) → ne PAS marquer payé.
      setPayError((s) => new Set(s).add(prescriptionId));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PatientHeader title={t('prescriptions.title')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto">
        {loading && <SkeletonCards label={t('common.loading')} />}
        {error && <ErrorState label={t('auth.error')} />}
        {!loading && !error && (data?.length ?? 0) === 0 && <Empty label={t('common.empty')} />}

        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        {(data ?? []).map((p) => (
          <CardPagne key={p.id} stitch className="overflow-hidden">
            {/* Header ticket bogolan + kenté + QR */}
            <div className="bg-sante-900 bogolan-dark relative p-4 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-display font-extrabold">ORD · {p.id.slice(-6).toUpperCase()}</p>
                  <p className="text-[0.75rem] text-white/80">
                    {t('prescriptions.valid_until', { date: new Date(p.validUntil).toLocaleDateString('fr-FR') })}
                  </p>
                </div>
                {p.qrCode ? (
                  <QrImage value={p.qrCode} size={56} alt={t('prescriptions.qr_alt')} className="bg-creme card-pagne rotate-2 p-1" />
                ) : (
                  <div className="w-14 h-14 bg-creme card-pagne rotate-2 grid place-items-center text-[0.5rem] text-stone-700">QR</div>
                )}
              </div>
              <KenteBar className="absolute bottom-0 left-0 right-0" />
            </div>

            <div className="p-4">
              {p.items.map((it) => (
                <div key={it.id} className="flex gap-3 py-2 border-b border-dashed border-stone-200 last:border-0">
                  <span className={`w-1.5 rounded-full ${it.status === 'DISPENSED' ? 'bg-sante-500' : 'bg-ocre-400'}`} />
                  <div className="flex-1">
                    <p className="font-display font-bold text-[0.875rem]">{it.medicationName}</p>
                    <p className="text-[0.75rem] text-stone-500">
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
                    onClick={() => pay(p.id, m.method)}
                    disabled={busyId === p.id || paid.has(p.id) || queued.has(p.id)}
                    className={`card-pagne ${m.cls} font-display font-bold text-[0.6875rem] py-2 px-1 disabled:opacity-50`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {paid.has(p.id) && <p className="mt-2 text-[0.75rem] text-sante-700 font-bold"><span aria-hidden="true">✓</span> {t('prescriptions.paid')}</p>}
              {queued.has(p.id) && (
                <p className="mt-2 text-[0.75rem] text-ocre-600 font-bold"><span aria-hidden="true">⏳</span> {t('prescriptions.payment_queued')}</p>
              )}
              {payError.has(p.id) && <p className="mt-2 text-[0.75rem] text-sos-600 font-bold">{t('auth.error')}</p>}
            </div>
          </CardPagne>
        ))}
        </div>
      </main>
    </>
  );
}
