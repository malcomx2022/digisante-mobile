-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "consentId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consent_records_recordId_idx" ON "consent_records"("recordId");

-- CreateIndex
CREATE UNIQUE INDEX "consent_records_consentId_recordId_key" ON "consent_records"("consentId", "recordId");

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "consents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "medical_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
