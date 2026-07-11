# Plan — Rôle Agent de Santé Communautaire (ASC / relais)

> **Décidé (session 11/07/2026)** : modèle **A (relais « aveugle »)** · **nouveau rôle `ASC`** ·
> périmètre v1 = enrôlement/roster + observations (constantes/triage) + **signalement au médecin**.
> La prise de RDV « au nom du patient » est **différée** (exige de lier un vrai compte patient).

## Invariants (§3/§4)

- **Jamais de lecture DMP** par l'ASC. L'ASC ne voit **que son propre roster** (cloisonné par `ascId`).
- Les observations de l'ASC sont un **journal opérationnel** (comme le carnet diaspora `Beneficiary`),
  **pas** un DMP patient chiffré. Aucune donnée médicale d'un patient tiers n'est exposée.
- **Nouveau rôle `ASC`** ajouté à l'enum `Role` (additif) — inscription possible avec une **zone**
  (le programme national vet les ASC en pratique ; comme les médecins passent le KYC).
- Le **signalement** partage la fiche opérationnelle d'un bénéficiaire avec **un médecin choisi**
  (Notification) — c'est un relais assumé, pas un accès DMP.

## Données

- `Role += ASC` (enum) ; `ROLES` partagé mis à jour.
- `CommunityHealthWorker` : profil de rôle (userId unique, `zone`). Créé à l'inscription (`auth.register`).
- `AscBeneficiary` : entrée du roster (ascId, name, phone?, village?, birthDate?, notes?). Cloisonné.
- `AscObservation` : journal par bénéficiaire (constantes + résultat de triage + note libre).

## API (`/api/v1/asc`, rôle ASC)

`GET /beneficiaries` · `POST /beneficiaries` · `PATCH/DELETE /beneficiaries/:id` ·
`GET /beneficiaries/:id` (fiche + observations) · `POST /beneficiaries/:id/observations` ·
`POST /beneficiaries/:id/relay` (→ Notification à un médecin vérifié).

## Frontend

Espace **ASC** (coquille dédiée, thème distinct) : roster du village, fiche bénéficiaire
(observations + signalement), formulaire d'ajout. Inscription : le rôle ASC + champ zone.
i18n FR/EN, FON/YOR repli FR.

## Lots

1. **Backend + rôle** : enum + 3 modèles + migration ; `ROLES`/`SPACE_PATH` ; `auth.register` (case ASC) ;
   module `asc` + routes + tests (cloisonnement §4).
2. **Frontend** : espace ASC + pages + i18n + support inscription.

## v2 (différé)

Prise de RDV au nom du patient (lien compte) ; accès scindé **B** (consentement `Consent` par-entrée) ;
supervision (agrégats anonymisés) côté admin.
