-- CreateTable
CREATE TABLE "pregnancies" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "lmpDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pregnancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "antenatal_visits" (
    "id" TEXT NOT NULL,
    "pregnancyId" TEXT NOT NULL,
    "contactNumber" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "doneAt" TIMESTAMP(3),
    "lastNotifiedOn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "antenatal_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pregnancies_patientId_idx" ON "pregnancies"("patientId");

-- CreateIndex
CREATE INDEX "antenatal_visits_pregnancyId_idx" ON "antenatal_visits"("pregnancyId");

-- CreateIndex
CREATE INDEX "antenatal_visits_doneAt_dueDate_idx" ON "antenatal_visits"("doneAt", "dueDate");

-- AddForeignKey
ALTER TABLE "pregnancies" ADD CONSTRAINT "pregnancies_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "antenatal_visits" ADD CONSTRAINT "antenatal_visits_pregnancyId_fkey" FOREIGN KEY ("pregnancyId") REFERENCES "pregnancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
