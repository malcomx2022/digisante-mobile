'use client';

import { useState } from 'react';

import { Button, CardPagne } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { ErrorState, SkeletonCards } from '@/components/ui/States';
import { formatDateTime } from '@/i18n/format';
import { useLocale } from '@/i18n/LocaleProvider';
import {
  integrationsApi,
  type IntegrationView,
  PROVIDER_META,
  PROVIDER_ORDER,
  unconfirmedKeys,
  type WebhookJournalEntry,
} from '@/lib/api/integrations';
import { useApi } from '@/lib/api/useApi';
import { cn } from '@/lib/cn';

function dt(s: string | null): string {
  return s ? formatDateTime(s, { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

// D-25g — Gestion des API tierces (super admin, §3.6). Saisie/rotation des clés
// (write-only, jamais affichées en clair) + webhooks. FedaPay = §5 (lecture seule,
// géré via .env). Cloisonnement §4 : aucun contenu médical.
export default function AdminIntegrations() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const list = useApi(() => integrationsApi.list(), [tick]);
  const items = list.data?.items;
  const ordered = items
    ? [...items].sort((a, b) => PROVIDER_ORDER.indexOf(a.provider) - PROVIDER_ORDER.indexOf(b.provider))
    : [];

  return (
    <>
      <SpaceHeader title={t('integrations.title')} subtitle={t('integrations.subtitle')} headerClass="bg-indigo-950" wide />
      <main className="px-6 -mt-10 relative z-20 pb-6 lg:max-w-2xl lg:mx-auto lg:w-full space-y-4">
        {list.error && (
          <ErrorState label={list.errorStatus === 403 ? t('integrations.forbidden') : t('auth.error')} />
        )}
        {list.loading && !items && <SkeletonCards count={3} label={t('common.loading')} />}
        {ordered.map((it) => (
          <ProviderCard key={it.provider} view={it} onChanged={() => setTick((x) => x + 1)} />
        ))}
      </main>
    </>
  );
}

function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'muted' | 'frozen'; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    ok: 'bg-sante-50 text-sante-700',
    warn: 'bg-ocre-50 text-ocre-600',
    muted: 'bg-stone-100 text-stone-500',
    frozen: 'bg-indigo-50 text-indigo-600',
  };
  return <span className={cn('px-2 py-0.5 card-pagne text-[0.59375rem] font-extrabold uppercase tracking-wide', tones[tone])}>{children}</span>;
}

