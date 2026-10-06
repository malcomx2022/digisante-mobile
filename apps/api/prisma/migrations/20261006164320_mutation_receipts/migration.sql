-- L3 : table additive et vide ; aucune identité inventée pour les anciennes files.
-- CreateTable
CREATE TABLE "mutation_receipts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" VARCHAR(8) NOT NULL,
    "route" VARCHAR(255) NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "encryptedResponse" TEXT NOT NULL,
    "resourceId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mutation_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mutation_receipts_expiresAt_idx" ON "mutation_receipts"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "mutation_receipts_userId_method_route_key_key" ON "mutation_receipts"("userId", "method", "route", "key");

-- AddForeignKey
ALTER TABLE "mutation_receipts" ADD CONSTRAINT "mutation_receipts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
