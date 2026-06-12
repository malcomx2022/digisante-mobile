-- AlterTable
ALTER TABLE "health_contents" ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'DRAFT';

