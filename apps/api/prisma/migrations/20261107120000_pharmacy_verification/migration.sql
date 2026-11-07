-- Habilitation pharmacie (même principe que L2 laboratoire) : aucun badge déduit
-- de l'historique. Les pharmacies existantes restent NON vérifiées tant qu'une
-- revue KYC (identité du responsable + autorisation d'exercice) ne l'a pas posé ;
-- scan/délivrance fermés et officine absente de la recherche patient d'ici là.
-- Migration purement additive (colonne NULL), sans reprise automatique.
-- AlterTable
ALTER TABLE "pharmacies" ADD COLUMN     "verifiedAt" TIMESTAMP(3);
