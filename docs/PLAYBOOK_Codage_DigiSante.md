# Playbook de codage — DigiSanté Mobile avec Claude Code (CLI)

> Séquence historique de construction, complétée par la maintenance et le plan actif de finalisation.
> À ranger dans `docs/`. Travaille **un prompt à la fois**.

**Reprise actuelle — 6 octobre 2026 :** utiliser `docs/PLAN_Implementations_Restantes_2026-10.md` (L0–L11) et son prompt commun. Les phases 0–8 ci-dessous sont historiques : ne pas recréer les modules déjà livrés et ne pas prendre leurs compteurs ou fonctions cibles pour des preuves actuelles.

## Règles d'usage (à respecter pour garder de la qualité)

1. **Un prompt = une tâche.** Ne lance pas le suivant tant que le précédent n'est pas validé et testé.
2. **Commit après chaque prompt** (commits conventionnels : `feat:`, `fix:`, `chore:`). Cela donne des points de retour propres.
3. **Nouvelle session / `/clear` entre les phases** pour ne pas saturer le contexte de Claude Code.
4. **Laisse Claude lire d'abord.** Chaque prompt commence par lui dire quels documents consulter.
5. **Vérifie que ça tourne** (`pnpm dev`, `curl`, navigateur) avant d'avancer.
6. **Lire CLAUDE.md avant toute maintenance.** Préserver la stack canonique. La zone paiement gelée exige une revue explicite et les re-tests ; les quatre corrections du 6 octobre 2026 ont été demandées explicitement après revue. Ne pas réintroduire les comportements antérieurs à partir des prompts historiques ci-dessous.

---

## Maintenance après revue — 6 octobre 2026

Le projet initial a été produit avec Claude Code. Les corrections ci-dessous ont été appliquées par Codex à la demande de l'utilisateur ; `CLAUDE.md` §8 décrit les invariants à conserver lors de la reprise par Claude Code.

1. Relire le statut et le rôle en DB à chaque requête JWT protégée (suspension → 401 immédiat à la prochaine requête). Refuser aussi les nouvelles connexions chat suspendues ; les sockets existants restent bornés par l'expiration du JWT.
2. Distinguer remboursement **entrant** d'un paiement WALLET (`REFUND_IN`) et reversal **sortant** d'une recharge (`REFUND`). Garder mouvement + transition atomiques, y compris lors d'un remboursement concurrent ou d'un échec du crédit.
3. Réconcilier PENDING **et** PROCESSING anciens ; partager `reconciliationWhere` avec la supervision finance.
4. Réserver sous verrou PostgreSQL de la ligne médecin, dans une transaction READ COMMITTED couvrant lecture des conflits + insertion. Tester concurrence, chevauchement autour de minuit et créneaux adjacents.

**Ordre de mise à jour (procédure L10 actuelle)** : sauvegarde complète sur cible alimentée → maintenance/arrêt anciens workers → SHA exact → install gelé → prisma generate → build → migrate deploy → démarrage homogène/readiness. La migration additive `20261006130000_wallet_refund_in` doit être appliquée avant le code qui écrit REFUND_IN. Aucune ligne REFUND existante n'est reclassée automatiquement. Les anciens paiements WALLET déjà marqués REFUNDED sans restitution nécessitent un rapprochement manuel (ne pas les recréditer en masse sans preuve).

**Validation** : suite API sur PostgreSQL 16 + Redis dédiés aux tests (Redis /1, jamais la base de production), suite web, lint/typecheck, build et `pnpm metrics:check`. Les tests FedaPay utilisent les signatures réelles et des réponses fournisseur simulées ; la recette sandbox S1–S7 reste requise avant bascule live. Résultats exécutés le **6 octobre 2026** sur PostgreSQL 16 et Redis dans des conteneurs locaux dédiés (Docker uniquement pour les tests, production toujours PostgreSQL natif) : **390 tests API + 50 tests web verts**, lint/typecheck API et web verts, builds shared/API/web verts, `prisma validate` vert, 29 migrations appliquées et `prisma migrate diff` sans dérive, compteurs conformes. Les 8 E2E ont ensuite été exécutés avec succès au lot L0 ; la recette fournisseur réelle reste non exécutée. Preuves et limites : `docs/suivi/LOT_L0.md`, revue : `docs/REVUE_L0_2026-10.md`. Parité i18n EN : 100 % ; le nouveau libellé REFUND_IN utilise le repli FR en FON/YOR, et les six clés critiques FON/YOR déjà manquantes restent à faire valider.

---

## Lot L1 — DMP (6 octobre 2026)

