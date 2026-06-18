-- Recentrage du périmètre linguistique : FR · EN · FON · YOR
-- (ajout de YOR ; retrait de BARIBA / DENDI). PostgreSQL ne permet pas de
-- supprimer une valeur d'enum → recréation du type avec bascule de TOUTES les
-- colonnes dépendantes (users.lang ET profiles.spokenLangs[]).
-- Toute valeur BARIBA/DENDI est ramenée à FR (repli par défaut, sûr).

-- 1) Renommer l'ancien type.
ALTER TYPE "Lang" RENAME TO "Lang_old";

-- 2) Créer le nouveau type cible.
CREATE TYPE "Lang" AS ENUM ('FR', 'EN', 'FON', 'YOR');

-- 3) Basculer users.lang (scalaire) en repliant les valeurs retirées sur FR.
ALTER TABLE "users" ALTER COLUMN "lang" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "lang" TYPE "Lang" USING (
  CASE WHEN "lang"::text IN ('BARIBA', 'DENDI') THEN 'FR' ELSE "lang"::text END::"Lang"
);
ALTER TABLE "users" ALTER COLUMN "lang" SET DEFAULT 'FR';

-- 4) Basculer profiles.spokenLangs (tableau) : repli BARIBA/DENDI → FR.
--    array_replace évite toute sous-requête (interdite dans un USING).
ALTER TABLE "profiles" ALTER COLUMN "spokenLangs" DROP DEFAULT;
ALTER TABLE "profiles" ALTER COLUMN "spokenLangs" TYPE "Lang"[] USING (
  array_replace(array_replace("spokenLangs"::text[], 'BARIBA', 'FR'), 'DENDI', 'FR')::"Lang"[]
);
ALTER TABLE "profiles" ALTER COLUMN "spokenLangs" SET DEFAULT '{}';

-- 4b) Dédupliquer les FR éventuellement introduits par le repli.
UPDATE "profiles"
SET "spokenLangs" = ARRAY(SELECT DISTINCT x FROM unnest("spokenLangs") AS x)
WHERE cardinality("spokenLangs") > 1;

-- 5) Supprimer l'ancien type (plus aucune dépendance).
DROP TYPE "Lang_old";
