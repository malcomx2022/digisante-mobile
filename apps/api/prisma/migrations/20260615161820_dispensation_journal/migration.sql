-- CreateTable
CREATE TABLE "dispensations" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "status" "PrescriptionStatus" NOT NULL,
    "lines" JSONB NOT NULL,
    "dispensedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispensations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dispensations_pharmacyId_dispensedAt_idx" ON "dispensations"("pharmacyId", "dispensedAt");

-- AddForeignKey
ALTER TABLE "dispensations" ADD CONSTRAINT "dispensations_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispensations" ADD CONSTRAINT "dispensations_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
