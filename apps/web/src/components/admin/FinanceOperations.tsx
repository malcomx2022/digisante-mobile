'use client';
import { useRef, useState } from 'react';
import { Button, CardPagne, ConfirmDialog } from '@/components/ui';
import { ErrorState, SkeletonCards } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { formatDateTime, formatNumber } from '@/i18n/format';
import { get, postNow } from '@/lib/api/client';
import { apiErrorMessage } from '@/lib/api/errors';
import { type EligiblePayments, type FinanceOperation, type Paginated } from '@/lib/api/finance';
import { useApi } from '@/lib/api/useApi';

type Action = { kind: 'payout' } | { kind: 'legacy' } | { kind: 'start' | 'cancel' | 'complete'; operation: FinanceOperation };
export default function FinanceOperations({ canWrite, tick, refresh }: { canWrite: boolean; tick: number; refresh: () => void }) {
  const { t } = useLocale(); const [page, setPage] = useState(1); const [candidatePage, setCandidatePage] = useState(1);
  const [anomalyPage, setAnomalyPage] = useState(1);
  const [doctorInput, setDoctorInput] = useState(''); const [doctorId, setDoctorId] = useState(''); const [paymentId, setPaymentId] = useState('');
  const [selected, setSelected] = useState<string[]>([]); const [proofRef, setProofRef] = useState('');
  const [action, setAction] = useState<Action | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const running = useRef(false); const identity = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const ops = useApi(() => get<Paginated<FinanceOperation>>(`/admin/finance/operations?page=${page}&pageSize=10`), [page, tick]);
  const anomalies = useApi(() => get<{ data: { id: string; doctorId: string | null; status: string; amount: string; providerReference: string | null }[]; hasMore: boolean }>(`/admin/finance/anomalies?page=${anomalyPage}&pageSize=10`), [anomalyPage, tick]);
  const eligible = useApi(() => doctorId ? get<EligiblePayments>(`/admin/finance/eligible?doctorId=${encodeURIComponent(doctorId)}&page=${candidatePage}&pageSize=20`) : Promise.resolve(null), [doctorId, candidatePage, tick]);
  const candidates = !eligible.loading && !eligible.error ? eligible.data : null;
  async function execute() {
    if (!action || running.current) return;
    running.current = true; setBusy(true); setError(null);
    try {
      if (action.kind === 'payout') {
        const fingerprint = `${doctorId}:${[...selected].sort().join()}`;
        if (!identity.current || identity.current.fingerprint !== fingerprint) identity.current = { fingerprint, requestId: crypto.randomUUID() };
        await postNow('/admin/finance/payouts', { doctorId, paymentIds: selected, requestId: identity.current.requestId });
        identity.current = null; setSelected([]);
      } else if (action.kind === 'legacy') await postNow(`/admin/finance/payments/${encodeURIComponent(paymentId.trim())}/external-refund`);
      else await postNow(`/admin/finance/operations/${action.operation.id}/${action.kind}`, action.kind === 'complete' ? { proofRef } : undefined);
      setAction(null); setProofRef(''); refresh();
    } catch (e) {
      // Refus métier de l'API affiché tel quel ; message générique seulement en repli (réseau/5xx).
      setError(apiErrorMessage(e, t('revenue.error')));
    } finally { running.current = false; setBusy(false); }
  }
  return <CardPagne className="p-4 space-y-4">
    <h2 className="font-display font-extrabold text-indigo-900">{t('finance_ops.title')}</h2>
    <p className="text-[0.875rem] text-stone-600">{t('finance_ops.manual')}</p>
    {canWrite && <>
      <label className="block font-bold">{t('finance_ops.doctor')}<input value={doctorInput} onChange={(e) => setDoctorInput(e.target.value)} className="block w-full p-2 text-base border border-indigo-200 pagne-focus" /></label>
      <Button variant="outline" disabled={busy || !doctorInput.trim()} onClick={() => { setDoctorId(doctorInput.trim()); setCandidatePage(1); setSelected([]); }}>{t('finance_ops.eligible')}</Button>
      {eligible.loading && doctorId && <SkeletonCards count={1} />}
      {eligible.error && <ErrorState label={t('revenue.error')} />}
      {candidates && <div className="space-y-2">
        <p>{t('revenue.available')}: {formatNumber(candidates.balance.available)} FCFA</p>
        {candidates.data.length === 0 && <p>{t('finance_ops.empty_eligible')}</p>}
        {candidates.data.map((p) => <label key={p.paymentId} className="flex gap-2 items-center text-[0.875rem] break-all"><input type="checkbox" checked={selected.includes(p.paymentId)} disabled={busy} onChange={(e) => setSelected((s) => e.target.checked ? [...s, p.paymentId] : s.filter((id) => id !== p.paymentId))} /><span>{p.paymentId} · {formatNumber(p.net)} FCFA</span></label>)}
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || candidatePage === 1} onClick={() => { setSelected([]); setCandidatePage((p) => p - 1); }}>{t('finance_ops.previous')}</Button><Button variant="outline" disabled={busy || !candidates.hasMore} onClick={() => { setSelected([]); setCandidatePage((p) => p + 1); }}>{t('finance_ops.next')}</Button></div>
        <Button disabled={busy || selected.length === 0} onClick={() => setAction({ kind: 'payout' })}>{t('finance_ops.request')}</Button>
      </div>}
      <label className="block font-bold">{t('finance_ops.legacy_payment')}<input value={paymentId} onChange={(e) => setPaymentId(e.target.value)} className="block w-full p-2 text-base border border-indigo-200 pagne-focus" /></label>
      <Button variant="outline" disabled={busy || !paymentId.trim()} onClick={() => setAction({ kind: 'legacy' })}>{t('finance_ops.legacy')}</Button>
    </>}
    {ops.error && <ErrorState label={t('revenue.error')} />}
    {ops.loading && <SkeletonCards count={1} />}
    {!ops.loading && !ops.error && ops.data?.data.map((op) => <div key={op.id} className="p-3 border-b border-dashed border-stone-300 space-y-2 text-[0.875rem] break-words">
      <p className="font-bold">{t(`finance_ops.kind_${op.kind.toLowerCase()}`)} · {formatNumber(op.amount)} FCFA · {t(`finance_ops.state_${op.state.toLowerCase()}`)}</p>
      <p>{t('finance_ops.operation', { id: op.id })}</p>
      {op.doctorId && <p>{t('finance_ops.doctor')}: {op.doctorId}</p>}
      {op.items.map((item) => <div key={item.paymentId}><p>{t('subscriptions.reference', { id: item.paymentId })} · {formatNumber(item.amount)} FCFA</p>{item.providerReference && <p>{t('finance_ops.provider', { id: item.providerReference })}</p>}</div>)}
      {op.executingBy && <p>{t('finance_ops.operator', { id: op.executingBy })}</p>}
      {op.state === 'EXECUTING' && <p className="font-bold text-ocre-700">{t('finance_ops.uncertain')}</p>}
      {op.proofRef && <p>{t('finance_ops.proof')}: {op.proofRef}</p>}
      {op.executedAt && <p>{formatDateTime(op.executedAt, { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Lagos' })}</p>}
      {canWrite && <div className="flex flex-wrap gap-2">
        {op.state === 'REQUESTED' && <Button disabled={busy} onClick={() => setAction({ kind: 'start', operation: op })}>{t('finance_ops.start')}</Button>}
        {op.state === 'REQUESTED' && op.kind === 'PAYOUT' && <Button variant="outline" disabled={busy} onClick={() => setAction({ kind: 'cancel', operation: op })}>{t('finance_ops.cancel')}</Button>}
        {op.state === 'EXECUTING' && <Button disabled={busy} onClick={() => setAction({ kind: 'complete', operation: op })}>{t('finance_ops.complete')}</Button>}
      </div>}
    </div>)}
    <div className="flex gap-2"><Button variant="outline" disabled={busy || page === 1} onClick={() => setPage((p) => p - 1)}>{t('finance_ops.previous')}</Button><Button variant="outline" disabled={busy || !ops.data || page * 10 >= ops.data.total} onClick={() => setPage((p) => p + 1)}>{t('finance_ops.next')}</Button></div>
    <div className="nkyinkyim w-full opacity-30" />
    <h3 className="font-display font-bold">{t('finance_ops.anomalies')}</h3>
    <p className="text-[0.875rem]">{t('finance_ops.anomalies_notice')}</p>
    {anomalies.error && <ErrorState label={t('revenue.error')} />}
    {anomalies.loading && <SkeletonCards count={1} />}
    {!anomalies.loading && !anomalies.error && anomalies.data?.data.map((p) => <div key={p.id} className="text-[0.875rem] border-b border-dashed border-stone-300 py-2 break-words"><p>{t('subscriptions.reference', { id: p.id })} · {formatNumber(p.amount)} FCFA · {t(`subscriptions.payment_${p.status.toLowerCase()}`)}</p>{p.doctorId && <p>{t('finance_ops.doctor')}: {p.doctorId}</p>}{p.providerReference && <p>{t('finance_ops.provider', { id: p.providerReference })}</p>}</div>)}
    <div className="flex gap-2"><Button variant="outline" disabled={busy || anomalyPage === 1} onClick={() => setAnomalyPage((p) => p - 1)}>{t('finance_ops.previous')}</Button><Button variant="outline" disabled={busy || !anomalies.data?.hasMore} onClick={() => setAnomalyPage((p) => p + 1)}>{t('finance_ops.next')}</Button></div>
    <ConfirmDialog open={action !== null} busy={busy} title={t('finance_ops.title')} message={t(action?.kind === 'start' ? 'finance_ops.start_confirm' : action?.kind === 'complete' ? 'finance_ops.complete_confirm' : 'finance_ops.confirm')} confirmLabel={t('subscriptions.confirm_cancel')} onConfirm={() => void execute()} onCancel={() => { if (!busy) { setAction(null); setError(null); } }}>
      {action?.kind === 'complete' && <label className="block font-bold">{t('finance_ops.proof')}<input value={proofRef} onChange={(e) => setProofRef(e.target.value)} maxLength={120} className="block w-full p-2 text-base border border-indigo-200 pagne-focus" /></label>}
      {error && <p role="alert" className="text-[0.8125rem] font-bold text-sos-600">{error}</p>}
    </ConfirmDialog>
  </CardPagne>;
}