function ProviderCard({ view, onChanged }: { view: IntegrationView; onChanged: () => void }) {
  const { t } = useLocale();
  const meta = PROVIDER_META[view.provider];
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [webhookUrl, setWebhookUrl] = useState<string>(
    typeof view.meta?.webhookUrl === 'string' ? view.meta.webhookUrl : '',
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; missing: string[] } | null>(null);
  const [showWh, setShowWh] = useState(false);

  const wh = useApi(
    () => (showWh && meta.supportsWebhooks ? integrationsApi.webhooks(view.provider) : Promise.resolve(null)),
    [showWh],
  );

  async function save() {
    // Le PUT REMPLACE le jeu complet : une clé obligatoire laissée vide serait effacée.
    // Refus avant tout envoi plutôt qu'un enregistrement partiel silencieux (I2).
    const secrets = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v !== ''));
    const missing = meta.fields.filter((f) => f.required && !secrets[f.key]).map((f) => f.key);
    if (missing.length) {
      setErr(`${t('integrations.missing')} : ${missing.join(', ')} — ${t('integrations.replace_warning')}`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const body: { secrets: Record<string, string>; meta?: Record<string, unknown> } = { secrets };
      if (meta.supportsWebhooks) body.meta = { ...(view.meta ?? {}), webhookUrl: webhookUrl.trim() || undefined };
      const saved = await integrationsApi.save(view.provider, body);
      // Réponse qui ne reflète pas la saisie : échec bruyant, formulaire conservé.
      const unconfirmed = unconfirmedKeys(secrets, saved);
      if (unconfirmed.length) {
        setErr(`${t('integrations.missing')} : ${unconfirmed.join(', ')}`);
        onChanged();
        return;
      }
      setEditing(false);
      setValues({});
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('auth.error'));
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    setBusy(true);
    setErr(null);
    try {
      await integrationsApi.toggle(view.provider, !view.enabled);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('auth.error'));
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setBusy(true);
    setErr(null);
    setTestResult(null);
    try {
      const res = await integrationsApi.test(view.provider);
      if ('ok' in res) setTestResult(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('auth.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CardPagne stitch={view.frozen ? 'indigo' : false} className="p-4">
      {/* En-tête : provider + statuts */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="font-display font-extrabold text-[1rem] text-stone-900">{view.provider}</p>
          <p className="text-[0.6875rem] text-stone-400">
            {t('integrations.updated')} {dt(view.updatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {view.frozen && <Badge tone="frozen">{t('integrations.frozen')}</Badge>}
          {view.unreadable && <Badge tone="warn">{t('integrations.unreadable')}</Badge>}
          <Badge tone={view.configured ? 'ok' : 'muted'}>{view.configured ? t('integrations.configured') : t('integrations.stub')}</Badge>
          <Badge tone={view.source === 'db' ? 'ok' : 'muted'}>{view.source === 'db' ? t('integrations.source_db') : t('integrations.source_env')}</Badge>
          {view.source === 'db' && <Badge tone={view.enabled ? 'ok' : 'warn'}>{view.enabled ? t('integrations.enabled') : t('integrations.disabled')}</Badge>}
        </div>
      </div>

      {/* Secrets masqués (jamais en clair) */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[0.75rem] mb-3">
        {meta.fields.map((f) => (
          <div key={f.key} className="flex items-center justify-between gap-2 min-w-0">
            <dt className="font-mono text-stone-400 truncate">{f.key}</dt>
            <dd className="font-mono font-bold text-stone-700">{view.secrets[f.key] ?? '—'}</dd>
          </div>
        ))}
      </dl>

      {err && <p className="text-[0.75rem] text-sos-600 font-bold mb-2">{err}</p>}

      {/* FedaPay : gérable (Lot E) mais chemin de paiement §5 — rappel + renvoi Finances. */}
      {view.provider === 'FEDAPAY' && !view.frozen && (
        <p className="text-[0.6875rem] text-indigo-700 bg-indigo-50 card-pagne px-3 py-2 mb-2">
          <span aria-hidden="true">🔒 </span>{t('integrations.fedapay_note')}
        </p>
      )}

      {view.frozen ? (
        <p className="text-[0.71875rem] text-indigo-700 bg-indigo-50 card-pagne px-3 py-2">
          <span aria-hidden="true">🔒 </span>{t('integrations.frozen_note')}
        </p>
      ) : (
        <>
          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="text-[0.71875rem] px-2.5 py-1" disabled={busy} onClick={runTest}>
              {busy ? t('integrations.testing') : t('integrations.test')}
            </Button>
            {!editing && (
              <Button variant="indigo" className="text-[0.71875rem] px-2.5 py-1" onClick={() => { setEditing(true); setErr(null); }}>
                {t('integrations.edit')}
              </Button>
            )}
            {view.source === 'db' && (
              <Button variant={view.enabled ? 'sos' : 'sante'} className="text-[0.71875rem] px-2.5 py-1" disabled={busy} onClick={toggle}>
                {view.enabled ? t('integrations.disable') : t('integrations.enable')}
              </Button>
            )}
            {meta.supportsWebhooks && (
              <button
                type="button"
                onClick={() => setShowWh((s) => !s)}
                className="text-[0.71875rem] font-display font-bold text-indigo-600 underline decoration-dotted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600 card-pagne px-1"
              >
                {t('integrations.webhooks')}
              </button>
            )}
          </div>

          {/* Résultat du test */}
          {testResult && (
            <p className={cn('mt-2 text-[0.75rem] font-bold', testResult.ok ? 'text-sante-700' : 'text-ocre-600')}>
              {testResult.ok
                ? `✓ ${t('integrations.ready')}`
                : `${t('integrations.missing')} : ${testResult.missing.join(', ')}`}
            </p>
          )}

          {/* Formulaire write-only */}
          {editing && (
            <div className="mt-3 space-y-2 border-t border-stone-100 pt-3">
              <p className="text-[0.6875rem] text-ocre-600 font-bold">{t('integrations.replace_warning')}</p>
              {meta.fields.map((f) => (
                <label key={f.key} className="block">
                  <span className="text-[0.6875rem] font-mono text-stone-500">
                    {f.key}{f.required && <span className="text-sos-500"> *</span>}
                  </span>
                  <input
                    type={f.plain ? 'text' : 'password'}
                    autoComplete="off"
                    spellCheck={false}
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    placeholder={view.secrets[f.key] ?? '—'}
                    className="mt-0.5 w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-base pagne-focus focus:outline-none focus:border-indigo-600"
                  />
                </label>
              ))}
              {meta.supportsWebhooks && (
                <label className="block">
                  <span className="text-[0.6875rem] font-mono text-stone-500">{t('integrations.webhook_url')}</span>
                  <input
                    type="url"
                    inputMode="url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://…"
                    className="mt-0.5 w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-base pagne-focus focus:outline-none focus:border-indigo-600"
                  />
                </label>
              )}
              <div className="flex items-center gap-2 pt-1">
                <Button variant="indigo" className="text-[0.75rem] px-3 py-1.5" disabled={busy} onClick={save}>
                  {busy ? t('integrations.saving') : t('integrations.save')}
                </Button>
                <Button variant="outline" className="text-[0.75rem] px-3 py-1.5" disabled={busy} onClick={() => { setEditing(false); setValues({}); setErr(null); }}>
                  {t('integrations.cancel')}
                </Button>
              </div>
            </div>
          )}

          {/* Journal des webhooks */}
          {showWh && meta.supportsWebhooks && (
            <div className="mt-3 border-t border-stone-100 pt-3">
              {view.meta?.webhookUrl ? (
                <p className="text-[0.6875rem] text-stone-500 font-mono truncate mb-2">{String(view.meta.webhookUrl)}</p>
              ) : null}
              {wh.loading && !wh.data && <SkeletonCards count={2} label={t('common.loading')} />}
              {wh.data && wh.data.data.length === 0 && <p className="text-[0.75rem] text-stone-400">{t('integrations.no_events')}</p>}
              {wh.data && wh.data.data.length > 0 && (
                <ul className="divide-y divide-stone-100">
                  {wh.data.data.map((e: WebhookJournalEntry) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 py-1.5 text-[0.71875rem]">
                      <span className="flex items-center gap-2 min-w-0">
                        <Badge tone={e.kind === 'webhook' ? 'ok' : 'muted'}>{e.kind}</Badge>
                        <span className="font-mono text-stone-500 truncate">{e.action}</span>
                      </span>
                      <span className="text-stone-400 whitespace-nowrap">{dt(e.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </CardPagne>
  );
}
