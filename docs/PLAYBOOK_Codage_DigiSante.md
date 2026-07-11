# Playbook de codage — DigiSanté Mobile avec Claude Code (CLI)

> Séquence de prompts pour construire le projet de zéro, en local, jusqu'à l'état « prêt à déployer sur le VPS ».
> À ranger dans `docs/`. Travaille **un prompt à la fois**.

## Règles d'usage (à respecter pour garder de la qualité)

1. **Un prompt = une tâche.** Ne lance pas le suivant tant que le précédent n'est pas validé et testé.
2. **Commit après chaque prompt** (commits conventionnels : `feat:`, `fix:`, `chore:`). Cela donne des points de retour propres.
3. **Nouvelle session / `/clear` entre les phases** pour ne pas saturer le contexte de Claude Code.
4. **Laisse Claude lire d'abord.** Chaque prompt commence par lui dire quels documents consulter.
5. **Vérifie que ça tourne** (`pnpm dev`, `curl`, navigateur) avant d'avancer.
6. **CLAUDE.md fait loi.** Si Claude propose Supabase, Railway, Vercel ou de toucher à la logique de paiement gelée → refuse et rappelle la règle.

---

## PHASE 0 — Préparation & socle

### P0.1 — Cadrage et audit du squelette
```
Lis CLAUDE.md, docs/INDEX_Documentation_DigiSante.docx puis README.md.
Fais un état des lieux du monorepo actuel (apps/web, apps/api, packages, infra) :
ce qui est en place vs ce qui manque pour atteindre un projet complet
(147 endpoints REST + 1 WebSocket / 27 modules, 43 modèles Prisma, 59 pages, 4 langues, offline-first).
Ne code rien encore. Propose-moi un PLAN DE CONSTRUCTION par lots, avec l'ordre
des dépendances (données → API → intégrations → frontend → tests). Liste les
risques et les points à clarifier.
```

### P0.2 — Package partagé (types, enums, i18n)
```
En respectant CLAUDE.md, complète packages/shared : définis en TypeScript tous les
enums métier (rôles, langues FR/EN/FON/YOR, statuts RDV/paiement/KYC…)
et les schémas zod partagés entre web et api. Prépare aussi la structure des clés
i18n (namespaces : onboarding, dmp, sos, payments, labo, education…).
Aucune chaîne d'UI en dur ailleurs que dans les fichiers de traduction.
Vérifie le typecheck. Commit : "feat(shared): enums, schémas zod et clés i18n".
```

---

## PHASE 1 — Couche données (Prisma)

### P1.1 — Schéma Prisma complet
```
Lis docs/technique/DocTech_DigiSante_Mobile_v2.docx et docs/ui/Specs_UI_DigiSante_v2.docx.
Conçois le schéma Prisma complet dans apps/api/prisma/schema.prisma : les 36 modèles
et 28 enums du domaine (User, Patient, Professional, Consultation, Appointment, DMP,
Prescription, Pharmacy, Laboratory, Payment, Wallet, DiasporaLink, Reminder,
Notification, EducationArticle, Translation, KycDossier, AuditLog, Subscription, etc.),
avec relations, index et contraintes.
Contraintes : PostgreSQL 16 natif ; l'AuditLog est APPEND-ONLY (hash SHA-256 chaîné).
Supprime les modèles d'exemple du squelette. Génère la 1re migration.
Commit : "feat(db): schéma Prisma complet (36 modèles)".
```

### P1.2 — Trigger d'immuabilité de l'audit + seed
```
Ajoute une migration SQL manuelle qui pose un trigger PostgreSQL interdisant
UPDATE et DELETE sur la table AuditLog (conformité Loi N°2017-20 / APDP).
Écris ensuite un seed réaliste (apps/api/prisma/seed.ts) : un admin, 2 médecins
vérifiés, quelques patients multilingues, une pharmacie, un labo, un compte diaspora,
des articles éducatifs. Lance migrate + seed et vérifie avec Prisma Studio.
Commit : "feat(db): audit append-only + seed".
```

---

## PHASE 2 — Socle API (Fastify)

### P2.1 — Fondations transverses
```
En respectant CLAUDE.md, mets en place les fondations de apps/api :
gestion d'erreurs centralisée, enveloppe de réponse cohérente, pipeline de
validation zod (réutilisant packages/shared), logging structuré (pino),
hooks onRequest/onResponse. Conserve les plugins prisma et redis existants.
Ajoute un /api/v1/health et /ready déjà présents. Commit : "feat(api): socle erreurs, validation, logging".
```

