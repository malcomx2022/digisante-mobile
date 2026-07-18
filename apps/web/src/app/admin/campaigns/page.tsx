'use client';

import { CONTENT_CATEGORIES, LANGS, ROLES, type ContentCategory, type Lang, type Role } from '@digisante/shared';
import { useEffect, useState } from 'react';

import { Button, CardPagne, ConfirmDialog } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { ErrorState, SkeletonCards } from '@/components/ui/States';
import { formatDateTime } from '@/i18n/format';
import { useLocale } from '@/i18n/LocaleProvider';
import { campaignsApi, type Campaign, type CampaignChannel } from '@/lib/api/campaigns';
import { useApi } from '@/lib/api/useApi';

const CHANNELS: CampaignChannel[] = ['IN_APP', 'SMS_TWILIO', 'PUSH_FCM'];
const inputClass =
  'mt-0.5 w-full bg-white card-pagne border border-stone-300 px-3 py-2 text-base pagne-focus focus:outline-none focus:border-indigo-600';

function dt(s: string | null): string {
  return s ? formatDateTime(s, { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

// D-26 — Diffusion / veille sanitaire (admin, scope campaigns:write). Broadcast
// ciblé (rôle/langue) réutilisant les Notification. NON médical, jamais de DMP (§4).
export default function AdminCampaigns() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const [creating, setCreating] = useState(false);
  const list = useApi(() => campaignsApi.list(), [tick]);
  const campaigns = list.data ?? [];

  return (
    <>
      <SpaceHeader title={t('admin.campaigns')} subtitle={t('campaigns.subtitle')} headerClass="bg-indigo-950" wide />
      <main className="px-6 -mt-10 relative z-20 pb-6 lg:max-w-2xl lg:mx-auto lg:w-full space-y-4">
        <p className="text-[0.6875rem] text-indigo-700 bg-indigo-50 card-pagne px-3 py-2">{t('campaigns.notice')}</p>

        {!creating && (
          <Button variant="indigo" className="text-[0.8125rem]" onClick={() => setCreating(true)}>
            + {t('campaigns.new')}
          </Button>
        )}
        {creating && (
          <CampaignForm
            onDone={() => {
              setCreating(false);
              setTick((x) => x + 1);
            }}
            onCancel={() => setCreating(false)}
          />
        )}

        {list.error && <ErrorState label={list.errorStatus === 403 ? t('campaigns.forbidden') : t('auth.error')} />}
        {list.loading && !list.data && <SkeletonCards count={2} label={t('common.loading')} />}

        {campaigns.map((c) => (
          <CampaignCard key={c.id} campaign={c} onChanged={() => setTick((x) => x + 1)} />
        ))}
        {list.data && campaigns.length === 0 && !creating && (
          <p className="text-[0.8125rem] text-stone-500 text-center py-6">{t('campaigns.empty')}</p>
        )}
      </main>
    </>
  );
}

function CampaignCard({ campaign, onChanged }: { campaign: Campaign; onChanged: () => void }) {
  const { t } = useLocale();
  const [confirmSend, setConfirmSend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sent = campaign.status === 'SENT';

  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      await campaignsApi.send(campaign.id);
      onChanged();
    } catch {
      setErr(t('campaigns.send_error'));
    } finally {
      setBusy(false);
      setConfirmSend(false);
    }
  };

  return (
    <CardPagne className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display font-bold text-stone-800">{campaign.translations.FR.title}</p>
          <p className="text-[0.6875rem] text-stone-500 mt-0.5">
            {t(`campaigns.cat.${campaign.category}`)} ·{' '}
            {campaign.audienceRole ? t(`role.${campaign.audienceRole}` as `role.${Role}`) : t('campaigns.all_roles')} ·{' '}
            {campaign.audienceLang ?? t('campaigns.all_langs')} · {campaign.channel}
          </p>
        </div>
        <span
          className={`px-2 py-0.5 card-pagne text-[0.59375rem] font-extrabold uppercase ${
            sent ? 'bg-sante-50 text-sante-700' : 'bg-ocre-50 text-ocre-600'
          }`}
        >
          {sent ? t('campaigns.status.SENT') : t('campaigns.status.DRAFT')}
        </span>
      </div>
      <p className="text-[0.8125rem] text-stone-600 mt-2 line-clamp-2">{campaign.translations.FR.body}</p>
      {sent ? (
        <p className="text-[0.6875rem] text-stone-500 mt-2">
          {t('campaigns.sent_to', { count: String(campaign.audienceCount) })} · {dt(campaign.sentAt)}
        </p>
      ) : (
        <div className="flex items-center gap-2 mt-3">
          <Button variant="indigo" className="text-[0.75rem] px-3 py-1.5" disabled={busy} onClick={() => setConfirmSend(true)}>
            {t('campaigns.send')}
          </Button>
        </div>
      )}
      {err && <p className="text-[0.6875rem] text-sos-500 mt-1">{err}</p>}
      <ConfirmDialog
        open={confirmSend}
        title={t('campaigns.confirm_title')}
        message={t('campaigns.confirm_msg')}
        confirmLabel={t('campaigns.send')}
        cancelLabel={t('campaigns.cancel')}
        onConfirm={send}
        onCancel={() => setConfirmSend(false)}
      />
    </CardPagne>
  );
}

function CampaignForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { t } = useLocale();
  const [category, setCategory] = useState<ContentCategory>('PREVENTION');
  const [audienceRole, setAudienceRole] = useState<Role | ''>('');
  const [audienceLang, setAudienceLang] = useState<Lang | ''>('');
  const [channel, setChannel] = useState<CampaignChannel>('IN_APP');
  const [frTitle, setFrTitle] = useState('');
  const [frBody, setFrBody] = useState('');
  const [enTitle, setEnTitle] = useState('');
  const [enBody, setEnBody] = useState('');
  const [reach, setReach] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Aperçu de la portée à chaque changement de ciblage.
  useEffect(() => {
    let cancelled = false;
    campaignsApi
      .audience({ audienceRole: audienceRole || undefined, audienceLang: audienceLang || undefined })
      .then((r) => !cancelled && setReach(r.audienceCount))
      .catch(() => !cancelled && setReach(null));
    return () => {
      cancelled = true;
    };
  }, [audienceRole, audienceLang]);

  const valid = frTitle.trim().length > 0 && frBody.trim().length > 0;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      const translations = {
        FR: { title: frTitle.trim(), body: frBody.trim() },
        ...(enTitle.trim() && enBody.trim() ? { EN: { title: enTitle.trim(), body: enBody.trim() } } : {}),
      };
      await campaignsApi.create({
        category,
        translations,
        audienceRole: audienceRole || null,
        audienceLang: audienceLang || null,
        channel,
      });
      onDone();
    } catch {
      setErr(t('campaigns.save_error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CardPagne className="p-4 space-y-2">
      <p className="font-display font-bold text-stone-800">{t('campaigns.new')}</p>

      <label className="block">
        <span className="text-[0.6875rem] font-bold text-stone-500">{t('campaigns.category')}</span>
        <select value={category} onChange={(e) => setCategory(e.target.value as ContentCategory)} className={inputClass}>
          {CONTENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`campaigns.cat.${c}`)}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[0.6875rem] font-bold text-stone-500">{t('campaigns.audience_role')}</span>
          <select value={audienceRole} onChange={(e) => setAudienceRole(e.target.value as Role | '')} className={inputClass}>
            <option value="">{t('campaigns.all_roles')}</option>
            {ROLES.filter((r) => r !== 'ADMIN').map((r) => (
              <option key={r} value={r}>
                {t(`role.${r}` as `role.${Role}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[0.6875rem] font-bold text-stone-500">{t('campaigns.audience_lang')}</span>
          <select value={audienceLang} onChange={(e) => setAudienceLang(e.target.value as Lang | '')} className={inputClass}>
            <option value="">{t('campaigns.all_langs')}</option>
            {LANGS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-[0.6875rem] font-bold text-stone-500">{t('campaigns.channel')}</span>
        <select value={channel} onChange={(e) => setChannel(e.target.value as CampaignChannel)} className={inputClass}>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      <p className="text-[0.6875rem] text-indigo-700 bg-indigo-50 card-pagne px-3 py-2">
        {reach === null ? t('campaigns.reach_unknown') : t('campaigns.reach', { count: String(reach) })}
      </p>

      <div className="border-t border-stone-100 pt-2">
        <span className="text-[0.6875rem] font-bold text-stone-500">{t('campaigns.fr_content')} *</span>
        <input value={frTitle} onChange={(e) => setFrTitle(e.target.value)} placeholder={t('campaigns.title_ph')} className={inputClass} />
        <textarea value={frBody} onChange={(e) => setFrBody(e.target.value)} placeholder={t('campaigns.body_ph')} rows={3} className={`${inputClass} mt-1`} />
      </div>

      <div className="border-t border-stone-100 pt-2">
        <span className="text-[0.6875rem] font-bold text-stone-500">{t('campaigns.en_content')}</span>
        <input value={enTitle} onChange={(e) => setEnTitle(e.target.value)} placeholder={t('campaigns.title_ph')} className={inputClass} />
        <textarea value={enBody} onChange={(e) => setEnBody(e.target.value)} placeholder={t('campaigns.body_ph')} rows={3} className={`${inputClass} mt-1`} />
        <p className="text-[0.625rem] text-stone-400 mt-1">{t('campaigns.lang_fallback')}</p>
      </div>

      {err && <p className="text-[0.6875rem] text-sos-500">{err}</p>}
      <div className="flex items-center gap-2 pt-1">
        <Button variant="indigo" className="text-[0.75rem] px-3 py-1.5" disabled={busy || !valid} onClick={save}>
          {busy ? t('campaigns.saving') : t('campaigns.save_draft')}
        </Button>
        <Button variant="outline" className="text-[0.75rem] px-3 py-1.5" disabled={busy} onClick={onCancel}>
          {t('campaigns.cancel')}
        </Button>
      </div>
    </CardPagne>
  );
}
