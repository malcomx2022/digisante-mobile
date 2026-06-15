-- CreateTable
CREATE TABLE "medication_intakes" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "itemId" TEXT,
    "medicationName" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medication_intakes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "medication_intakes_patientId_idx" ON "medication_intakes"("patientId");

-- CreateIndex
CREATE INDEX "medication_intakes_takenAt_idx" ON "medication_intakes"("takenAt");

-- AddForeignKey
ALTER TABLE "medication_intakes" ADD CONSTRAINT "medication_intakes_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_intakes" ADD CONSTRAINT "medication_intakes_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "prescription_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

