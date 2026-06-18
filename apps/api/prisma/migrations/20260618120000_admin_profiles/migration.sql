-- CreateTable
CREATE TABLE "admin_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preset" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_profiles_userId_key" ON "admin_profiles"("userId");

-- AddForeignKey
ALTER TABLE "admin_profiles" ADD CONSTRAINT "admin_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill : tout administrateur existant devient super-admin (sinon il se
-- verrouillerait, faute de scopes). Les nouveaux admins reçoivent un profil
-- explicite à la création.
INSERT INTO "admin_profiles" ("id", "userId", "scopes", "preset", "createdAt", "updatedAt")
SELECT
  'adm_' || "id",
  "id",
  ARRAY['admin:manage','users:read','users:write','kyc:review','ops:read','finance:read','finance:write','support:write','otp:write','webhooks:read','webhooks:replay','audit:read','audit:export','education:write']::TEXT[],
  'SUPER_ADMIN',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "users"
WHERE "role" = 'ADMIN';
