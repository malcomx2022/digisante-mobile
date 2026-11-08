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

import { writeAuditWithin } from '@/lib/audit.js';
import { badRequest, notFound } from '@/lib/errors.js';

/** Un contenu de campagne dans une langue. */
export interface CampaignText {
  title: string;
  body: string;
}
/** Table des traductions ; FR obligatoire (source de vérité). */
export type CampaignTranslations = { FR: CampaignText } & Partial<Record<Lang, CampaignText>>;

/** Canaux de diffusion d'une campagne (tous traités par le dispatch des Notification). */
export const CAMPAIGN_CHANNELS = ['IN_APP', 'SMS_TWILIO', 'PUSH_FCM', 'EMAIL'] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

export interface CampaignInput {
  category: string;
  translations: CampaignTranslations;
  audienceRole?: string | null;
  audienceLang?: string | null;
  channel?: CampaignChannel;
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

/**
 * Clause d'audience : uniquement les comptes ACTIFS, filtrés rôle/langue. Pour le
 * canal EMAIL, seuls les comptes ayant une adresse e-mail : sans elle le dispatch
 * ne peut rien envoyer, et compter ces comptes gonflerait la portée annoncée.
 * Le rôle ADMIN est une audience comme une autre (message non médical, §4).
 */
function audienceWhere(audienceRole: string | null, audienceLang: string | null, channel: string = 'IN_APP'): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = { status: 'ACTIVE' };
  if (audienceRole) where.role = audienceRole as Prisma.UserWhereInput['role'];
  if (audienceLang) where.lang = audienceLang as Prisma.UserWhereInput['lang'];
  if (channel === 'EMAIL') where.email = { not: null };
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
export async function previewAudience(
  app: FastifyInstance,
  audienceRole: string | null,
  audienceLang: string | null,
  channel: CampaignChannel = 'IN_APP',
) {
  const count = await app.prisma.user.count({ where: audienceWhere(audienceRole, audienceLang, channel) });
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
  // Conditionnel : une diffusion concurrente gagne, le contenu envoyé reste figé.
  const changed = await app.prisma.healthCampaign.updateMany({
    where: { id, status: 'DRAFT' },
    data: {
      category: input.category,
      translations: input.translations as unknown as Prisma.InputJsonValue,
      audienceRole: (input.audienceRole ?? null) as Prisma.HealthCampaignUpdateInput['audienceRole'],
      audienceLang: (input.audienceLang ?? null) as Prisma.HealthCampaignUpdateInput['audienceLang'],
      channel: input.channel ?? 'IN_APP',
    } as Prisma.HealthCampaignUpdateManyMutationInput,
  });
  if (changed.count !== 1) throw badRequest('Campagne déjà diffusée (non modifiable)');
  return app.prisma.healthCampaign.findUniqueOrThrow({ where: { id }, select: campaignSelect });
}

export async function deleteCampaign(app: FastifyInstance, id: string) {
  const existing = await app.prisma.healthCampaign.findUnique({ where: { id }, select: { status: true } });
  if (!existing) throw notFound('Campagne introuvable');
  if (existing.status === 'SENT') throw badRequest('Campagne déjà diffusée (non supprimable)');
  const removed = await app.prisma.healthCampaign.deleteMany({ where: { id, status: 'DRAFT' } });
  if (removed.count !== 1) throw badRequest('Campagne déjà diffusée (non supprimable)');
  return { removed: true };
}

/** Taille d'un lot de création de notifications (borne mémoire et requête). */
export const CAMPAIGN_BATCH_SIZE = 500;

/**
 * Diffuse la campagne : crée une Notification PENDING par destinataire dans SA
 * langue (repli FR), passe la campagne en SENT. Une SEULE diffusion, même sous
 * double clic ou deux workers : la transition DRAFT → SENT est CONDITIONNELLE et
 * ouvre la transaction ; le perdant reçoit 400 sans rien créer. Destinataires
 * parcourus par curseur et notifications créées par lots (pas de `createMany`
 * non borné) ; tout est atomique : un échec annule statut, notifications et
 * audit. Le dispatch existant (cron) enverra ensuite chaque Notification.
 */
export async function sendCampaign(
  app: FastifyInstance,
  id: string,
  actor: { id: string; ip?: string | null },
  opts: { batchSize?: number } = {},
): Promise<{ audienceCount: number }> {
  const campaign = await app.prisma.healthCampaign.findUnique({ where: { id } });
  if (!campaign) throw notFound('Campagne introuvable');
  if (campaign.status === 'SENT') throw badRequest('Campagne déjà diffusée');

  const translations = campaign.translations as unknown as CampaignTranslations;
  if (!translations?.FR?.title || !translations.FR.body) throw badRequest('Traduction FR (titre + corps) obligatoire');
  const batchSize = opts.batchSize ?? CAMPAIGN_BATCH_SIZE;

  const audienceCount = await app.prisma.$transaction(async (tx) => {
    const claimed = await tx.healthCampaign.updateMany({
      where: { id, status: 'DRAFT' },
      data: { status: 'SENT' satisfies CampaignStatus as CampaignStatus, sentAt: new Date() },
    });
    if (claimed.count !== 1) throw badRequest('Campagne déjà diffusée');
    // Contenu relu APRÈS la prise : c'est exactement ce qui part (aucune édition possible ensuite).
    const frozen = await tx.healthCampaign.findUniqueOrThrow({ where: { id } });
    const frozenTexts = frozen.translations as unknown as CampaignTranslations;
    if (!frozenTexts?.FR?.title || !frozenTexts.FR.body) throw badRequest('Traduction FR (titre + corps) obligatoire');

    const now = new Date();
    let count = 0;
    let cursor: string | undefined;
    for (;;) {
      const batch = await tx.user.findMany({
        where: audienceWhere(frozen.audienceRole, frozen.audienceLang, frozen.channel),
        select: { id: true, lang: true },
        orderBy: { id: 'asc' },
        take: batchSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (batch.length === 0) break;
      await tx.notification.createMany({
        data: batch.map((r) => {
          const text = pickText(frozenTexts, r.lang as Lang);
          return {
            recipientId: r.id,
            type: 'SYSTEM' as const,
            channel: frozen.channel,
            title: text.title,
            body: text.body,
            status: 'PENDING' as const,
            scheduledAt: now,
          };
        }),
      });
      count += batch.length;
      cursor = batch[batch.length - 1]!.id;
      if (batch.length < batchSize) break;
    }

    await tx.healthCampaign.update({ where: { id }, data: { audienceCount: count } });
    // Audit : métadonnées seulement (jamais le contenu), dans la même transaction.
    await writeAuditWithin(tx, {
      action: 'CAMPAIGN_SENT',
      actorId: actor.id,
      targetId: id,
      ip: actor.ip ?? null,
      meta: {
        category: frozen.category,
        channel: frozen.channel,
        audienceRole: frozen.audienceRole,
        audienceLang: frozen.audienceLang,
        audienceCount: count,
      },
    });
    return count;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 120_000 });

  return { audienceCount };
}

/** Langues supportées (pour l'édition côté client). */
export const CAMPAIGN_LANGS = LANGS;
