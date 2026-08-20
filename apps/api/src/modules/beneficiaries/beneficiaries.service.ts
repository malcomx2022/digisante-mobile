// ─────────────────────────────────────────────────────────────
// Service Bénéficiaires : carnet des proches au Bénin gérés par la DIASPORA,
// et ENVOI D'ARGENT vers le portefeuille d'un proche (écart E3).
//
// ⚠️ §5 non concerné : l'envoi est un mouvement INTERNE au registre des
// portefeuilles (`wallet.transfer`) — aucun appel FedaPay, aucun `Payment`.
//
// ⚠️ §4 — le payeur n'obtient AUCUN accès médical : il envoie de l'argent, le
// proche le dépense lui-même pour ses propres soins. Le payeur ne voit ni les
// rendez-vous, ni le médecin, ni la spécialité (qui trahirait la pathologie).
// ─────────────────────────────────────────────────────────────
import { normalizeBeninPhone } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';

import { writeAudit } from '@/lib/audit.js';
import { badRequest, notFound } from '@/lib/errors.js';
import * as wallet from '@/modules/wallet/wallet.service.js';

// Réforme ARCEP 2024 : canonicaliser le numéro d'un proche (8 → 10 chiffres).
// Les numéros diaspora (autre indicatif) sont laissés intacts par le helper.
const normPhone = (phone?: string): string | null => (phone ? normalizeBeninPhone(phone) : null);

interface BeneficiaryInput {
  name: string;
  relationship?: string;
  phone?: string;
  languagesSpoken?: string[];
  notes?: string;
}

const SELECT = {
  id: true,
  name: true,
  relationship: true,
  phone: true,
  languagesSpoken: true,
  notes: true,
  createdAt: true,
} as const;

/**
 * Résout les comptes DigiSanté joignables parmi une liste de numéros.
 *
 * Résolution **à la volée** plutôt que via une colonne `linkedUserId` : un
 * proche qui s'inscrit APRÈS avoir été ajouté au carnet devient joignable sans
 * qu'on ait à ré-appareiller quoi que ce soit, et il n'y a pas de lien figé qui
 * se périme. Le numéro est déjà canonicalisé à l'écriture (`normPhone`).
 */
async function resolveReachable(app: FastifyInstance, phones: string[]): Promise<Map<string, string>> {
  const known = phones.filter(Boolean);
  if (known.length === 0) return new Map();
  const users = await app.prisma.user.findMany({
    where: { phone: { in: known }, status: 'ACTIVE' },
    select: { id: true, phone: true },
  });
  return new Map(users.map((u) => [u.phone, u.id]));
}

/**
 * Liste les proches du membre de la diaspora courant.
 *
 * `canReceive` dit UNIQUEMENT si un envoi est possible — jamais qui est le
 * compte en face (ni identifiant, ni nom, ni rôle). Minimisation §4 : le payeur
 * a besoin de savoir s'il peut envoyer, pas de se voir confirmer une identité.
 */
export async function listMine(app: FastifyInstance, ownerId: string) {
  const rows = await app.prisma.beneficiary.findMany({ where: { ownerId }, select: SELECT, orderBy: { createdAt: 'asc' } });
  const reachable = await resolveReachable(app, rows.map((r) => r.phone).filter((p): p is string => Boolean(p)));
  return rows.map((r) => ({ ...r, canReceive: Boolean(r.phone && reachable.has(r.phone)) }));
}

/** Ajoute un proche. */
export async function addMine(app: FastifyInstance, ownerId: string, input: BeneficiaryInput) {
  return app.prisma.beneficiary.create({
    data: {
      ownerId,
      name: input.name,
      relationship: input.relationship ?? null,
      phone: normPhone(input.phone),
      languagesSpoken: input.languagesSpoken ?? [],
      notes: input.notes ?? null,
    },
    select: SELECT,
  });
}

/** Vérifie la propriété d'un proche (sinon 404 — pas de fuite d'existence). */
async function assertOwned(app: FastifyInstance, ownerId: string, id: string) {
  const row = await app.prisma.beneficiary.findFirst({ where: { id, ownerId }, select: { id: true } });
  if (!row) throw notFound('Proche introuvable');
}

/** Met à jour un proche (propriété vérifiée). */
export async function updateMine(app: FastifyInstance, ownerId: string, id: string, input: BeneficiaryInput) {
  await assertOwned(app, ownerId, id);
  return app.prisma.beneficiary.update({
    where: { id },
    data: {
      name: input.name,
      relationship: input.relationship ?? null,
      phone: normPhone(input.phone),
      languagesSpoken: input.languagesSpoken ?? [],
      notes: input.notes ?? null,
    },
    select: SELECT,
  });
}

/** Supprime un proche (propriété vérifiée). */
export async function removeMine(app: FastifyInstance, ownerId: string, id: string) {
  await assertOwned(app, ownerId, id);
  await app.prisma.beneficiary.delete({ where: { id } });
  return { id, deleted: true };
}

function transferText(lang: string, senderName: string, amount: number): { title: string; body: string } {
  return lang === 'EN'
    ? { title: 'Money received', body: `${senderName} sent you ${amount} XOF for your care.` }
    : { title: 'Argent reçu', body: `${senderName} vous a envoyé ${amount} XOF pour vos soins.` };
}

/**
 * Envoie de l'argent à un proche du carnet (écart E3).
 *
 * Contrôles, dans l'ordre :
 *  1. le proche appartient bien au carnet de l'appelant (404 sinon — on ne
 *     confirme pas l'existence d'une fiche d'autrui) ;
 *  2. il porte un numéro et ce numéro correspond à un compte ACTIF ;
 *  3. `wallet.transfer` débite et crédite dans UNE transaction.
 *
 * Le destinataire est notifié **dans SA langue** (§4). L'audit ne porte que des
 * métadonnées — jamais les `notes` du carnet, qui sont du texte libre saisi par
 * le payeur et n'ont pas à finir dans un registre lu par l'admin.
 */
export async function sendMoney(
  app: FastifyInstance,
  ownerId: string,
  beneficiaryId: string,
  amount: number,
) {
  const beneficiary = await app.prisma.beneficiary.findFirst({
    where: { id: beneficiaryId, ownerId },
    select: { id: true, name: true, phone: true },
  });
  if (!beneficiary) throw notFound('Proche introuvable');
  if (!beneficiary.phone) throw badRequest('Ce proche n’a pas de numéro de téléphone');

  const recipient = await app.prisma.user.findFirst({
    where: { phone: beneficiary.phone, status: 'ACTIVE' },
    select: { id: true, lang: true },
  });
  if (!recipient) throw badRequest('Ce proche n’a pas encore de compte DigiSanté');

  const sender = await app.prisma.user.findUniqueOrThrow({
    where: { id: ownerId },
    select: { profile: { select: { firstName: true, lastName: true } } },
  });
  const senderName = sender.profile ? `${sender.profile.firstName} ${sender.profile.lastName}` : 'Un proche';

  const result = await wallet.transfer(app, ownerId, recipient.id, amount, `Envoi à ${beneficiary.name}`);

  const { title, body } = transferText(recipient.lang, senderName, amount);
  await app.prisma.notification.create({
    data: { recipientId: recipient.id, type: 'SYSTEM', channel: 'IN_APP', title, body, status: 'PENDING' },
  });

  await writeAudit(app.prisma, {
    action: 'WALLET_TRANSFER',
    actorId: ownerId,
    targetId: recipient.id,
    meta: { beneficiaryId: beneficiary.id, amount, reference: result.reference },
  });

  return { sent: true, balance: result.balance, reference: result.reference };
}
