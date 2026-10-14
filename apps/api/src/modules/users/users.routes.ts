// ─────────────────────────────────────────────────────────────
// Routes Utilisateurs (préfixe /api/v1/users) — profil de l'utilisateur courant.
// Langues parlées (spokenLangs) éditables ici (🗣 fiche personne, CLAUDE.md §5).
// ─────────────────────────────────────────────────────────────
import { langSchema, normalizeBeninPhone } from '@digisante/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { forbidden, notFound } from '@/lib/errors.js';
import { requireRole } from '@/lib/rbac.js';
import { zParse } from '@/lib/validation.js';
import { registerDevice } from './users.devices.service.js';

const deviceSchema = z.object({
  fcmToken: z.string().trim().min(1).max(512),
});

// Fiche médicale d'urgence (vitale en cas de SOS) — données du patient.
const medicalSchema = z.object({
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
  allergies: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  chronicDiseases: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  insuranceNumber: z.string().trim().max(60).optional(),
  emergencyContact: z.string().trim().max(80).optional(),
});

const updateMeSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  dateOfBirth: z.coerce.date().optional(),
  gender: z.string().max(40).optional(),
  address: z.string().max(255).optional(),
  emergencyContact: z.string().max(80).optional(),
  avatarUrl: z.string().url().optional(),
  spokenLangs: z.array(langSchema).max(5).optional(),
  lang: langSchema.optional(),
});

const meInclude = {
  profile: true,
  patient: { select: { id: true, bloodGroup: true } },
  // consultFee/slotDuration/bio : ses PROPRES champs éditables — nécessaires pour
  // préremplir la fiche professionnelle (`PATCH /professionals/me`, écart D4).
  doctor: { select: { id: true, speciality: true, verifiedAt: true, consultFee: true, slotDuration: true, bio: true } },
} as const;

export default async function usersRoutes(app: FastifyInstance) {
  // Profil complet de l'utilisateur courant.
  app.get('/me', { preHandler: [app.authenticate] }, async (request) => {
    const me = await app.prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { id: true, phone: true, email: true, role: true, status: true, lang: true, ...meInclude },
    });
    if (!me) throw notFound('Utilisateur introuvable');
    return me;
  });

  // Mise à jour du profil + langue d'UI + langues parlées.
  app.patch('/me', { preHandler: [app.authenticate] }, async (request) => {
    const input = zParse(updateMeSchema, request.body);
    const { lang, ...profileFields } = input;
    // Réforme ARCEP 2024 : canonicaliser le contact d'urgence (les numéros
    // diaspora sont laissés intacts par le helper).
    if (profileFields.emergencyContact !== undefined) {
      profileFields.emergencyContact = normalizeBeninPhone(profileFields.emergencyContact);
    }

    const updated = await app.prisma.user.update({
      where: { id: request.user.sub },
      data: {
        ...(lang ? { lang } : {}),
        ...(Object.keys(profileFields).length > 0
          ? { profile: { update: profileFields } }
          : {}),
      },
      select: { id: true, phone: true, email: true, role: true, status: true, lang: true, ...meInclude },
    });
    return updated;
  });

  // Enregistrement du token push FCM de l'appareil courant.
  // Sans cet endpoint, aucune notification push ne peut être délivrée.
  app.post('/me/device', { preHandler: [app.authenticate] }, async (request) => {
    const { fcmToken } = zParse(deviceSchema, request.body);
    return registerDevice(app, request.user.sub, fcmToken);
  });

  const patientOnly = { preHandler: [app.authenticate, requireRole('PATIENT')] };

  // Fiche médicale d'urgence du patient (groupe sanguin, allergies, maladies
  // chroniques, n° assurance + contact d'urgence). Vitale pour le SOS.
  app.get('/me/medical', patientOnly, async (request) => {
    const me = await app.prisma.user.findUnique({
      where: { id: request.user.sub },
      select: {
        patient: { select: { bloodGroup: true, allergies: true, chronicDiseases: true, insuranceNumber: true } },
        profile: { select: { emergencyContact: true } },
      },
    });
    if (!me?.patient) throw forbidden('Profil patient requis');
    return { ...me.patient, emergencyContact: me.profile?.emergencyContact ?? null };
  });

  // Mise à jour de la fiche médicale d'urgence (patient propriétaire).
  app.patch('/me/medical', patientOnly, async (request) => {
    const input = zParse(medicalSchema, request.body);
    const { emergencyContact, ...patientFields } = input;
    const patient = await app.prisma.patient.findUnique({
      where: { userId: request.user.sub },
      select: { id: true },
    });
    if (!patient) throw forbidden('Profil patient requis');

    if (Object.keys(patientFields).length > 0) {
      await app.prisma.patient.update({ where: { id: patient.id }, data: patientFields });
    }
    if (emergencyContact !== undefined) {
      // Réforme ARCEP 2024 : canonicaliser (numéros diaspora laissés intacts).
      await app.prisma.profile.update({
        where: { userId: request.user.sub },
        data: { emergencyContact: normalizeBeninPhone(emergencyContact) },
      });
    }

    const me = await app.prisma.user.findUnique({
      where: { id: request.user.sub },
      select: {
        patient: { select: { bloodGroup: true, allergies: true, chronicDiseases: true, insuranceNumber: true } },
        profile: { select: { emergencyContact: true } },
      },
    });
    return { ...me!.patient, emergencyContact: me?.profile?.emergencyContact ?? null };
  });
}