Implémentation sur `feat/l1-dmp-consent-authorship` : échéance par ConsentRecord, auteur authentifié sur MedicalRecord, garde commune pour lectures/export/documents et verrou par patient sur les transitions. Migration 29→30 additive : tous les anciens liens restent NULL (fermés), sans inférence d'auteur ni de bail depuis un QR réémis. Un ré-octroi explicite ne rend pas un lien NULL lisible ; nouveau partage requis. Aucun droit de lecture du fait d'être auteur.

Relire `docs/suivi/LOT_L1.md` (droits, reprise/rollback, preuves et statut), `docs/REVUE_L1_2026-10.md` et l'addendum X1/X2. Compteurs à la validation L1 : 412 tests API + 50 web, 30 migrations ; release:check final vert (11 étapes), 8 E2E verts ; livraison/CI dans la fiche et PR du lot. Les chiffres L0 ci-dessus restent historiques. La recette physique/clinique demeure non exécutée.

## Lot L2 — Laboratoires (6 octobre 2026)

L1 fusionné par PR #181 sur main `53775be` ; L2 repart de cette base sur `feat/l2-laboratory-verification`. Identité de structure, pièces obligatoires du responsable/autorisation, soumission figée et revue manuelle réutilisent le KYC existant. Le médecin conserve sa politique CNOM. Badge laboratoire + compte actif sous verrou pour lire/prendre/traiter ses demandes ; prescriptions ciblées compatibles, claim concurrent conditionnel ; publication et notifications DB atomiques.

Lire LOT_L2, REVUE_L2 et l'addendum X3 avant toute maintenance. Migration 30→31 : aucun laboratoire historique habilité automatiquement. APPROVED sans badge → nouveau dossier ; ancien UNDER_REVIEW sans identité figée → correction/resoumission. Chaque nouvelle soumission réinitialise la vérification des pièces. Suspension : droits fermés, attribution conservée, réactivation explicite seulement. Ne pas revenir aux anciens guards ni recopier les historiques en badges.

Parcours `/labo/kyc` et admin existant, design depuis la skill versionnée dans `docs/skill/digisante-design-system-skill.zip`. Actions en ligne, FR/EN et repli FR FON/YOR sans validation native. La fiche L2 porte résultats/limites/livraison ; aucune recette juridique, physique ou clinique n'est déduite du navigateur émulé. Actualiser le plan/DOCX et les compteurs, puis attendre la fusion du lot avant la prochaine branche dépendante.

## Lot L3 — Rejeu sans doublon (6 octobre 2026)

L2 livré sur main par #182 (`eb1ba6e`). Relire `docs/CONTRAT_Synchronisation_L3.md`, LOT_L3 et REVUE_L3 avant toute maintenance du client ou des huit mutations. Shared définit la liste positive et les durées ; conserver la clé et le corps photographié avant premier fetch. Effet métier et reçu AES-GCM restent dans la même transaction, contrôle courant avant restitution ; pas de déduplication Redis seule. Ne pas élargir les routes sans transaction et tests de panne/concurrence/droits. Les anciennes files ambiguës sont conservées pour revue, sans UUID de remplacement. Les limites locales de L3 sont complétées par L4 ci-dessous ; l’héritage non migré reste en clair.

Preuves L3 : 460 API +64 web +11 E2E, 28 tests outillage et 11 étapes de release verts ; migration 31→32 conservatrice. Livraison/CI dans LOT_L3 et la PR. Reproduire les tests de réponse perdue après commit, deux onglets, redémarrage, rollback du reçu, conflit de contenu, isolement/401 et expiration après purge. Relancer release/E2E et actualiser les documents par lot ; recette physique distincte.

## Lot L4 — Coffre et disponibilité hors ligne (7 octobre 2026)

L3 livré sur main par #183 (`ce1cae8`). Lire `CONTRAT_Hors_Ligne_L4.md`, LOT_L4 et REVUE_L4 avant maintenance. Réutiliser le coffre unique, la projection minimale et les contrôles du compte/génération ; pas de cache d’API, phrase/clé/JWT persistés ou clé serveur copiée. Récupérer les corps scellés seulement après unlock ; sans coffre, ticket minimal et vérification GET, aucune reconstitution d’effet. Refus de refresh 401/403 distinct d’une panne temporaire. Toute tentative en ligne non résolue impose une revue avant nouvelle saisie.

