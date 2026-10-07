-- AlterTable
ALTER TABLE "doctors" ADD COLUMN     "subscriptionCancelledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "subscription_orders" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL,
    "catalogVersion" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "periodMonths" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "checkoutUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_orders_paymentId_key" ON "subscription_orders"("paymentId");

-- CreateIndex
CREATE INDEX "subscription_orders_doctorId_endsAt_idx" ON "subscription_orders"("doctorId", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_orders_doctorId_requestId_key" ON "subscription_orders"("doctorId", "requestId");

-- AddForeignKey
ALTER TABLE "subscription_orders" ADD CONSTRAINT "subscription_orders_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_orders" ADD CONSTRAINT "subscription_orders_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fermer les activations payantes historiques sans inventer de preuve financière.
-- Conserver le plan pour l'inventaire manuel avant ouverture (contrat L6).
UPDATE doctors SET "subscriptionStatus" = 'EXPIRED'
WHERE "subscriptionPlan" <> 'FREE' AND "subscriptionStatus" = 'ACTIVE';
