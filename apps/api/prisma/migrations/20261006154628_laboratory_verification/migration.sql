-- L2 : aucune approbation ni identité déduite des anciens dossiers.
-- Les attributions/résultats existants restent conservés ; accès laboratoire fermé
-- tant qu’une nouvelle revue complète n’a pas posé verifiedAt.
-- AlterTable
ALTER TABLE "kyc_submissions" ADD COLUMN     "labIdentity" JSONB;

-- AlterTable
ALTER TABLE "labs" ADD COLUMN     "licenseNumber" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3);