Migration v3→v4 additive, corps/id/clé conservés atomiquement. L’héritage d’un autre compte/non attribuable reste en clair : migration de chaque compte ou effacement volontaire après vérification des effets avant prêt/pilote. Relire les tests purge pendant écritures, migration interrompue, quota, A→B, mauvaise phrase, expiration et réponse perdue/reload. Tests du SW + E2E réel hors réseau obligatoires ; émulation Pixel 5 ne signe aucune recette Android/iOS. Périmètre : 20 résumés DMP, 10×20 lignes sans QR, urgence minimale, TTL 24 h/alerte 6 h ; seuls les shells/assets publics entrent dans CacheStorage, API/fetch no-store contre le cache HTTP ; anciens caches navigateur à vider avant partage. L5/L6 livrés par #185/#186, L7 livré (#187), L8 code livré (#188), L9 technique livré (#189)/humain ouvert ; L10 outillage candidat et L11 ouvert, preuves dans les fiches de lot.

## Finalisation restante — reprise par lots L0–L11

Le plan actif détaille contrats, dépendances, fichiers de départ, migrations, tests et documents à actualiser. Exécuter son prompt commun avec l'instruction du lot retenu ; une branche par fonctionnalité et des PR cohérentes, sans refonte de stack.

1. **L0** : baseline et 8 E2E locaux verts, revue du diff réalisée, matrice CDC/pilote confirmée ; CI candidates vertes, PR #178/#179 fusionnées sur main `2ee3cfb` ; preuves et CI main dans la fiche L0.
2. **L1/L2/L3/L5** : expiration et auteur DMP, habilitation labo, rejeu idempotent, jetons Daily privés.
3. **L4** après L1/L3 : lectures et files médicales hors ligne protégées, gestion de clé et disponibilité réelle.
4. **L6/L7** : abonnements confirmés par paiement, périodes/droits, statistiques et circuit financier traçable.
5. **L8** : résiduels de sécurité ; **L9** : validation native/clinique, à préparer dès L0.
6. **L10/L11** : préproduction/fournisseurs puis appareils réels, restauration, rollback et nouveau GO/NO-GO.

**Après chaque lot :** fiche `docs/suivi/LOT_Lx.md` avec SHA, preuves et limites ; actualiser `CLAUDE.md` §1/§4/§8/§9, ce playbook et les runbooks impactés. Mesurer les compteurs ; ne pas réécrire les anciens PV. Régénérer le DOCX du plan via `node scripts/docs/generate-implementation-plan.js`, puis `python scripts/docs/validate-implementation-plan.py` (structure et concordance source ; rendu visuel à contrôler séparément). Les statuts PLANIFIÉ, IMPLÉMENTÉ, VALIDÉ et LIVRÉ sont distincts ; un commit n'atteste aucun déploiement.

**Revue systématique demandée par le porteur :** après chaque implémentation, produire `docs/REVUE_Lx_<date>.md`, corriger les défauts bloquants du diff et reprendre les contrôles impactés avant PR. Ne pas fusionner automatiquement. Le pilote conserve sept rôles et les abonnements médecins L6 ; les autres abonnements sont reportés après pilote par décision du 6 octobre.

**Contrôles :** tests ciblés pendant l'implémentation ; contrôles de release sur PostgreSQL/Redis dédiés, puis E2E et CI complète sur la candidate. `pnpm release:check` ne lance ni E2E, ni fournisseur, ni déploiement. Activer `--strict-i18n` à la clôture des traductions. Les changements paiements restent soumis à revue explicite et re-tests §5 selon l'autorisation de la session.

---

## Reprise après revue complète — 14 octobre 2026

Lire `docs/REVUE_Complete_Codex_2026-10-14.md` et `docs/suivi/LOT_Revue_2026-10-14.md` avant la prochaine édition. Candidate sur `codex/full-review-2026-10-14` depuis `b974080` : protections KYC/FCM/pharmacie/sessions/patients, atomisation annulation-remboursement §5, échéances/statistiques/anomalies finances et contrôle déploiement/provisioning. Conserver les invariants ajoutés dans CLAUDE.md ; tests simulés et preuves externes distincts.

Ancien instantané L9 archivé sans approbation ni réécriture de pièce signée ; nouveau dossier technique non signé à relire. Après fusion, requalifier SHA CI/L10. Dérouler la fiche L11 sur appareils/cibles autorisés, avec pièces privées et signatures ; aucune ouverture automatique.

## PHASE 0 — Préparation & socle