### P2.2 — Authentification (OTP + JWT)
```
Implémente le module auth dans apps/api/src/modules/auth :
- inscription/connexion par téléphone + OTP (envoi via le service Twilio — pour
  l'instant un stub si les clés ne sont pas configurées),
- vérification OTP, JWT access + refresh,
- verrouillage 30 min après 5 échecs (AUTH_FAIL journalisé dans l'audit),
- option « OTP par appel vocal » (Fɔ̀ngbè) côté contrat d'API.
Respecte la conformité APDP. Écris les tests Vitest du module. 
Commit : "feat(api): authentification OTP + JWT".
```

### P2.3 — RBAC, consentement DMP & journalisation d'audit
```
Ajoute trois mécanismes transverses, réutilisables par tous les modules :
1) un guard RBAC par rôle (PATIENT, MEDECIN, PHARMACIE, LABORATOIRE, DIASPORA, ADMIN),
2) un guard de consentement DMP : un soignant ne lit le dossier d'un patient QUE si
   un consentement actif (non expiré) existe ; sinon refus journalisé (DMP_DENIED).
   IMPORTANT : aucun rôle admin ne peut lire le contenu médical du DMP.
3) un service d'audit qui écrit chaque action sensible dans AuditLog avec hash chaîné.
Tests Vitest pour les cas consenti / refusé / admin. 
Commit : "feat(api): RBAC, consentement DMP, audit".
```

---

## PHASE 3 — Modules métier API

### P3.1 — Utilisateurs, professionnels, KYC
```
Implémente les modules users, professionals et kyc.
- profils patient/médecin/pharmacie/labo, langues parlées,
- soumission de dossier KYC (upload docs), workflow de revue admin,
- contre-vérification du N° Ordre (CNOM) — stub d'intégration externe,
- badge « vérifié » débloquant les consultations payantes.
Respecte RBAC et audit (KYC_APPROVE / KYC_REJECT journalisés). Tests. 
Commit : "feat(api): users, professionals, KYC".
```

### P3.2 — RDV, agenda & téléconsultation
```
Implémente les modules appointments et consultations.
- créneaux médecin, prise/confirmation/annulation de RDV, agenda,
- triage/priorisation, référencement entre médecins,
- téléconsultation via Daily.co (création de salle, jetons) — service isolé,
- bascule chat/audio si réseau faible (côté contrat).
Le remboursement d'un RDV annulé par le médecin doit déclencher la logique paiement
(à brancher en Phase 4). Tests des règles de réservation. 
Commit : "feat(api): RDV, agenda, téléconsultation".
```

### P3.3 — DMP, prescriptions, rappels
```
Implémente les modules dmp, prescriptions et reminders.
- DMP : constantes, historique, partages avec expiration, export FHIR + PDF (portabilité),
- prescriptions : lignes en DCI, vérification d'allergies/interactions, signature
  numérique (N° Ordre), génération QR + statut de délivrance,
- rappels de traitement avec observance, notifications dans la langue du patient.
Tout accès DMP passe par le guard de consentement (Phase 2.3). Tests. 
Commit : "feat(api): DMP, prescriptions, rappels".
```

### P3.4 — Pharmacie & laboratoire
```
Implémente les modules pharmacy et laboratory.
- pharmacie : scan QR d'ordonnance, vérification d'authenticité, délivrance
  partielle/totale, suggestion de générique, notification patient + médecin,
- labo : saisie de résultats structurés, détection de VALEUR CRITIQUE qui déclenche
  une alerte prescripteur prioritaire (push + SMS) journalisée (LAB_CRITICAL).
Tests des deux flux. Commit : "feat(api): pharmacie, laboratoire".
```

### P3.5 — Éducation (CMS), traductions, admin/métriques
```
Implémente les modules education, translations et admin.
- éducation : articles avec workflow Brouillon → Relecture médicale → Traductions →
  Publié, validation par professionnel vérifié, publication par langue, audio,
- translations : gestion des clés i18n des 4 langues, double validation des clés
  critiques (sos.*, labo.*, payments.*),
- admin : métriques (utilisateurs, consultations, volume FedaPay, uptime), file KYC,
  gestion utilisateurs (sans accès au contenu DMP), consultation de l'audit trail.
Tests. Commit : "feat(api): éducation CMS, traductions, admin".
```

