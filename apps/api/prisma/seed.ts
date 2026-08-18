import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────
// Jeu de données de DÉVELOPPEMENT, aligné sur le schéma complet.
// Objectif : chacun des 6 espaces (patient, médecin, pharmacie, labo,
// diaspora, admin) affiche du contenu de démonstration.
//
// IDEMPOTENT : upsert sur clés naturelles (phone, code, licenseNumber,
// couples uniques) ; pour les lignes relationnelles sans clé unique, on
// utilise un `id` déterministe (préfixe `seed-`) avec upsert. Le seed peut
// donc être relancé sans dupliquer ni planter.
//
// Aucune donnée réelle de santé. Téléphones format réforme : +229 + 10 chiffres.
// ─────────────────────────────────────────────────────────────

// Helpers de dates relatives à l'exécution (RDV futurs/passés, validités…).
const now = new Date();
const days = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

async function main() {
  // ════════════════════════════════════════════════════════════
  // 1) COMPTES (User + profil de rôle) — upsert par téléphone
  // ════════════════════════════════════════════════════════════

  // ── Admin (espace Admin) ──
  const adminUser = await prisma.user.upsert({
    where: { phone: '+2290197000000' },
    update: {},
    create: {
      phone: '+2290197000000',
      email: 'admin@digisante.bj',
      role: 'ADMIN',
      status: 'ACTIVE',
      lang: 'FR',
      profile: {
        create: { firstName: 'Admin', lastName: 'DigiSanté' },
      },
    },
  });

  // Profil RBAC : l'admin de démo est super-admin (tous les scopes).
  // (Tableau aligné sur ADMIN_PRESETS.SUPER_ADMIN de @digisante/shared.)
  const SUPER_ADMIN_SCOPES = [
    'admin:manage', 'users:read', 'users:write', 'kyc:review', 'ops:read',
    'finance:read', 'finance:write', 'support:write', 'otp:write',
    'webhooks:read', 'webhooks:replay', 'audit:read', 'audit:export', 'education:write',
  ];
  await prisma.adminProfile.upsert({
    where: { userId: adminUser.id },
    update: { scopes: SUPER_ADMIN_SCOPES, preset: 'SUPER_ADMIN', suspendedAt: null },
    create: { userId: adminUser.id, scopes: SUPER_ADMIN_SCOPES, preset: 'SUPER_ADMIN' },
  });

  // ── Médecin de démo (espace PRO) ──
  const doctorUser = await prisma.user.upsert({
    where: { phone: '+2290197000001' },
    update: {},
    create: {
      phone: '+2290197000001',
      email: 'dr.demo@digisante.bj',
      role: 'MEDECIN',
      status: 'ACTIVE',
      lang: 'FR',
      profile: {
        create: {
          firstName: 'Awa',
          lastName: 'Koffi',
          spokenLangs: ['FR', 'FON'],
        },
      },
      doctor: {
        create: {
          speciality: 'Médecine générale',
          licenseNumber: 'BJ-MED-0001',
          consultFee: 5000,
          subscriptionPlan: 'PRO',
          bio: "Médecin généraliste, 12 ans d'expérience à Cotonou.",
          verifiedAt: now,
        },
      },
    },
    include: { doctor: true },
  });
  const doctor =
    doctorUser.doctor ??
    (await prisma.doctor.findUniqueOrThrow({ where: { userId: doctorUser.id } }));

  // ── Patient 1 de démo (espace Patient) + portefeuille ──
  const patient1User = await prisma.user.upsert({
    where: { phone: '+2290197000002' },
    update: {},
    create: {
      phone: '+2290197000002',
      role: 'PATIENT',
      status: 'ACTIVE',
      lang: 'FON',
      profile: {
        create: {
          firstName: 'Koffi',
          lastName: 'Dossou',
          gender: 'M',
          spokenLangs: ['FON', 'FR'],
        },
      },
      patient: {
        create: {
          bloodGroup: 'O+',
          allergies: ['Pénicilline'],
          chronicDiseases: ['Hypertension'],
        },
      },
      wallet: {
        create: { balance: 0, currency: 'XOF' },
      },
    },
    include: { patient: true },
  });
  const patient1 =
    patient1User.patient ??
    (await prisma.patient.findUniqueOrThrow({ where: { userId: patient1User.id } }));

  // ── Pharmacie (espace Pharmacie) ──
  const pharmacyUser = await prisma.user.upsert({
    where: { phone: '+2290197000003' },
    update: {},
    create: {
      phone: '+2290197000003',
      email: 'pharmacie.paix@digisante.bj',
      role: 'PHARMACIE',
      status: 'ACTIVE',
      lang: 'FR',
      profile: {
        create: { firstName: 'Pharmacie', lastName: 'de la Paix' },
      },
      pharmacy: {
        create: {
          name: 'Pharmacie de la Paix',
          address: 'Carrefour Cadjèhoun, Cotonou',
          phone: '+2290197000003',
          licenseNumber: 'BJ-PHARM-0001',
          servicesOffered: ['Délivrance', 'Conseil', 'Garde'],
        },
      },
    },
    include: { pharmacy: true },
  });
  const pharmacy =
    pharmacyUser.pharmacy ??
    (await prisma.pharmacy.findUniqueOrThrow({ where: { userId: pharmacyUser.id } }));

  // ── Laboratoire (espace Labo) ──
  const labUser = await prisma.user.upsert({
    where: { phone: '+2290197000004' },
    update: {},
    create: {
      phone: '+2290197000004',
      email: 'labo.biomedic@digisante.bj',
      role: 'LABORATOIRE',
      status: 'ACTIVE',
      lang: 'FR',
      profile: {
        create: { firstName: 'Labo', lastName: 'Biomedic' },
      },
      lab: {
        create: {
          name: 'Labo Biomedic',
          address: 'Rue 1234, Akpakpa, Cotonou',
          phone: '+2290197000004',
          servicesOffered: ['Hématologie', 'Biochimie', 'Sérologie'],
        },
      },
    },
    include: { lab: true },
  });
  const lab =
    labUser.lab ?? (await prisma.lab.findUniqueOrThrow({ where: { userId: labUser.id } }));

  // ── Diaspora (espace Diaspora) + portefeuille crédité ──
  const diasporaUser = await prisma.user.upsert({
    where: { phone: '+2290197000005' },
    update: {},
    create: {
      phone: '+2290197000005',
      email: 'diaspora.demo@digisante.bj',
      role: 'DIASPORA',
      status: 'ACTIVE',
      lang: 'FR',
      profile: {
        create: { firstName: 'Espérance', lastName: 'Adjavon' },
      },
      wallet: {
        create: { balance: 50000, currency: 'XOF' },
      },
    },
    include: { wallet: true },
  });
  const diasporaWallet =
    diasporaUser.wallet ??
    (await prisma.wallet.findUniqueOrThrow({ where: { userId: diasporaUser.id } }));

  // ── Patient 2 de démo (étoffe : annuaire, RDV…) ──
  const patient2User = await prisma.user.upsert({
    where: { phone: '+2290197000006' },
    update: {},
    create: {
      phone: '+2290197000006',
      role: 'PATIENT',
      status: 'ACTIVE',
      lang: 'FR',
      profile: {
        create: {
          firstName: 'Bernadette',
          lastName: 'Hounkpatin',
          gender: 'F',
          spokenLangs: ['FR'],
        },
      },
      patient: {
        create: { bloodGroup: 'A+', allergies: [], chronicDiseases: [] },
      },
      wallet: { create: { balance: 0, currency: 'XOF' } },
    },
    include: { patient: true },
  });
  const patient2 =
    patient2User.patient ??
    (await prisma.patient.findUniqueOrThrow({ where: { userId: patient2User.id } }));

  // ════════════════════════════════════════════════════════════
  // 2) RÉFÉRENTIEL ASSUREURS (catalogue de couverture patient)
  // ════════════════════════════════════════════════════════════
  const insurers = [
    { name: 'ARCH — Assurance Maladie (AMU)', code: 'ARCH-AMU', coverageTypes: ['CONSULTATION', 'PHARMACIE', 'HOSPITALISATION', 'LABORATOIRE', 'MATERNITE'] },
    { name: 'CNSS — Caisse Nationale de Sécurité Sociale', code: 'CNSS', coverageTypes: ['CONSULTATION', 'HOSPITALISATION', 'MATERNITE'] },
    { name: 'Mutuelle de Sécurité Sociale (MSS)', code: 'MSS', coverageTypes: ['CONSULTATION', 'PHARMACIE', 'LABORATOIRE'] },
    { name: 'NSIA Assurances Bénin', code: 'NSIA', coverageTypes: ['CONSULTATION', 'PHARMACIE', 'HOSPITALISATION', 'LABORATOIRE'] },
    { name: 'Africaine des Assurances', code: 'AAB', coverageTypes: ['CONSULTATION', 'PHARMACIE', 'HOSPITALISATION'] },
  ];
  for (const ins of insurers) {
    await prisma.insurance.upsert({
      where: { code: ins.code },
      update: { name: ins.name, coverageTypes: ins.coverageTypes },
      create: ins,
    });
  }
  const archInsurance = await prisma.insurance.findUniqueOrThrow({ where: { code: 'ARCH-AMU' } });

  // ════════════════════════════════════════════════════════════
  // 3) ESPACE PATIENT — DMP, observance, assurance, avis, consentement
  // ════════════════════════════════════════════════════════════

  // — DMP : plusieurs entrées de types variés —
  await prisma.medicalRecord.upsert({
    where: { id: 'seed-mr-diag-1' },
    update: {},
    create: {
      id: 'seed-mr-diag-1',
      patientId: patient1.id,
      type: 'DIAGNOSIS',
      title: 'Hypertension artérielle essentielle',
      data: { note: 'TA 150/95, mise sous traitement. Suivi mensuel.' },
    },
  });
  await prisma.medicalRecord.upsert({
    where: { id: 'seed-mr-vitals-1' },
    update: {},
    create: {
      id: 'seed-mr-vitals-1',
      patientId: patient1.id,
      type: 'VITAL_SIGNS',
      title: 'Constantes du jour',
      data: { systolic: 138, diastolic: 88, pulse: 76, tempC: 36.8, weightKg: 72 },
    },
  });
  await prisma.medicalRecord.upsert({
    where: { id: 'seed-mr-lab-1' },
    update: {},
    create: {
      id: 'seed-mr-lab-1',
      patientId: patient1.id,
      type: 'LAB_RESULT',
      title: 'Bilan lipidique',
      data: { cholesterolTotal: 2.1, hdl: 0.5, ldl: 1.4, triglycerides: 1.2, unit: 'g/L' },
    },
  });
  await prisma.medicalRecord.upsert({
    where: { id: 'seed-mr-allergy-1' },
    update: {},
    create: {
      id: 'seed-mr-allergy-1',
      patientId: patient1.id,
      type: 'ALLERGY',
      title: 'Allergie à la pénicilline',
      data: { severity: 'modérée', reaction: 'éruption cutanée' },
    },
  });
  await prisma.medicalRecord.upsert({
    where: { id: 'seed-mr-vaccine-1' },
    update: {},
    create: {
      id: 'seed-mr-vaccine-1',
      patientId: patient1.id,
      type: 'VACCINATION',
      title: 'Vaccin antitétanique (rappel)',
      data: { date: '2025-09-12', batch: 'TET-2025-09' },
    },
  });

  // — Consultation rattachée à un RDV terminé (créée plus bas via appointment) —
  // — Ordonnance ACTIVE avec lignes PENDING (visible côté pharmacie) —
  await prisma.prescription.upsert({
    where: { id: 'seed-presc-1' },
    // QR ≥ 16 caractères (contrainte de scanSchema côté pharmacie).
    update: { qrCode: 'seed-qr-prescription-0001' },
    create: {
      id: 'seed-presc-1',
      doctorId: doctor.id,
      patientId: patient1.id,
      status: 'ACTIVE',
      qrCode: 'seed-qr-prescription-0001',
      validUntil: days(30),
      items: {
        create: [
          {
            id: 'seed-presc-1-item-1',
            medicationName: 'Amlodipine 5mg',
            dosage: '1 comprimé',
            frequency: '1 fois/jour',
            duration: '30 jours',
            status: 'PENDING',
          },
          {
            id: 'seed-presc-1-item-2',
            medicationName: 'Paracétamol 500mg',
            dosage: '1 comprimé',
            frequency: 'si douleur',
            duration: '7 jours',
            status: 'PENDING',
          },
        ],
      },
    },
  });

  // — Observance : rappel horaire + prise déclarée —
  await prisma.medicationReminder.upsert({
    where: { id: 'seed-reminder-1' },
    update: {},
    create: {
      id: 'seed-reminder-1',
      patientId: patient1.id,
      itemId: 'seed-presc-1-item-1',
      medicationName: 'Amlodipine 5mg',
      time: '08:00',
    },
  });
  await prisma.medicationIntake.upsert({
    where: { id: 'seed-intake-1' },
    update: {},
    create: {
      id: 'seed-intake-1',
      patientId: patient1.id,
      itemId: 'seed-presc-1-item-1',
      medicationName: 'Amlodipine 5mg',
      takenAt: days(-1),
    },
  });
  await prisma.medicationIntake.upsert({
    where: { id: 'seed-intake-2' },
    update: {},
    create: {
      id: 'seed-intake-2',
      patientId: patient1.id,
      itemId: 'seed-presc-1-item-1',
      medicationName: 'Amlodipine 5mg',
      takenAt: now,
    },
  });

  // — Couverture d'assurance santé du patient —
  await prisma.patientInsurance.upsert({
    where: { patientId_insuranceId: { patientId: patient1.id, insuranceId: archInsurance.id } },
    update: {},
    create: {
      patientId: patient1.id,
      insuranceId: archInsurance.id,
      memberNumber: 'ARCH-2025-000123',
      status: 'ACTIVE',
      expiresAt: days(365),
    },
  });

  // — Notifications patient —
  await prisma.notification.upsert({
    where: { id: 'seed-notif-1' },
    update: {},
    create: {
      id: 'seed-notif-1',
      recipientId: patient1User.id,
      type: 'PRESCRIPTION_READY',
      channel: 'IN_APP',
      title: 'Ordonnance disponible',
      body: 'Votre ordonnance est prête à être présentée en pharmacie.',
      status: 'SENT',
      sentAt: now,
    },
  });
  await prisma.notification.upsert({
    where: { id: 'seed-notif-2' },
    update: {},
    create: {
      id: 'seed-notif-2',
      recipientId: patient1User.id,
      type: 'APPOINTMENT_REMINDER',
      channel: 'IN_APP',
      title: 'Rappel de rendez-vous',
      body: 'Vous avez un rendez-vous confirmé prochainement.',
      status: 'PENDING',
    },
  });

  // — Avis du patient sur le médecin (1 par couple) —
  await prisma.doctorReview.upsert({
    where: { doctorId_patientId: { doctorId: doctor.id, patientId: patient1.id } },
    update: {},
    create: {
      doctorId: doctor.id,
      patientId: patient1.id,
      rating: 5,
      comment: 'Médecin à l’écoute, explications claires.',
    },
  });

  // — Consentement DMP actif (patient ↔ médecin) —
  await prisma.consent.upsert({
    where: { patientId_granteeId: { patientId: patient1.id, granteeId: doctorUser.id } },
    update: { revokedAt: null, expiresAt: days(180) },
    create: {
      patientId: patient1.id,
      granteeId: doctorUser.id,
      scope: 'DMP',
      grantedVia: 'seed',
      expiresAt: days(180),
    },
  });

  // — Alerte SOS résolue (historique) —
  await prisma.sos.upsert({
    where: { id: 'seed-sos-1' },
    update: {},
    create: {
      id: 'seed-sos-1',
      patientId: patient1.id,
      latitude: 6.3703,
      longitude: 2.3912,
      status: 'RESOLVED',
      resolvedAt: now,
      contactNotified: true,
    },
  });

  // ════════════════════════════════════════════════════════════
  // 4) ESPACE MÉDECIN (PRO) — RDV, consultation, prescripteur
  // ════════════════════════════════════════════════════════════

  // RDV terminé (support consultation + prescription + éligibilité avis)
  await prisma.appointment.upsert({
    where: { id: 'seed-appt-done' },
    update: {},
    create: {
      id: 'seed-appt-done',
      patientId: patient1.id,
      doctorId: doctor.id,
      type: 'PHYSICAL',
      status: 'COMPLETED',
      scheduledAt: days(-7),
    },
  });
  await prisma.consultation.upsert({
    where: { appointmentId: 'seed-appt-done' },
    update: {},
    create: {
      id: 'seed-consult-1',
      appointmentId: 'seed-appt-done',
      mode: 'VIDEO',
      status: 'COMPLETED',
      startedAt: days(-7),
      endedAt: days(-7),
      notes: 'Contrôle tension, ajustement traitement.',
    },
  });

  // RDV futur CONFIRMÉ (téléconsultation)
  await prisma.appointment.upsert({
    where: { id: 'seed-appt-confirmed' },
    update: {},
    create: {
      id: 'seed-appt-confirmed',
      patientId: patient1.id,
      doctorId: doctor.id,
      type: 'TELECONSULTATION',
      status: 'CONFIRMED',
      scheduledAt: days(3),
    },
  });

  // RDV PENDING (patient 2 — demande à traiter)
  await prisma.appointment.upsert({
    where: { id: 'seed-appt-pending' },
    update: {},
    create: {
      id: 'seed-appt-pending',
      patientId: patient2.id,
      doctorId: doctor.id,
      type: 'PHYSICAL',
      status: 'PENDING',
      scheduledAt: days(5),
    },
  });

  // Paiement de la consultation confirmée (FedaPay simulé — donnée d'affichage)
  await prisma.payment.upsert({
    where: { id: 'seed-pay-consult' },
    update: {},
    create: {
      id: 'seed-pay-consult',
      userId: patient1User.id,
      appointmentId: 'seed-appt-confirmed',
      type: 'CONSULTATION',
      method: 'MTN_MOMO',
      amount: 5000,
      currency: 'XOF',
      status: 'COMPLETED',
    },
  });

  // ════════════════════════════════════════════════════════════
  // 5) ESPACE PHARMACIE — ordonnance à délivrer + journal
  // ════════════════════════════════════════════════════════════
  // L'ordonnance seed-presc-1 (ACTIVE, lignes PENDING) est à délivrer.
  // Une dispensation déjà journalisée (historique de CETTE pharmacie).
  await prisma.dispensation.upsert({
    where: { id: 'seed-disp-1' },
    update: {},
    create: {
      id: 'seed-disp-1',
      prescriptionId: 'seed-presc-1',
      pharmacyId: pharmacy.id,
      status: 'PARTIALLY_DISPENSED',
      lines: [
        { medicationName: 'Paracétamol 500mg', status: 'DISPENSED' },
        { medicationName: 'Amlodipine 5mg', status: 'UNAVAILABLE' },
      ],
      dispensedAt: days(-1),
    },
  });

  // ════════════════════════════════════════════════════════════
  // 6) ESPACE LABORATOIRE — pool anonymisé, prise en charge, résultat
  // ════════════════════════════════════════════════════════════

  // Commande DISPONIBLE (pool, pas encore prise en charge : labId null)
  await prisma.labOrder.upsert({
    where: { id: 'seed-lab-pool' },
    update: {},
    create: {
      id: 'seed-lab-pool',
      prescribedById: doctor.id,
      patientId: patient1.id,
      labId: null,
      testType: 'Numération formule sanguine (NFS)',
      status: 'PENDING',
    },
  });

  // Commande PRISE EN CHARGE par CE labo (en cours)
  await prisma.labOrder.upsert({
    where: { id: 'seed-lab-processing' },
    update: {},
    create: {
      id: 'seed-lab-processing',
      prescribedById: doctor.id,
      patientId: patient1.id,
      labId: lab.id,
      testType: 'Glycémie à jeun',
      status: 'PROCESSING',
      scheduledAt: now,
    },
  });

  // Commande TERMINÉE par CE labo + résultat publié
  await prisma.labOrder.upsert({
    where: { id: 'seed-lab-done' },
    update: {},
    create: {
      id: 'seed-lab-done',
      prescribedById: doctor.id,
      patientId: patient1.id,
      labId: lab.id,
      testType: 'Bilan lipidique',
      status: 'COMPLETED',
      scheduledAt: days(-3),
    },
  });
  await prisma.labResult.upsert({
    where: { labOrderId: 'seed-lab-done' },
    update: {},
    create: {
      id: 'seed-lab-result-1',
      labOrderId: 'seed-lab-done',
      values: {
        cholesterolTotal: { value: 2.1, unit: 'g/L', ref: '< 2.0' },
        hdl: { value: 0.5, unit: 'g/L', ref: '> 0.4' },
        ldl: { value: 1.4, unit: 'g/L', ref: '< 1.6' },
      },
      // Interprétation par le médecin prescripteur (boucle fermée)
      interpretation: 'Cholestérol total légèrement élevé. Conseils diététiques.',
      interpretedById: doctor.id,
      interpretedAt: now,
    },
  });

  // Notification patient : résultat de labo disponible
  await prisma.notification.upsert({
    where: { id: 'seed-notif-lab' },
    update: {},
    create: {
      id: 'seed-notif-lab',
      recipientId: patient1User.id,
      type: 'LAB_RESULT',
      channel: 'IN_APP',
      title: 'Résultat de laboratoire disponible',
      body: 'Votre bilan lipidique est disponible et a été interprété.',
      status: 'SENT',
      sentAt: now,
    },
  });

  // ════════════════════════════════════════════════════════════
  // 7) ESPACE DIASPORA — wallet crédité + transactions + bénéficiaires
  // ════════════════════════════════════════════════════════════
  await prisma.walletTransaction.upsert({
    where: { id: 'seed-wtx-topup' },
    update: {},
    create: {
      id: 'seed-wtx-topup',
      walletId: diasporaWallet.id,
      type: 'TOPUP',
      amount: 50000,
      reference: 'SEED-TOPUP-001',
      description: 'Recharge initiale (démo)',
      createdAt: days(-10),
    },
  });
  await prisma.walletTransaction.upsert({
    where: { id: 'seed-wtx-debit' },
    update: {},
    create: {
      id: 'seed-wtx-debit',
      walletId: diasporaWallet.id,
      type: 'DEBIT',
      amount: 5000,
      reference: 'SEED-DEBIT-001',
      description: 'Paiement consultation pour un proche (démo)',
      createdAt: days(-2),
    },
  });

  await prisma.beneficiary.upsert({
    where: { id: 'seed-benef-1' },
    update: {},
    create: {
      id: 'seed-benef-1',
      ownerId: diasporaUser.id,
      name: 'Maman Adjavon',
      relationship: 'Mère',
      phone: '+2290191000010',
      languagesSpoken: ['FON', 'FR'],
      notes: 'Suivi tension artérielle.',
    },
  });
  await prisma.beneficiary.upsert({
    where: { id: 'seed-benef-2' },
    update: {},
    create: {
      id: 'seed-benef-2',
      ownerId: diasporaUser.id,
      name: 'Kévin Adjavon',
      relationship: 'Frère',
      phone: '+2290191000011',
      languagesSpoken: ['FR'],
    },
  });

  // ════════════════════════════════════════════════════════════
  // 8) ESPACE ADMIN — KYC médecin, audit, contenus santé
  // ════════════════════════════════════════════════════════════

  // Dossier KYC du médecin, en attente de revue, avec pièces
  await prisma.kycSubmission.upsert({
    where: { id: 'seed-kyc-1' },
    // UNDER_REVIEW : état attendu par la file de revue admin (kyc.listQueue).
    update: { status: 'UNDER_REVIEW', submittedAt: days(-2) },
    create: {
      id: 'seed-kyc-1',
      userId: doctorUser.id,
      status: 'UNDER_REVIEW',
      submittedAt: days(-2),
    },
  });
  await prisma.kycDocument.upsert({
    where: { id: 'seed-kyc-doc-id' },
    update: {},
    create: {
      id: 'seed-kyc-doc-id',
      submissionId: 'seed-kyc-1',
      type: 'NATIONAL_ID',
      fileUrl: 'https://example.invalid/seed/national-id.jpg',
      verified: false,
    },
  });
  await prisma.kycDocument.upsert({
    where: { id: 'seed-kyc-doc-degree' },
    update: {},
    create: {
      id: 'seed-kyc-doc-degree',
      submissionId: 'seed-kyc-1',
      type: 'MEDICAL_DEGREE',
      fileUrl: 'https://example.invalid/seed/medical-degree.pdf',
      verified: false,
    },
  });
  await prisma.kycDocument.upsert({
    where: { id: 'seed-kyc-doc-license' },
    update: {},
    create: {
      id: 'seed-kyc-doc-license',
      submissionId: 'seed-kyc-1',
      type: 'ORDER_LICENSE',
      fileUrl: 'https://example.invalid/seed/order-license.pdf',
      verified: false,
    },
  });

  // Audit trail immuable (hash chaîné) — entrées de démo.
  // Registre UNIQUE depuis août 2026 : les actions d'administration y sont
  // journalisées comme le reste (`AdminAuditLog` supprimé).
  await prisma.auditLog.upsert({
    where: { hash: 'seed-hash-genesis' },
    update: {},
    create: {
      id: 'seed-audit-genesis',
      action: 'SYSTEM_SEED',
      actorId: adminUser.id,
      meta: { note: 'genesis' },
      prevHash: null,
      hash: 'seed-hash-genesis',
    },
  });
  await prisma.auditLog.upsert({
    where: { hash: 'seed-hash-2' },
    update: {},
    create: {
      id: 'seed-audit-2',
      action: 'DMP_CONSENT_GRANT',
      actorId: patient1User.id,
      targetId: doctorUser.id,
      meta: { scope: 'DMP', via: 'seed' },
      prevHash: 'seed-hash-genesis',
      hash: 'seed-hash-2',
    },
  });

  // Contenus santé publiés (catégories variées)
  const contents = [
    {
      id: 'seed-content-1',
      title: 'Prévenir le paludisme : gestes simples',
      body: 'Dormez sous moustiquaire imprégnée, éliminez les eaux stagnantes...',
      category: 'PREVENTION' as const,
      tags: ['paludisme', 'moustiquaire'],
    },
    {
      id: 'seed-content-2',
      title: 'Bien manger pendant la grossesse',
      body: 'Privilégiez les aliments riches en fer et en folates...',
      category: 'MATERNITY' as const,
      tags: ['grossesse', 'nutrition'],
    },
    {
      id: 'seed-content-3',
      title: 'Vivre avec l’hypertension',
      body: 'Réduisez le sel, bougez régulièrement, prenez votre traitement...',
      category: 'CHRONIC' as const,
      tags: ['hypertension', 'chronique'],
    },
  ];
  for (const c of contents) {
    await prisma.healthContent.upsert({
      where: { id: c.id },
      update: {},
      create: {
        ...c,
        isPublished: true,
        status: 'PUBLISHED',
        reviewedById: doctorUser.id,
      },
    });
  }

  // ════════════════════════════════════════════════════════════
  // 9) CHAT patient ↔ médecin (D-10) — fil + messages
  // ════════════════════════════════════════════════════════════
  await prisma.chatThread.upsert({
    where: { patientId_doctorId: { patientId: patient1.id, doctorId: doctor.id } },
    update: { lastMessageAt: now },
    create: {
      id: 'seed-thread-1',
      patientId: patient1.id,
      doctorId: doctor.id,
      lastMessageAt: now,
    },
  });
  await prisma.chatMessage.upsert({
    where: { id: 'seed-msg-1' },
    update: {},
    create: {
      id: 'seed-msg-1',
      threadId: 'seed-thread-1',
      senderId: patient1User.id,
      body: 'Bonjour docteur, ma tension est stable cette semaine.',
      createdAt: days(-1),
    },
  });
  await prisma.chatMessage.upsert({
    where: { id: 'seed-msg-2' },
    update: {},
    create: {
      id: 'seed-msg-2',
      threadId: 'seed-thread-1',
      senderId: doctorUser.id,
      body: 'Parfait, continuez le traitement et reprenez RDV dans 3 jours.',
      createdAt: now,
    },
  });

  // ════════════════════════════════════════════════════════════
  // RÉSUMÉ
  // ════════════════════════════════════════════════════════════
  console.log('🌱 Seed DigiSanté terminé (idempotent). Données de démo par espace :');
  console.log('  • Comptes (téléphone / rôle) :');
  console.log('      ADMIN        +2290197000000');
  console.log('      MEDECIN      +2290197000001');
  console.log('      PATIENT 1    +2290197000002 (FON)');
  console.log('      PHARMACIE    +2290197000003');
  console.log('      LABORATOIRE  +2290197000004');
  console.log('      DIASPORA     +2290197000005');
  console.log('      PATIENT 2    +2290197000006');
  console.log('  • Patient   : 5 entrées DMP, 1 ordonnance (2 lignes PENDING), observance (rappel+2 prises), assurance ARCH, 2 notifs, avis médecin, consentement DMP, 1 SOS résolu');
  console.log('  • Médecin   : 3 RDV (terminé/confirmé/pending), 1 consultation, prescripteur ordonnance + 3 LabOrders, paiement consultation');
  console.log('  • Pharmacie : 1 ordonnance à délivrer + 1 dispensation journalisée');
  console.log('  • Labo      : LabOrder pool (PENDING) + PROCESSING + COMPLETED, 1 LabResult publié+interprété, notif patient');
  console.log('  • Diaspora  : wallet 50000 XOF, 2 transactions, 2 bénéficiaires');
  console.log('  • Admin     : 1 KYC (3 pièces en attente), 2 AuditLog, 3 HealthContent publiés');
  console.log('  • Chat      : 1 fil patient↔médecin, 2 messages');
  console.log(`  • Assureurs : ${insurers.length} organismes`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
