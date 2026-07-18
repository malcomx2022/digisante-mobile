-- Upload réel des pièces KYC (P1) : métadonnées du fichier chiffré sur disque.
ALTER TABLE "kyc_documents" ADD COLUMN "mimeType" TEXT;
ALTER TABLE "kyc_documents" ADD COLUMN "fileName" TEXT;
