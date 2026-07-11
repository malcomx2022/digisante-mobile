-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SENT');

-- CreateTable
CREATE TABLE "health_campaigns" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "translations" JSONB NOT NULL,
    "audienceRole" "Role",
    "audienceLang" "Lang",
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "audienceCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "health_campaigns_status_idx" ON "health_campaigns"("status");

-- AddForeignKey
ALTER TABLE "health_campaigns" ADD CONSTRAINT "health_campaigns_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
