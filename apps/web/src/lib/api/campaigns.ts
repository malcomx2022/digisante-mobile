// Admin : diffusion / veille sanitaire (broadcast ciblé aux utilisateurs).
// NON médical (message de santé publique) — jamais de contenu DMP (§4).
import type { ContentCategory, Lang, Role } from '@digisante/shared';

import { del, get, post, put } from './client';

export type CampaignStatus = 'DRAFT' | 'SENT';
export type CampaignChannel = 'IN_APP' | 'SMS_TWILIO' | 'PUSH_FCM' | 'EMAIL';

export interface CampaignText {
  title: string;
  body: string;
}
export type CampaignTranslations = { FR: CampaignText } & Partial<Record<Lang, CampaignText>>;

export interface Campaign {
  id: string;
  category: ContentCategory;
  translations: CampaignTranslations;
  audienceRole: Role | null;
  audienceLang: Lang | null;
  channel: CampaignChannel;
  status: CampaignStatus;
  audienceCount: number;
  sentAt: string | null;
  createdAt: string;
}

export interface CampaignInput {
  category: ContentCategory;
  translations: CampaignTranslations;
  audienceRole?: Role | null;
  audienceLang?: Lang | null;
  channel?: CampaignChannel;
}

export const campaignsApi = {
  list: () => get<Campaign[]>('/admin/campaigns'),
  get: (id: string) => get<Campaign>(`/admin/campaigns/${id}`),
  audience: (q: { audienceRole?: Role; audienceLang?: Lang; channel?: CampaignChannel }) => {
    const params = new URLSearchParams();
    if (q.audienceRole) params.set('audienceRole', q.audienceRole);
    if (q.audienceLang) params.set('audienceLang', q.audienceLang);
    // EMAIL : la portée ne compte que les comptes ayant une adresse e-mail.
    if (q.channel) params.set('channel', q.channel);
    const qs = params.toString();
    return get<{ audienceCount: number }>(`/admin/campaigns/audience${qs ? `?${qs}` : ''}`);
  },
  create: (body: CampaignInput) => post<Campaign>('/admin/campaigns', body),
  update: (id: string, body: CampaignInput) => put<Campaign>(`/admin/campaigns/${id}`, body),
  remove: (id: string) => del<{ removed: boolean }>(`/admin/campaigns/${id}`),
  send: (id: string) => post<{ audienceCount: number }>(`/admin/campaigns/${id}/send`),
};
