import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Jeu de données de DÉVELOPPEMENT minimal, aligné sur le schéma complet.
// Idempotent (upsert sur le téléphone). Aucune donnée réelle de santé.
async function main() {
  // ── Admin (espace Admin) ──
  await prisma.user.upsert({
    where: { phone: '+22997000000' },
    update: {},
    create: {
      phone: '+22997000000',
      email: 'admin@digisante.bj',
      role: 'ADMIN',
      status: 'ACTIVE',
      lang: 'FR',
      profile: {
        create: { firstName: 'Admin', lastName: 'DigiSanté' },
      },
    },
  });

  // ── Médecin de démo (espace PRO) ──
  await prisma.user.upsert({
    where: { phone: '+22997000001' },
    update: {},
    create: {
      phone: '+22997000001',
      email: 'dr.demo@digisante.bj',
      role: 'MEDECIN',
      status: 'ACTIVE',
      lang: 'FR',
      profile: {
        create: { firstName: 'Awa', lastName: 'Koffi' },
      },
      doctor: {
        create: {
          speciality: 'Médecine générale',
          licenseNumber: 'BJ-MED-0001',
          consultFee: 5000,
          subscriptionPlan: 'PRO',
        },
      },
    },
  });

  // ── Patient de démo (espace Patient) + portefeuille ──
  await prisma.user.upsert({
    where: { phone: '+22997000002' },
    update: {},
    create: {
      phone: '+22997000002',
      role: 'PATIENT',
      status: 'ACTIVE',
      lang: 'FON',
      profile: {
        create: { firstName: 'Koffi', lastName: 'Dossou' },
      },
      patient: {
        create: { bloodGroup: 'O+', allergies: [], chronicDiseases: [] },
      },
      wallet: {
        create: { balance: 0, currency: 'XOF' },
      },
    },
  });

  // Référentiel des assureurs santé au Bénin (catalogue de couverture patient).
  // ARCH/AMU : régime public d'assurance maladie ; CNSS : sécurité sociale ;
  // mutuelles et assureurs privés courants. Données publiques, non médicales.
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

  console.log(`🌱 Seed terminé (admin + médecin démo + patient démo + ${insurers.length} assureurs)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