### P0.1 — Cadrage et audit du squelette
```
Lis CLAUDE.md, docs/INDEX_Documentation_DigiSante.docx puis README.md.
Fais un état des lieux du monorepo actuel (apps/web, apps/api, packages, infra) :
ce qui est en place vs ce qui manque pour atteindre un projet complet
(183 endpoints REST + 1 WebSocket / 28 modules, 53 modèles Prisma, 67 pages, 4 langues, offline-first).
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
- vérification OTP, JWT access + refresh ; relire statut/rôle à chaque requête protégée,
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
- créneaux médecin, prise/confirmation/annulation de RDV, agenda ; réservation sous
  verrou de ligne médecin (FOR UPDATE), contrôle + insertion en READ COMMITTED,
- triage/priorisation, référencement entre médecins,
- téléconsultation via Daily.co (création de salle, jetons) — service isolé,
- SDK Daily officiel : load sans token puis join sur instance chargée (piège SDK §8), jeton transmis par message hors URL/stockage, salle privée relue et deux jetons sans owner/admin ;
- AUDIO coupe réellement la caméra, CHAT/sortie/expiration détruit le média ; contrôle d’accès courant via polling (contrat L5), aucune file offline.
Le remboursement d'un RDV annulé par le médecin doit déclencher la logique paiement
(branché en Phase 4) : paiement WALLET → REFUND_IN crédité, recharge → REFUND
sortant, dans la transaction de transition. Tests des règles et de la concurrence.
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
- webhooks SIGNÉS HMAC vérifiés ; retries opérateur, réconciliation quotidienne
  des PENDING/PROCESSING > 1 h (aucune DLQ implémentée dans ce dépôt).
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
en IndexedDB chiffré pour les huit routes L3, uniquement après unlock, indicateur d'état
réseau, et un client API typé avec retry/queue. Contrat courant L4 : coquilles/assets publics seulement, coffre opt-in pour lectures/files médicales, jamais cache générique. SOS serveur exige le réseau ; appel/SMS explicites nécessitent couverture téléphonique. Commit : "feat(web): PWA offline-first + sync".
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
(1) action PEV saisie sous coffre ouvert hors-ligne (D-13) → sync → chat (D-10) → vue médecin (D-16) ;
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


## Reprise L5 — 7 octobre 2026

L4 livré par PR #184, base main `0d3cb74`. L5 livré sur main par PR #185 (`2e5cc77`) : lire `suivi/LOT_L5.md`, `REVUE_L5_2026-10.md` et le guide Daily. Tests fournisseur simulés, admission API DB réelle, média SDK simulé et E2E sans fournisseur ; l'appel réel deux appareils reste L10. Ne pas renouveler silencieusement les accès ni rétablir un mode moins dégradé. Une branche/revue/PR par lot ; L6 candidate, abonnement médecin seulement pour le pilote ; L7 candidate après fusion #186, autres abonnements après pilote.

## Contrat de reprise L6 — abonnement réellement payé

Lire `CONTRAT_Abonnements_L6.md`, `suivi/LOT_L6.md`, `REVUE_L6_2026-10.md` et `RECETTE_Abonnements_L6.md`. Catalogue approuvé par le porteur : FREE + PRO 5 000 XOF/mois calendaire, renouvellement manuel, STARTER/CLINIC fermés. Pas de plan/dates/prix imposés par le client ni de débit récurrent. Commande unique par UUID stable, lien Payment unique, effet période/audit atomique, droit courant dérivé de la période payée sans cron. FREE/expiration conservent les soins ouverts ; nouveau démarrage exige PRO. Abandon avant activation + paiement tardif = argent tracé sans droits, remboursement opérateur manuel. Re-tests §5 obligatoires ; la DLQ n’existe pas, ne pas la déclarer testée. Revenus L7 doivent distinguer recette plateforme abonnement et revenu médecin ; ne pas réintroduire POST subscriptions gratuit, paiement SUBSCRIPTION générique, file offline ou callback comme preuve.

## Contrat de reprise L7 — finance locale et preuves externes

Lire `CONTRAT_Finances_L7.md`, LOT_L7, revue et recette. Réutiliser journal CAPTURE/REFUND append-only et services financiers ; prix/commission/net snapshot, jours Lagos, montant payé distinct du net dû et du PAYOUT exécuté déclaré avec preuve. Scope finance sans DMP ; statistiques/CSV propriétaire PRO courant, receipt payeur et non fiscal approuvé. Verrou finance avant remboursement, allocations/compensation plafonnées et reliquats conservés ; UUID/empreinte de la sélection complète, audit dans transaction. Pas de backfill de dates/commissions legacy. Opérations externes manuelles : REQUESTED→EXECUTING→EXECUTED, aucune remise en file d’exécution incertaine, aucun appel opérateur automatique. Preuve originale hors application, référence opaque unique, identité/montant/devise vérifiés humainement. Faire re-tests §5 et navigateur ; langue native L9, réel L10, conservation/GO L11, audit X6 L8.

## Reprise L8 — sécurité, 7 octobre 2026

L7 livré sur main par #187 (`ebd0547`), CI main 37656606253 réussie ; L8 sur `feat/l8-security-residuals`. Lire `CONTRAT_Securite_L8.md`, l’addendum daté `AUDIT_Securite_L8_2026-10.md`, la revue et LOT_L8. Ne pas déclarer les réglages console/HTTPS, CSP à nonce ou le pentest effectués sans preuve humaine. X6 = Redis fail-closed, X12 = chaîne d’audit. Réponses publiques OTP génériques, HMAC avec clé infra, diagnostic seulement NODE_ENV=test ; durée refresh JWT/cookie/Redis unique. Audit effet DMP/KYC/labo transactionnel, horloge logique sous verrou et héritage vérifié avant bascule. Logs sans query/Referer/corps amont/exception brute ; error_log Nginx non expurgeable désactivé. Checkout exact partagé, redirections refusées, reconcile constant ; revue §5 et re-tests obligatoires. FCM normalisé, CSP prod sans eval/connect générique, exception CDN sur SW seul ; HSTS et Geo Permissions manuels L10, X8/risques résiduels à décider avant GO L11. Une branche, revue, PR et CI exact SHA par lot.


## Reprise L9 — 8 octobre 2026

L8 fusionné par #188 sur `4fc62c1`, CI main 37734382622 réussie ; gates externes sécurité toujours ouverts. L9 sur `feat/l9-native-clinical-validation` : lire contrat, revue, fiche et `validation/L9/README.md`. Le porteur annonce des retours validés mais fournira leurs références ultérieurement : préparer les contrôles et dossiers, jamais importer/inventer des textes ou signatures sans ces pièces.

À réception : vérifier identité/qualité/version/portée/réserves et conserver la pièce privée ; essai UI `import-validated --evidence-ref … --dry-run` puis diff, tests et PR. Phrasier et corrections cliniques suivent PR dédiée/diff explicitement confirmé et contreseing du dossier corrigé. Posologie existante incluse au dossier (fractions/mg/horaire/durée à qualifier), pas une acceptation. `validation:check` + validateur DOCX = preuve technique ; `validation:gate` = cohérence de preuves déclarées, aucun GO automatique. Les objectifs courants couvrent toutes les langues annoncées/phrases/contenus, pas seulement les six SOS. Ne pas remplacer dossier historique, PV ou signatures en circulation. CI technique verte avec gate humain ouvert demeure une candidate de préparation.


## Reprise L10 — outillage avant accès (8 octobre 2026)

Base main `a3f80a1`, #189 fusionnée, CI main 37757404974 réussie. Décision du porteur : préparer l’outillage, accès ultérieurs. Lire contrat/revue/fiche L10 et inventaire/dossier `preproduction/L10` ; 94 cas vierges, registre non écrasé, qualification CI main exacte et gate déclaratif séparé des pièces privées. Code de l’outillage 02a7ee4884cec197745672a8c1a68f63bc38685b puis correction TLS 0c90e4ef2d56d7d51fb467de4567667cbc2d4ac1, 65 régressions locales et lint/typecheck verts. Preuve locale PG16 : live 2 lignes, dump/manifeste 1 après écriture concurrente ; restauration synthétique DB/audit/fichier conforme. Docker local uniquement, aucune cible native/fournisseur réel attestée.

Préparer un VPS Infomaniak distinct avec PG16/Redis natifs ; DB digisante_preprod, crontab préproduction DB_NAME explicite, secrets hors dépôt et Firebase public/VAPID au build. SHA complet + deux jobs CI main réussis ; maintenance Nginx vérifiée/crons suspendus avant arrêt des anciens workers, puis install/build/migrate/démarrage homogène. Aucun rolling reload ni garantie d’ancien code après échec. Les deux gates production restent désactivés hors fenêtre autorisée.

Smoke indépendant sans purge Redis, NODE_ENV=production et un seul fournisseur ; suivre les commandes complètes du contrat, jamais `pnpm test` sur la cible. FedaPay sandbox uniquement avant tout réseau ; les suites simulées ne valident aucun webhook réel. Rotation FCM ne garantit pas invalidation immédiate ; logout se vérifie via dispatch. `verify_deploy.sh` par défaut ne lance pas les six tâches mutantes ; opt-in préprod/destinataires autorisés explicites. Trio backup avec snapshot DB commun/manifeste en dernier, contrôle SHA256 complet distinct du healthwatch léger. Sauvegarde cible/crons/fournisseurs restent ouverts ; L9 références différées et L11 restent obligatoires avant ouverture.
