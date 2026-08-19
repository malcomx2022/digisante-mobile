-- Envoi d'argent à un proche (écart E3) : le destinataire doit pouvoir lire,
-- dans son historique, que l'argent vient d'un proche et non d'une recharge
-- FedaPay. Ajout PUREMENT ADDITIF d'une valeur d'enum : contrairement au
-- RETRAIT d'une valeur (cf. le type `Lang`, qui a imposé une recréation
-- complète du type), `ADD VALUE` ne touche aucune ligne existante.
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'TRANSFER_IN';
