-- CreateEnum
CREATE TYPE "VaccinationStatus" AS ENUM ('SCHEDULED', 'DONE');

-- CreateTable
CREATE TABLE "vaccination_subjects" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3) NOT NULL,
    "isSelf" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vaccination_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaccinations" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "vaccineCode" TEXT NOT NULL,
    "doseLabel" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "administeredAt" TIMESTAMP(3),
    "status" "VaccinationStatus" NOT NULL DEFAULT 'SCHEDULED',
    "lastNotifiedOn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vaccinations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vaccination_subjects_patientId_idx" ON "vaccination_subjects"("patientId");

-- CreateIndex
CREATE INDEX "vaccinations_subjectId_idx" ON "vaccinations"("subjectId");

-- CreateIndex
CREATE INDEX "vaccinations_status_dueDate_idx" ON "vaccinations"("status", "dueDate");

-- AddForeignKey
ALTER TABLE "vaccination_subjects" ADD CONSTRAINT "vaccination_subjects_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccinations" ADD CONSTRAINT "vaccinations_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "vaccination_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
