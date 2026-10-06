-- Restitution d'un paiement WALLET : mouvement entrant, sans réinterpréter
-- les anciennes lignes REFUND (reversal sortant d'une recharge).
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'REFUND_IN';
