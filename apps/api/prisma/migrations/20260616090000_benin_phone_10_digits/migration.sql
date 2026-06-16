-- ─────────────────────────────────────────────────────────────
-- Réforme ARCEP Bénin 2024 — passage des numéros nationaux de 8 à 10 chiffres
-- avec le préfixe « 01 » (ex. +22996466777 → +2290196466777).
--
-- Migration de DONNÉES (aucun changement de structure) : pour chaque colonne
-- téléphone, préfixer « 01 » au numéro national des entrées ENCORE en 8 chiffres.
--
-- IDEMPOTENCE : le filtre WHERE ne cible QUE les numéros béninois legacy à
-- exactement 8 chiffres (`^\+229\d{8}$`). Les numéros déjà en 10 chiffres ne
-- matchent pas (ré-exécution sans effet) et les numéros diaspora (autre
-- indicatif) sont ignorés. Le regex exclut naturellement les valeurs NULL.
-- `substring(... from 5)` repart après « +229 » (positions 1-4) → national seul.
-- ─────────────────────────────────────────────────────────────

-- User.phone (@unique) — clé d'authentification.
UPDATE "users" SET "phone" = '+22901' || substring("phone" from 5) WHERE "phone" ~ '^\+229\d{8}$';

-- Profile.emergencyContact — contact d'urgence (peut être un numéro diaspora → ignoré).
UPDATE "profiles" SET "emergencyContact" = '+22901' || substring("emergencyContact" from 5) WHERE "emergencyContact" ~ '^\+229\d{8}$';

-- Pharmacy.phone — officine.
UPDATE "pharmacies" SET "phone" = '+22901' || substring("phone" from 5) WHERE "phone" ~ '^\+229\d{8}$';

-- Lab.phone — laboratoire.
UPDATE "labs" SET "phone" = '+22901' || substring("phone" from 5) WHERE "phone" ~ '^\+229\d{8}$';

-- Beneficiary.phone — proche au Bénin (peut être un numéro diaspora → ignoré).
UPDATE "beneficiaries" SET "phone" = '+22901' || substring("phone" from 5) WHERE "phone" ~ '^\+229\d{8}$';
