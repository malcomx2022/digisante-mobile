-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'ASC';

-- CreateTable
CREATE TABLE "community_health_workers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_health_workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asc_beneficiaries" (
    "id" TEXT NOT NULL,
    "ascId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "village" TEXT,
    "birthDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asc_beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asc_observations" (
    "id" TEXT NOT NULL,
    "beneficiaryId" TEXT NOT NULL,
    "systolic" INTEGER,
    "diastolic" INTEGER,
    "pulse" INTEGER,
    "temperature" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION,
    "triageOutcome" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asc_observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "community_health_workers_userId_key" ON "community_health_workers"("userId");

-- CreateIndex
CREATE INDEX "asc_beneficiaries_ascId_idx" ON "asc_beneficiaries"("ascId");

-- CreateIndex
CREATE INDEX "asc_observations_beneficiaryId_idx" ON "asc_observations"("beneficiaryId");

-- AddForeignKey
ALTER TABLE "community_health_workers" ADD CONSTRAINT "community_health_workers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asc_beneficiaries" ADD CONSTRAINT "asc_beneficiaries_ascId_fkey" FOREIGN KEY ("ascId") REFERENCES "community_health_workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asc_observations" ADD CONSTRAINT "asc_observations_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "asc_beneficiaries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
