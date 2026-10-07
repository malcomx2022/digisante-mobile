-- CreateTable
CREATE TABLE "finance_entries" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "gross" DECIMAL(12,2) NOT NULL,
    "commission" DECIMAL(12,2) NOT NULL,
    "net" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_operations" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestHash" TEXT,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'REQUESTED',
    "doctorId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "requestedBy" TEXT NOT NULL,
    "executingBy" TEXT,
    "executedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executingAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "proofRef" TEXT,

    CONSTRAINT "finance_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_operation_items" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "providerReference" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "finance_operation_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finance_entries_doctorId_occurredAt_idx" ON "finance_entries"("doctorId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "finance_entries_paymentId_kind_key" ON "finance_entries"("paymentId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "finance_operations_requestId_key" ON "finance_operations"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "finance_operations_proofRef_key" ON "finance_operations"("proofRef");

-- CreateIndex
CREATE INDEX "finance_operations_doctorId_state_idx" ON "finance_operations"("doctorId", "state");

-- CreateIndex
CREATE INDEX "finance_operations_kind_state_createdAt_idx" ON "finance_operations"("kind", "state", "createdAt");

-- CreateIndex
CREATE INDEX "finance_operation_items_paymentId_idx" ON "finance_operation_items"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "finance_operation_items_operationId_paymentId_key" ON "finance_operation_items"("operationId", "paymentId");

-- AddForeignKey
ALTER TABLE "finance_operation_items" ADD CONSTRAINT "finance_operation_items_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "finance_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Aucun backfill : updatedAt/statut terminal ne prouve ni date, ni commission.
ALTER TABLE finance_entries ADD CONSTRAINT finance_entry_contract CHECK (
  kind IN ('CAPTURE', 'REFUND') AND currency = 'XOF' AND gross > 0
  AND commission >= 0 AND net >= 0 AND gross = commission + net
);
ALTER TABLE finance_operations ADD CONSTRAINT finance_operation_contract CHECK (
  kind IN ('PAYOUT', 'REFUND') AND state IN ('REQUESTED', 'EXECUTING', 'EXECUTED', 'CANCELLED')
  AND currency = 'XOF' AND amount > 0
  AND (kind <> 'PAYOUT' OR "doctorId" IS NOT NULL)
  AND (state <> 'EXECUTING' OR ("executingAt" IS NOT NULL AND "executingBy" IS NOT NULL))
  AND (state <> 'EXECUTED' OR ("executedAt" IS NOT NULL AND "executedBy" IS NOT NULL AND "proofRef" IS NOT NULL AND "executingAt" IS NOT NULL))
);
ALTER TABLE finance_operation_items ADD CONSTRAINT finance_item_amount CHECK (amount > 0);
CREATE FUNCTION finance_entry_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'finance_entries is append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER finance_entry_no_mutation BEFORE UPDATE OR DELETE ON finance_entries
FOR EACH ROW EXECUTE FUNCTION finance_entry_append_only();
CREATE TRIGGER finance_entry_no_truncate BEFORE TRUNCATE ON finance_entries
FOR EACH STATEMENT EXECUTE FUNCTION finance_entry_append_only();
