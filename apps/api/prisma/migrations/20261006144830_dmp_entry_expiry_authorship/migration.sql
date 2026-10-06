-- AlterTable
ALTER TABLE "consent_records" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "medical_records" ADD COLUMN     "authorId" TEXT,
ADD COLUMN     "authorRole" "Role";

-- Reprise fermée : les anciens liens restent NULL et n'autorisent aucune lecture.
-- Le schéma historique ne conserve ni l'échéance par entrée ni le jeton réclamé.
-- shareExpiry décrit le QR courant (réémissible) et Consent.expiresAt a pu être
-- écrasé par une autre entrée. Les dates de modification ne prouvent pas le bail.
-- Aucun UPDATE historique : liens, dates, contenus et preuves existants conservés.
-- Exiger une nouvelle réclamation de partage ; ré-octroi préalable si révoqué.
-- Aucun auteur ancien n'est inféré du propriétaire ou d'un simple accès audité.
