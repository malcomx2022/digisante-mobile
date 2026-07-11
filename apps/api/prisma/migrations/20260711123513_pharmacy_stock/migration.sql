-- CreateEnum
CREATE TYPE "StockStatus" AS ENUM ('IN_STOCK', 'LOW', 'OUT');

-- CreateTable
CREATE TABLE "pharmacy_stocks" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "medicationName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "StockStatus" NOT NULL DEFAULT 'IN_STOCK',
    "price" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pharmacy_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pharmacy_stocks_medicationName_status_idx" ON "pharmacy_stocks"("medicationName", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pharmacy_stocks_pharmacyId_medicationName_key" ON "pharmacy_stocks"("pharmacyId", "medicationName");

-- AddForeignKey
ALTER TABLE "pharmacy_stocks" ADD CONSTRAINT "pharmacy_stocks_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "pharmacies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