---

## PHASE 4 — Intégrations & paiements

### P4.1 — FedaPay, wallet diaspora, abonnements
```
Lis la partie paiements de DocTech_DigiSante_Mobile_v2.docx.
Implémente le module payments :
- FedaPay (MTN MoMo, Moov, cartes internationales), commission plateforme 3 %,
- wallet diaspora (recharge € → FCFA, paiement des soins de la famille),
- abonnements professionnels,
- webhooks SIGNÉS HMAC vérifiés, retry x5 puis DLQ, réconciliation cron quotidienne.
ATTENTION : si une logique de paiement validée existe déjà, NE la modifie pas (gelée).
Tests des webhooks (signature valide/invalide, idempotence). 
Commit : "feat(api): FedaPay, wallet diaspora, abonnements".
```

### P4.2 — Notifications (push, SMS, email) multilingues
```
Implémente le module notifications avec trois canaux :
- Firebase FCM (push), Twilio (SMS, dont SOS et OTP vocal Fɔ̀ngbè), Resend (email).
- gabarits multilingues : chaque message part dans la langue de l'utilisateur.
- le SOS et les alertes critiques restent prioritaires.
Branche les déclencheurs des modules précédents (rappels, résultats labo, paiements).
Stubs propres quand les clés ne sont pas configurées en local. Tests. 
Commit : "feat(api): notifications multicanal multilingues".
```

> À ce stade : `curl` les endpoints clés, vérifier `/ready`, lancer toute la suite Vitest. **Phase API terminée.**

---

## PHASE 5 — Socle frontend (Next.js + design system)

### P5.1 — Design system « Wax & Terre »
```
Vérifie que la skill digisante-design-system est installée (~/.claude/skills/).
Dans apps/web, mets en place le design system : tailwind.config (tokens sante/terre/
indigo/ocre/sos/creme/nuit), polices Bricolage Grotesque + DM Sans, patterns.css
(bogolan, wax, kente, nkyinkyim, card-pagne, stitch), thèmes par espace.
Crée les composants de base (Button, CardPagne, Badge, StatusBar, BottomNav, KenteBar…)
fidèles aux prototypes docs/ui/prototypes/. Commit : "feat(web): design system Wax & Terre".
```

### P5.2 — i18n 4 langues + sélecteur
```
Mets en place l'internationalisation (4 langues) dans apps/web à partir des clés de
packages/shared : provider i18n, sélecteur de langue présent sur chaque écran,
salutations natives, support des contenus audio (Fɔ̀ngbè). 
Aucune chaîne en dur. Commit : "feat(web): i18n 4 langues".
```

### P5.3 — PWA & offline-first
```
Rends apps/web installable et offline-first (exigence non négociable, cf. CLAUDE.md) :
manifest, service worker (cache de l'app shell + motifs CSS), file de synchronisation
en IndexedDB pour les actions hors-ligne (ex. saisie de constantes), indicateur d'état
réseau, et un client API typé avec retry/queue. Le SOS doit fonctionner hors-ligne
(repli SMS). Commit : "feat(web): PWA offline-first + sync".
```

### P5.4 — Auth front + routes protégées
```
Implémente le flux d'authentification côté web : onboarding choix de langue (D-01),
saisie OTP (D-02), stockage sécurisé des tokens, refresh, et la protection des routes
par rôle. Redirige chaque rôle vers son espace. Fidélité visuelle aux prototypes.
Commit : "feat(web): auth, onboarding, routes protégées".
```

---

## PHASE 6 — Écrans frontend par espace

> Pour chaque lot : « implémente ces écrans en composants Next.js 14, fidèles aux
> prototypes docs/ui/prototypes/ et à la skill, branchés sur l'API, avec états
> chargement/erreur/vide, et comportement hors-ligne défini. »

### P6.1 — Patient core (D-03, D-04, D-05, D-08)
```
Implémente les écrans patient : dashboard (D-03), DMP (D-04), recherche + profil
médecin (D-05), ordonnance + paiement (D-08). Branche-les sur l'API (RDV, DMP,
prescriptions, paiements). Fidélité aux prototypes et à la skill. États gérés.
Commit : "feat(web): écrans patient core".
```

### P6.2 — Patient avancé (D-06, D-07, D-09 à D-13)
```
Implémente : téléconsultation Daily.co (D-06), SOS (D-07, octogone, géoloc, SMS
Fɔ̀ngbè, actif hors-ligne), rappels (D-09), chat faible connexion (D-10), résultats
labo + audio (D-11), profil & paramètres (D-12), mode hors-ligne (D-13).
Commit : "feat(web): écrans patient avancé".
```

