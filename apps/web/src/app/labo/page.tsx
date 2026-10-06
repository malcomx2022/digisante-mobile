'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { LaboratoryGate } from '@/components/auth/LaboratoryGate';
import { Button, CardPagne } from '@/components/ui';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { useLocale } from '@/i18n/LocaleProvider';
import { labApi, type SubmitResult } from '@/lib/api/laboratory';

interface ValueRow {
  key: string;
  value: string;
}

// Bornes physiologiques « de bon sens » pour repérer une faute de frappe (ex. un
// zéro en trop) AVANT de publier — une valeur aberrante déclencherait à tort une
// alerte critique (SMS/Push) au prescripteur. Les clés sont normalisées (sans
// accents/casse) ; l'analyse étant en texte libre, on retient les plus courantes.
// max en unité usuelle de saisie ; garde-fou générique sinon.
const PLAUSIBLE_MAX: Record<string, number> = {
  glucose: 30, // g/L (glycémie ; ~10 g/L déjà extrême)
  glycemie: 30,
  cholesterol: 15, // g/L
  creatinine: 3000, // µmol/L
  uree: 60, // mmol/L
  hemoglobine: 250, // g/L
  potassium: 15, // mmol/L
  kaliemie: 15,
  sodium: 200, // mmol/L
  natremie: 200,
  calcium: 10, // mmol/L
  leucocytes: 500, // 10^9/L
  plaquettes: 3000, // 10^9/L
};
const GENERIC_MAX = 100000; // au-delà : erreur de frappe quasi certaine

function normalizeAnalyte(k: string): string {
  return k
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** Renvoie les analyses dont la valeur numérique dépasse les bornes plausibles. */
function findImplausible(rows: ValueRow[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (!r.key || r.value === '') continue;
    const num = Number(r.value);
    if (Number.isNaN(num)) continue;
    const max = PLAUSIBLE_MAX[normalizeAnalyte(r.key)] ?? GENERIC_MAX;
    if (Math.abs(num) > max) out.push(`${r.key} = ${r.value}`);
  }
  return out;
}

// D-23 — Laboratoire : saisie de résultat + détection de valeur critique.
export default function LaboPage() {
  return (
    <Suspense fallback={null}>
      <LaboratoryGate><LaboResult /></LaboratoryGate>
    </Suspense>
  );
}

function LaboResult() {
  const { t } = useLocale();
  const params = useSearchParams();
  const [orderId, setOrderId] = useState(params.get('order') ?? '');
  const [rows, setRows] = useState<ValueRow[]>([{ key: '', value: '' }]);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  const [confirm, setConfirm] = useState<string[] | null>(null); // valeurs suspectes en attente de confirmation

  function setRow(i: number, key: keyof ValueRow, val: string) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));
  }

  // Interception : si une valeur dépasse les bornes physiologiques plausibles,
  // demander confirmation avant de publier (l'alerte critique est irréversible).
  function requestPublish() {
    if (published) return;
    const suspicious = findImplausible(rows);
    if (suspicious.length > 0) {
      setConfirm(suspicious);
      return;
    }
    void publish();
  }

  async function publish() {
    if (published) return; // anti double-publication (évite une double notification patient)
    setConfirm(null);
    setError(null);
    setResult(null);
    const values: Record<string, number | string> = {};
    for (const r of rows) {
      if (!r.key) continue;
      // Préserver la valeur « 0 » (falsy) : ne basculer sur la chaîne brute que si non numérique.
      const num = Number(r.value);
      values[r.key] = r.value !== '' && !Number.isNaN(num) ? num : r.value;
    }
    try {
      const res = await labApi.submitResult(orderId, values);
      setResult(res);
      setPublished(true);
    } catch {
      setError(t('auth.error'));
    }
  }

  const inputCls = 'bg-white card-pagne border border-stone-300 px-3 py-2 text-base pagne-focus focus:outline-none focus:border-ocre-500';

  return (
    <>
      <SpaceHeader title={t('labo.title')} subtitle={t('labo.result')} headerClass="bg-ocre-900" profileHref="/labo/profile" />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6 lg:max-w-2xl lg:mx-auto">
        <Link href="/labo/orders" className="block w-full text-center bg-ocre-400 text-stone-900 font-display font-extrabold card-pagne py-3">
          <span aria-hidden="true">📥</span> {t('labo.orders_title')}
        </Link>
        <input className={`${inputCls} w-full`} placeholder={t('labo.order')} aria-label={t('labo.order')} value={orderId} onChange={(e) => setOrderId(e.target.value)} />

        <CardPagne className="p-4 space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-2 gap-2">
              <input className={inputCls} placeholder={t('labo.analysis_ph')} aria-label={t('labo.analysis_ph')} value={r.key} onChange={(e) => setRow(i, 'key', e.target.value)} />
              <input className={`${inputCls} border-2 border-sos-500`} placeholder={t('labo.value_ph')} aria-label={t('labo.value_ph')} value={r.value} onChange={(e) => setRow(i, 'value', e.target.value)} />
            </div>
          ))}
          <button type="button" onClick={() => setRows((rs) => [...rs, { key: '', value: '' }])} className="text-[0.8125rem] text-ocre-600 underline decoration-dotted underline-offset-4">
            + {t('labo.add_value')}
          </button>
        </CardPagne>

        {result && (result.critical?.length ?? 0) > 0 && (
          <div className="bg-sos-500 text-white card-pagne px-4 py-3 font-display font-extrabold text-[0.8125rem] text-center">
            <span aria-hidden="true">⚠</span> {t('labo.critical')}
            <p className="font-body font-normal text-[0.75rem] mt-1">{result.critical.map((c) => `${c.key} ${c.reason}`).join(' · ')}</p>
          </div>
        )}
        {result && (result.critical?.length ?? 0) === 0 && <p className="text-center text-sante-700 font-bold"><span aria-hidden="true">✓</span> {t('labo.published')}</p>}
        {error && <p className="text-center text-sos-600 font-bold text-[0.8125rem]">{error}</p>}

        <Button variant="sos" full onClick={requestPublish} disabled={!orderId || published}>
          {t('labo.publish')}
        </Button>
      </main>

      <ConfirmDialog
        open={confirm !== null}
        danger
        title={t('labo.check_title')}
        message={t('labo.check_msg')}
        confirmLabel={t('labo.check_confirm')}
        cancelLabel={t('labo.check_recheck')}
        onConfirm={() => void publish()}
        onCancel={() => setConfirm(null)}
      >
        {confirm && confirm.length > 0 && (
          <ul className="list-disc pl-5 text-[0.8125rem] text-stone-700 font-bold space-y-0.5">
            {confirm.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </ConfirmDialog>
    </>
  );
}
