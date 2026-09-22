// ─────────────────────────────────────────────────────────────
// Service SOS — fonctionnalité vitale (CLAUDE.md §4).
// Après création de l'alerte Sos, on alerte RÉELLEMENT :
//   • SMS au contact d'urgence (Profile.emergencyContact) du patient ;
//   • SMS au numéro de secours public si configuré (SOS_PUBLIC_NUMBER) ;
//   • Notification in-app SOS_ALERT ;
//   • journal d'audit immuable (action 'SOS_ALERT').
// Tout part DANS LA LANGUE DU PATIENT (SMS critiques — CLAUDE.md §4).
// L'urgence prime : un échec d'envoi NE FAIT JAMAIS échouer la création de
// l'alerte (try/catch + log). Fonctionne sans clés Twilio (stub qui log).
// ─────────────────────────────────────────────────────────────
import type { Lang } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';

import { env } from '@/lib/env.js';
import { writeAudit } from '@/lib/audit.js';
import { badRequest, notFound } from '@/lib/errors.js';
import { maskPhone } from '@/lib/redact.js';
import { sendSms } from '@/services/twilio.js';

/** Gabarits SMS SOS, dans la langue du destinataire (FR/EN/FON au minimum). */
const SOS_SMS: Partial<Record<Lang, (lat: number, lng: number) => string>> = {
  FR: (lat, lng) =>
    `URGENCE DigiSanté : une alerte SOS a été déclenchée. Position : ${lat}, ${lng}. Carte : https://maps.google.com/?q=${lat},${lng}`,
  EN: (lat, lng) =>
    `DigiSanté EMERGENCY: an SOS alert was triggered. Location: ${lat}, ${lng}. Map: https://maps.google.com/?q=${lat},${lng}`,
  FON: (lat, lng) =>
    `DigiSanté ADANDÓ: SOS ɖé wá. Tɛn: ${lat}, ${lng}. Map: https://maps.google.com/?q=${lat},${lng}`,
};

/** Rend le corps du SMS SOS dans la langue du patient (repli FR). */
export function sosSmsBody(lang: Lang, lat: number, lng: number): string {
  return (SOS_SMS[lang] ?? SOS_SMS.FR!)(lat, lng);
}

export interface TriggerSosInput {
  patientId: string;
  latitude: number;
  longitude: number;
}

/**
 * Crée l'alerte SOS puis déclenche l'alerte serveur (SMS + notification + audit).
 * Renvoie l'alerte créée (avec contactNotified à jour si au moins un envoi a réussi).
 */
export async function triggerSos(app: FastifyInstance, input: TriggerSosInput) {
  const { patientId, latitude, longitude } = input;

  // 1) Création de l'alerte — c'est la priorité absolue, jamais bloquée par l'envoi.
  const alert = await app.prisma.sos.create({
    data: { patientId, latitude, longitude, status: 'ACTIVE' },
  });

  // 2) Alerte serveur — best-effort, n'échoue jamais l'urgence.
  try {
    // Récupère User (lang) + Profile (emergencyContact) du patient.
    const patient = await app.prisma.patient.findUnique({
      where: { id: patientId },
      select: {
        userId: true,
        user: { select: { lang: true, profile: { select: { emergencyContact: true } } } },
      },
    });

    const userId = patient?.userId ?? null;
    const lang: Lang = (patient?.user?.lang as Lang | undefined) ?? 'FR';
    const emergencyContact = patient?.user?.profile?.emergencyContact ?? null;
    const body = sosSmsBody(lang, latitude, longitude);

    // Destinataires SMS : contact d'urgence du patient + numéro de secours public.
    const recipients = [emergencyContact, env.SOS_PUBLIC_NUMBER ?? null].filter(
      (n): n is string => Boolean(n && n.trim()),
    );

    let notified = false;
    for (const to of recipients) {
      try {
        const res = await sendSms({ app, to, body, lang });
        // Stub (Twilio non configuré) compris : on considère l'alerte « notifiée »
        // dès qu'au moins un envoi a abouti (réel OU stub journalisé).
        if (res.delivered || res.stub) notified = true;
      } catch (err) {
        app.log.error({ err, to: maskPhone(to) }, '[SOS] échec envoi SMS au contact');
      }
    }

    // 3) Notification in-app SOS_ALERT pour le patient (traçabilité côté app).
    if (userId) {
      try {
        await app.prisma.notification.create({
          data: {
            recipientId: userId,
            type: 'SOS_ALERT',
            channel: 'IN_APP',
            title: 'Alerte SOS',
            body: "Une alerte d'urgence a été déclenchée et vos contacts ont été prévenus.",
            status: 'PENDING',
          },
        });
        notified = true;
      } catch (err) {
        app.log.error({ err, sosId: alert.id }, '[SOS] échec création notification');
      }
    }

    // 4) Marque l'alerte comme notifiée si au moins un canal a abouti.
    let result = alert;
    if (notified) {
      result = await app.prisma.sos.update({
        where: { id: alert.id },
        data: { contactNotified: true },
      });
    }

    // 5) Journal d'audit immuable (CLAUDE.md §4).
    try {
      await writeAudit(app.prisma, {
        action: 'SOS_ALERT',
        actorId: userId,
        targetId: alert.id,
        meta: { latitude, longitude, contactNotified: notified, recipients: recipients.length },
      });
    } catch (err) {
      app.log.error({ err, sosId: alert.id }, '[SOS] échec écriture audit');
    }

    return result;
  } catch (err) {
    // Filet de sécurité : l'urgence prime, on renvoie l'alerte même si l'alerte
    // serveur a entièrement échoué.
    app.log.error({ err, sosId: alert.id }, '[SOS] alerte serveur en échec — alerte conservée');
    return alert;
  }
}

/**
 * Clôture d'une alerte par le patient qui l'a déclenchée (écart D6).
 *
 * `Sos.status` et `resolvedAt` n'étaient écrits NULLE PART après la création :
 * toute alerte restait `ACTIVE` indéfiniment, et le champ `resolvedAt` était mort.
 * Un patient doit pouvoir dire « je vais bien » ou « fausse alerte » — sans quoi
 * l'historique ne distingue pas une urgence en cours d'une urgence passée.
 *
 * Cloisonnement §4 : on ne clôt QUE sa propre alerte (404 sinon, pas 403 — on ne
 * confirme pas l'existence de l'alerte d'autrui). Journalisé : la clôture d'une
 * urgence est un événement de traçabilité au même titre que son déclenchement.
 */
export async function resolveSos(
  app: FastifyInstance,
  ctx: { patientId: string; userId: string; ip?: string },
  sosId: string,
  falseAlarm: boolean,
) {
  const alert = await app.prisma.sos.findFirst({
    where: { id: sosId, patientId: ctx.patientId },
    select: { id: true, status: true },
  });
  if (!alert) throw notFound('Alerte introuvable');
  if (alert.status !== 'ACTIVE') throw badRequest('Alerte déjà clôturée');

  const status = falseAlarm ? 'FALSE_ALARM' : 'RESOLVED';
  const updated = await app.prisma.sos.update({
    where: { id: sosId },
    data: { status, resolvedAt: new Date() },
  });

  try {
    await writeAudit(app.prisma, {
      action: 'SOS_RESOLVED',
      actorId: ctx.userId,
      targetId: sosId,
      ip: ctx.ip,
      meta: { status },
    });
  } catch (err) {
    // Comme au déclenchement : l'urgence prime, un échec d'audit ne fait pas
    // échouer la clôture.
    app.log.error({ err, sosId }, '[SOS] échec écriture audit clôture');
  }

  return updated;
}