### P6.3 — Médecin PRO (D-14 à D-19)
```
Implémente l'espace médecin (thème indigo) : dashboard + file live (D-14), agenda
(D-15), vue 360° patient (D-16, accès soumis au consentement), prescription assistée
(D-17, alerte allergie), stats & revenus (D-18), KYC pro (D-19).
Commit : "feat(web): espace médecin PRO".
```

### P6.4 — Diaspora, pharmacie, labo (D-20 à D-23)
```
Implémente : dashboard diaspora (D-20), wallet € → FCFA (D-21), pharmacie scan QR
(D-22), saisie résultats labo avec valeur critique (D-23). Branche wallet et
notifications. Commit : "feat(web): diaspora, pharmacie, labo".
```

### P6.5 — Admin (D-24, D-25, D-26 + desktop)
```
Implémente l'espace admin (mobile + desktop) : métriques (D-24), utilisateurs & audit
(D-25), éducation/CMS (D-26), plus les vues desktop (dashboard, KYC review, traductions,
utilisateurs, paiements, audit, éducation) d'après docs/ui/prototypes/. Rappel :
l'admin ne lit jamais le contenu médical. Commit : "feat(web): espace admin".
```

---

## PHASE 7 — Transverse & qualité

### P7.1 — Parcours de bout en bout (continuités)
```
Vérifie et corrige les 3 continuités inter-lots de la démo :
(1) tension saisie hors-ligne (D-13) → sync → chat (D-10) → vue médecin (D-16) ;
(2) ordonnance signée (D-17) → patient (D-08) → scan pharmacie (D-22) ;
(3) wallet rechargé (D-21) → paiement (D-08) → notification diaspora (D-20).
Écris des tests d'intégration qui couvrent ces 3 chaînes. 
Commit : "test: parcours inter-lots".
```

### P7.2 — Audit de sécurité (OWASP / STRIDE)
```
Réalise un audit de sécurité du projet (OWASP Top 10 + STRIDE) : auth, RBAC,
consentement DMP, webhooks signés, injection, secrets, en-têtes HTTP, rate-limit.
Liste les vulnérabilités par criticité et corrige les bloquantes. Ne touche pas à la
logique de paiement gelée sans me prévenir. Commit : "fix(security): corrections audit OWASP/STRIDE".
```

### P7.3 — Couverture de tests
```
Complète la couverture Vitest : unit (services, guards) + intégration (modules clés).
Vise les chemins critiques : OTP/lockout, consentement DMP, webhooks paiement,
valeur critique labo, sync offline. Tout doit passer en local. 
Commit : "test: couverture chemins critiques".
```

---

## PHASE 8 — Pré-déploiement (local → prêt VPS)

### P8.1 — Build de production & PM2
```
Prépare la mise en production (sans déployer) : vérifie pnpm build (web + api),
crée ecosystem.config.cjs pour PM2 (cluster sur l'api), valide les variables
d'environnement requises, et documente la liste des secrets à définir sur le VPS.
Commit : "chore: build prod + config PM2".
```

### P8.2 — Préparer le déploiement VPS Infomaniak
```
À partir des scripts de DocTech_DigiSante_Mobile_v2.docx, prépare (sans exécuter) :
le bloc Nginx (reverse proxy + SSL Certbot), le cron pg_dump chiffré, et active le job
deploy SSH dans .github/workflows/ci.yml (secrets VPS_HOST/USER/SSH_KEY).
Rappel : PostgreSQL 16 NATIF sur le VPS, jamais Docker en prod, jamais Supabase.
Donne-moi la checklist finale de déploiement. Commit : "chore: préparation déploiement VPS".
```

---

## Après la Phase 8

Le projet tourne en local, testé, et tout est prêt pour le déploiement réel sur le VPS
Infomaniak (étape manuelle/CI séparée). Reprends alors la procédure de la DocTech
pour le provisioning du serveur.

---

### Astuce — prompt de reprise de session
À chaque nouvelle session Claude Code :
```
Relis CLAUDE.md et docs/INDEX_Documentation_DigiSante.docx. Où en est-on dans le
playbook docs/PLAYBOOK_Codage_DigiSante.md ? Reprenons à l'étape [PX.Y].
```
