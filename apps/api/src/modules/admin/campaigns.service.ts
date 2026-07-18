// ─────────────────────────────────────────────────────────────
// Diffusion / veille sanitaire (admin) — CLAUDE.md §1. Une campagne est rédigée
// (DRAFT) en plusieurs langues, ciblée par rôle et/ou langue, puis DIFFUSÉE une
// seule fois : fan-out de Notification PENDING par destinataire DANS SA LANGUE
// (§4 : notif/SMS toujours dans la langue du destinataire ; repli FR).
// NON médical (message de santé publique) — JAMAIS de contenu DMP.
// ─────────────────────────────────────────────────────────────
import { LANGS, type CampaignStatus, type Lang } from '@digisante/shared';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { writeAudit } from '@/lib/audit.js';
import { badRequest, notFound } from '@/lib/errors.js';

/** Un contenu de campagne dans une langue. */
export interface CampaignText {
  title: string;
  body: string;
}
/** Table des traductions ; FR obligatoire (source de vérité). */
export type CampaignTranslations = { FR: CampaignText } & Partial<Record<Lang, CampaignText>>;

export interface CampaignInput {
  category: string;
  translations: CampaignTranslations;
  audienceRole?: string | null;
  audienceLang?: string | null;
  channel?: 'IN_APP' | 'SMS_TWILIO' | 'PUSH_FCM' | 'EMAIL';
}

const campaignSelect = {
  id: true,
  category: true,
  translations: true,
  audienceRole: true,
  audienceLang: true,
  channel: true,
  status: true,
  audienceCount: true,
  sentAt: true,
  createdAt: true,
} as const;

/** Contenu localisé pour une langue donnée (repli FR — jamais de trou). */
function pickText(translations: CampaignTranslations, lang: Lang): CampaignText {
  return translations[lang] ?? translations.FR;
}

/** Clause d'audience : uniquement les comptes ACTIFS, filtrés rôle/langue. */
function audienceWhere(audienceRole: string | null, audienceLang: string | null): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = { status: 'ACTIVE' };
  if (audienceRole) where.role = audienceRole as Prisma.UserWhereInput['role'];
  if (audienceLang) where.lang = audienceLang as Prisma.UserWhereInput['lang'];
  return where;
}

export async function listCampaigns(app: FastifyInstance) {
  return app.prisma.healthCampaign.findMany({ orderBy: { createdAt: 'desc' }, take: 100, select: campaignSelect });
}

export async function getCampaign(app: FastifyInstance, id: string) {
  const c = await app.prisma.healthCampaign.findUnique({ where: { id }, select: campaignSelect });
  if (!c) throw notFound('Campagne introuvable');
  return c;
}

/** Nombre de destinataires que la campagne toucherait (aperçu avant diffusion). */
export async function previewAudience(app: FastifyInstance, audienceRole: string | null, audienceLang: string | null) {
  const count = await app.prisma.user.count({ where: audienceWhere(audienceRole, audienceLang) });
  return { audienceCount: count };
}

export async function createCampaign(app: FastifyInstance, actorId: string, input: CampaignInput) {
  return app.prisma.healthCampaign.create({
    data: {
      category: input.category,
      translations: input.translations as unknown as Prisma.InputJsonValue,
      audienceRole: (input.audienceRole ?? null) as Prisma.HealthCampaignCreateInput['audienceRole'],
      audienceLang: (input.audienceLang ?? null) as Prisma.HealthCampaignCreateInput['audienceLang'],
      channel: input.channel ?? 'IN_APP',
      createdById: actorId,
    },
    select: campaignSelect,
  });
}

/** Met à jour un brouillon (interdit après diffusion — la campagne est figée). */
export async function updateCampaign(app: FastifyInstance, id: string, input: CampaignInput) {
  const existing = await app.prisma.healthCampaign.findUnique({ where: { id }, select: { status: true } });
  if (!existing) throw notFound('Campagne introuvable');
  if (existing.status === 'SENT') throw badRequest('Campagne déjà diffusée (non modifiable)');
  return app.prisma.healthCampaign.update({
    where: { id },
    data: {
      category: input.category,
      translations: input.translations as unknown as Prisma.InputJsonValue,
      audienceRole: (input.audienceRole ?? null) as Prisma.HealthCampaignUpdateInput['audienceRole'],
      audienceLang: (input.audienceLang ?? null) as Prisma.HealthCampaignUpdateInput['audienceLang'],
      channel: input.channel ?? 'IN_APP',
    },
    select: campaignSelect,
  });
}

export async function deleteCampaign(app: FastifyInstance, id: string) {
  const existing = await app.prisma.healthCampaign.findUnique({ where: { id }, select: { status: true } });
  if (!existing) throw notFound('Campagne introuvable');
  if (existing.status === 'SENT') throw badRequest('Campagne déjà diffusée (non supprimable)');
  await app.prisma.healthCampaign.delete({ where: { id } });
  return { removed: true };
}

/**
 * Diffuse la campagne : crée une Notification PENDING par destinataire dans SA
 * langue (repli FR), passe la campagne en SENT. Idempotent au sens « une seule
 * diffusion » : une campagne déjà SENT est refusée (400). Le dispatch existant
 * (cron) enverra ensuite chaque Notification via son canal.
 */
export async function sendCampaign(
  app: FastifyInstance,
  id: string,
  actor: { id: string; ip?: string | null },
): Promise<{ audienceCount: number }> {
  const campaign = await app.prisma.healthCampaign.findUnique({ where: { id } });
  if (!campaign) throw notFound('Campagne introuvable');
  if (campaign.status === 'SENT') throw badRequest('Campagne déjà diffusée');

  const translations = campaign.translations as unknown as CampaignTranslations;
  if (!translations?.FR?.title || !translations.FR.body) throw badRequest('Traduction FR (titre + corps) obligatoire');

  const recipients = await app.prisma.user.findMany({
    where: audienceWhere(campaign.audienceRole, campaign.audienceLang),
    select: { id: true, lang: true },
  });

  if (recipients.length > 0) {
    const now = new Date();
    await app.prisma.notification.createMany({
      data: recipients.map((r) => {
        const text = pickText(translations, r.lang as Lang);
        return {
          recipientId: r.id,
          type: 'SYSTEM' as const,
          channel: campaign.channel,
          title: text.title,
          body: text.body,
          status: 'PENDING' as const,
          scheduledAt: now,
        };
      }),
    });
  }

  const updated = await app.prisma.healthCampaign.update({
    where: { id },
    data: { status: 'SENT' satisfies CampaignStatus as CampaignStatus, sentAt: new Date(), audienceCount: recipients.length },
    select: campaignSelect,
  });

  // Audit : on ne journalise QUE des métadonnées (jamais le contenu médical/DMP).
  await writeAudit(app.prisma, {
    action: 'CAMPAIGN_SENT',
    actorId: actor.id,
    targetId: id,
    ip: actor.ip ?? null,
    meta: {
      category: campaign.category,
      channel: campaign.channel,
      audienceRole: campaign.audienceRole,
      audienceLang: campaign.audienceLang,
      audienceCount: recipients.length,
    },
  });

  return { audienceCount: updated.audienceCount };
}

/** Langues supportées (pour l'édition côté client). */
export const CAMPAIGN_LANGS = LANGS;
