import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Jeu de données de dev minimal. Adapter à tes modèles réels.
  await prisma.user.upsert({
    where: { phone: '+22997000000' },
    update: {},
    create: {
      phone: '+22997000000',
      fullName: 'Admin DigiSanté',
      role: 'ADMIN',
      language: 'FR',
    },
  });
  console.log('🌱 Seed terminé');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
