'use client';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { PrescriptionPosology } from '@/components/patient/PrescriptionPosology';
import { Badge, CardPagne, KenteBar } from '@/components/ui';
import { QrImage } from '@/components/ui/QrImage';
import { Empty, ErrorState, SkeletonCards } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';
import { formatDate } from '@/i18n/format';

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

// D-08 — Ordonnance (QR de vérification). Le paiement d'une consultation se fait
// désormais sur la page « Mes rendez-vous » (montant = tarif du médecin, imposé serveur).
export default function PrescriptionsPage() {
  const { t } = useLocale();
  const { data, loading, error } = useApi<Prescription[]>(() => get('/prescriptions'), []);

  return (
    <>
      <PatientHeader title={t('prescriptions.title')} />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto lg:w-full">
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
                    {t('prescriptions.valid_until', { date: formatDate(p.validUntil) })}
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
                  <div className="flex-1 min-w-0">
                    <PrescriptionPosology item={it} />
                  </div>
                  <Badge variant={it.status === 'DISPENSED' ? 'normal' : 'eleve'}>{t(`pharmacie.line.${it.status}`)}</Badge>
                </div>
              ))}
            </div>
          </CardPagne>
        ))}
        </div>
      </main>
    </>
  );
}
