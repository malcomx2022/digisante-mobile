-- CreateTable
CREATE TABLE "medication_reminders" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "itemId" TEXT,
    "medicationName" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "lastGeneratedOn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medication_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "medication_reminders_patientId_idx" ON "medication_reminders"("patientId");

-- AddForeignKey
ALTER TABLE "medication_reminders" ADD CONSTRAINT "medication_reminders_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_reminders" ADD CONSTRAINT "medication_reminders_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "prescription_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

