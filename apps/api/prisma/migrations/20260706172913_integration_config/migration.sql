-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('FEDAPAY', 'TWILIO', 'DAILY', 'FIREBASE', 'RESEND');

-- CreateTable
CREATE TABLE "integration_configs" (
    "id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "secretsEnc" TEXT NOT NULL,
    "meta" JSONB,
    "lastTestAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_configs_provider_key" ON "integration_configs"("provider");
