# État des lieux fonctionnel & workflows de finalisation — DigiSanté Mobile

> **Note de reprise — 6 octobre 2026 :** état historique au 1er septembre. L'affirmation « développement terminé » ci-dessous ne décrit plus la finalisation actuelle. Le plan actif est `PLAN_Implementations_Restantes_2026-10.md` (L0–L11), incluant des écarts de code constatés et les preuves opérationnelles à obtenir. Les résultats historiques restent conservés à leur date.

> **Date** : 1ᵉʳ septembre 2026 · **Périmètre** : `main` @ `9c3a8b1` · **Nature** : état des lieux
> **vérifié à la commande** (compteurs, i18n, historique git — pas une paraphrase de la documentation),
> suivi des **workflows opérationnels** pour amener l'application jusqu'à la mise en service réelle.
>
> À lire avec : `docs/REVUE_Cloture_2026-08.md` (E1→E4, **close**), `docs/DEPLOIEMENT_Checklist.md`,
> `docs/SECRETS_Production.md`, `docs/VALIDATION_Clinique.md`.

---

## 1. Synthèse

**Le développement est terminé.** Les trois revues successives (C1→C9, D1→D10, E1→E4) sont closes,
aucun écart de code n'est ouvert. Ce qui sépare l'application de ses premiers patients réels ne
relève **plus du développement** mais de **cinq chantiers d'exécution** (B1→B5), dont **trois
dépendent de tiers** — locuteurs natifs, professionnel de santé, fournisseurs/hébergeur — et
doivent donc être **lancés en parallèle dès maintenant** : ce sont eux qui fixent la date de mise
en service.

| Chantier | Nature | Dépend de | Workflow |
|---|---|---|---|
| **B1** 🔴 Relecture native des 6 clés i18n critiques `sos.*` (FON/YOR) | Externe | Locuteurs natifs | §4.1 |
| **B2** 🔴 Contreseing clinique (triage, PEV, phrasier, CNOM) | Externe | Professionnel de santé | §4.2 |
| **B3** 🔴 Mise en production VPS (jamais armée ni exécutée) | Ops | VPS, domaine, DNS | §4.4 |
| **B4** 🟠 Clés d'intégration tierces (tout tourne en stub) | Externe + ops | 5 fournisseurs | §4.3 |
| **B5** 🟠 Test de restauration des sauvegardes | Ops | B3 fait | §4.5 |

Aucun de ces chantiers ne touche la zone gelée §5 ni les décisions verrouillées §3.

---

## 2. État des lieux fonctionnel — vérifié le 01/09/2026

### 2.1 Compteurs mesurés (concordent avec la documentation)

| Métrique | Documenté | Mesuré ce jour | État |
|---|---|---|---|
| Endpoints | 163 REST + 1 WS | 164 déclarations de routes | ✅ |
| Pages frontend | 66 | 66 (`page.tsx`) | ✅ |
| Fichiers de tests | 64 API + 5 web + e2e | 64 + 5 + 2 specs (8 scénarios) | ✅ |
| i18n | EN 100 % · FON/YOR ~92 % | EN **100 %** · FON/YOR **92 %** (74 manquantes, **6 critiques**) | ✅ (B1 toujours ouvert) |

Depuis la revue de clôture (19/08), **3 commits seulement**, tous sans impact fonctionnel :
passage au runtime **Node 24** (CI + production, PR #149/#150) et masquage de la barre de
navigation dans la salle de téléconsultation (PR #151). Aucune régression de périmètre.

### 2.2 Couverture fonctionnelle par espace — feature-complete

| Espace | Parcours couverts | Boucles fermées |
|---|---|---|
| **Patient** (23 pages) | Inscription/OTP, DMP + pièces jointes + partage consenti par-entrée, RDV + paiement (Mobile Money **et** wallet), téléconsultation (VIDEO→AUDIO→CHAT), chat chiffré temps réel + phrasier, ordonnances QR + pictogrammes, triage hors-ligne, SOS + clôture, vaccination PEV, santé maternelle/CPN, observance + rappels, auto-mesures, assurance, annuaire (langue parlée, avis), fiche d'urgence, « médicament près de moi » | prescrire→délivrer, prescrire→résultat labo→interprétation, RDV→paiement→consultation→clôture, SOS→résolution |
| **Médecin** | KYC, agenda + tri de priorité, démarrage/clôture téléconsultation, chat, résultats labo + interprétation, référencement confrère (machine à états stricte), relecture médicale du CMS, fiche pro (tarif autoritatif serveur) | orientation→réponse→complétion ; relecture→publication |
| **Pharmacie** | Scan QR ordonnance, délivrance granulaire par ligne, journal de dispensation privacy-safe, déclaration de stock | ordonnance→délivrance→journal |
| **Laboratoire** | Pool anonymisé→prise en charge→PROCESSING→résultat→notification patient | commande→résultat→interprétation médecin |
| **Diaspora** | Recharge wallet (redirection FedaPay corrigée E1), carnet de bénéficiaires, **envoi d'argent à un proche** (E3, transaction atomique, résolution par téléphone, `canReceive` seul) | recharge→envoi→dépense par le proche |
| **ASC** | Roster cloisonné, observations opérationnelles (jamais un DMP), signalement à un médecin vérifié | observation→signalement→notification |
| **Admin** | RBAC 17 scopes/6 presets, KYC enrichi, utilisateurs (filtres serveur), support/OTP, finances lecture seule + remboursement encadré, ops/monitoring, CMS éducation, campagnes santé publique, **gestion des intégrations tierces** (secrets chiffrés, bascule stub→réel dynamique) | KYC→vérification→annuaire ; campagne→fan-out multilingue |

### 2.3 Ce qui tourne volontairement en stub

FedaPay, Twilio, Daily.co, Firebase FCM et Resend basculent **dynamiquement** en mode réel dès
qu'une clé est résolue via `/admin/integrations` (base chiffrée → `.env`), **sans redéploiement**.
Ce n'est pas un chantier de code : c'est le chantier B4 (ouverture des comptes + saisie des clés).

### 2.4 Décisions produit en suspens (hors périmètre assumé — pas des blocants)

Inchangées depuis la revue de clôture : console SOS admin (frontière §4, décision explicite
requise), interprète humain en consultation (mitigé par phrasier + appariement par langue),
fan-out campagnes non borné (batch v2), format CNOM à confirmer auprès de l'ONMB (aucune API
publique n'existe), vrai remboursement FedaPay externe (attend un bac à sable).

---

## 3. Ordonnancement général

Les chantiers ne sont **pas séquentiels**. Trois pistes en parallèle :

```
Piste A (externe, à lancer J0) : B1 relecture native ──┐
                                 B2 contreseing clinique ──┤
Piste B (fournisseurs, J0)     : B4 ouverture des comptes ──┼──► GO-LIVE ──► premiers patients
Piste C (ops, J0)              : B3 provision VPS → déploiement → B5 restauration ──┘
```

- **Piste C** est la seule entièrement sous contrôle interne : 1 à 2 jours de travail effectif.
- **B4** peut se faire fournisseur par fournisseur **après** le déploiement (bascule dynamique) —
  seul **FedaPay** exige son webhook joignable en HTTPS, donc B3 d'abord.
- **B1 et B2 ne bloquent pas le déploiement technique**, mais bloquent les **premiers patients
  réels** : l'application peut être en ligne en recette fermée pendant qu'ils aboutissent.

---

## 4. Workflows de finalisation

### 4.1 — W1 · Relecture native des clés i18n critiques (B1)

> **🚀 Lancé le 01/09/2026** — étapes 1–2 (interne) faites : CSV régénérés (74 clés/langue dont
> 6 critiques) et **brief relecteur** prêt à transmettre : `docs/i18n/RELECTURE_Native_2026-09.md`.
> En attente : retour des locuteurs natifs (étapes 3–5).

**Objectif de sortie** : `pnpm i18n:check` → **0 clé critique manquante** en FON et YOR.

1. **Exporter** les listes à jour : `pnpm i18n:export` → `docs/i18n/todo.fon.csv` /
   `todo.yor.csv`. Les 6 clés `sos.*` y sont marquées `CRITIQUE` (`sos.active_title`,
   `sos.im_ok`, `sos.false_alarm`, `sos.history`, `sos.status.RESOLVED`, `sos.status.FALSE_ALARM`).
2. **Confier** les CSV à des locuteurs natifs Fɔ̀ngbè et Yorùbá — **jamais de traduction machine**
   pour les clés critiques (§6) ; NLLB (`pnpm i18n:draft`) reste permis en **1ᵉʳ jet** pour les
   68 clés non critiques, toujours suivi d'une relecture.
3. **Réintégrer** les traductions dans `apps/web/src/i18n/messages.ts` (dictionnaire plat).
4. **Vérifier** : `pnpm i18n:check` (0 critique) + relecture croisée d'un second locuteur pour
   les namespaces `sos.*`/`labo.*`/`payments.*` (double validation §6).
5. **Tracer** : consigner les relecteurs (nom, date) dans `docs/VALIDATION_Clinique.md` §
   traçabilité, commit + PR dédiée.

**Charge interne** : ~0,5 j de réintégration. **Délai réel** : celui des relecteurs.

### 4.2 — W2 · Contreseing clinique (B2)

> **🚀 Lancé le 01/09/2026** — étape 1 (interne) faite : dossier régénéré depuis
> `@digisante/shared` (source de vérité) et validation structurelle passée (26 parties ZIP,
> XML bien formés, A4 explicite, 0 `\n` dans les runs, page de signature). Prêt à soumettre.
> En attente : relecture et signature du professionnel de santé (étapes 2–4).

**Objectif de sortie** : `docs/Dossier_Validation_Clinique.docx` signé par un professionnel de
santé, décision tracée.

1. Si les chiffres ont bougé, **régénérer** le dossier :
   `node scripts/docs/generate-validation-dossier.js` puis validation structurelle.
2. **Soumettre** au professionnel de santé les 4 contenus : triage OMS/PCIME
   (`shared/triage.ts`), calendrier PEV (`shared/pev.ts`), phrasier médical
   (`shared/phrasebook.ts`), format de matricule CNOM (`kyc.cnom.ts` — hypothèse `BJ-XXX-#####`
   à confirmer auprès de l'ONMB). Le calendrier CPN est **déjà validé** (OMS 2016).
3. Toute correction demandée = modification des fichiers `@digisante/shared` concernés
   (isolés à cet effet) + tests + PR ; re-signature sur la version corrigée.
4. **Acter** la signature dans `docs/VALIDATION_Clinique.md` (date, identité, version signée).
   La décision du porteur du 19/08 reste tracée comme transitoire — elle ne remplace pas ce
   contreseing.

### 4.3 — W3 · Activation des intégrations tierces (B4)

> **🚀 Lancé le 01/09/2026** — partie interne faite : `docs/COMPTES_ET_CLES.md` remis à niveau
> (aligné sur `PROVIDER_SECRET_KEYS`/`REQUIRED_SECRET_KEYS` du code — ajout `domain` Daily,
> `fromEmail` Resend, secrets webhook, config web `NEXT_PUBLIC_FIREBASE_*`, ports 5434/6380,
> voie `/admin/integrations`) et **tableau de suivi** créé : `docs/SUIVI_B4_Comptes_2026-09.md`.
> En attente : ouverture effective des comptes par le porteur (identité/KYC marchand requis).

**Objectif de sortie** : les 5 providers en statut « configuré » sur `/admin/integrations`,
test de readiness vert, et un paiement sandbox FedaPay confirmé de bout en bout.

Pour **chaque** provider (Twilio, Daily, Firebase, Resend) — guides dédiés `docs/GUIDE_*.md` :

1. Ouvrir le compte, récupérer les clés (cf. `docs/COMPTES_ET_CLES.md`).
2. Saisir via `/admin/integrations` (SUPER_ADMIN, scope `integrations:write`) — la saisie est
   **write-only** et le `PUT` **remplace toutes les clés** du provider : saisir le jeu complet.
3. Bouton **Tester** (readiness) → la bascule stub→réel est immédiate, sans redéploiement.
4. Vérification métier : Twilio → OTP SMS reçu (⚠️ sender ID alphanumérique non garanti au
   Bénin — prévoir fallback numéro long) ; Daily → salle de téléconsultation ; Firebase → push
   web reçu ; Resend → email transactionnel.

**FedaPay (§5 — procédure encadrée, ordre impératif)** :

1. **Sandbox d'abord** : saisir la clé `sk_sandbox_…` — l'environnement est **déduit de la clé**
   (il n'existe pas de `FEDAPAY_ENV`, c'est voulu).
2. Configurer côté FedaPay l'URL de webhook `https://<domaine>/api/v1/payments/webhook` et
   **saisir le secret webhook dans la même session** que la clé API (base prime sur `.env` ;
   un secret désynchronisé = 401 systématique).
3. **Recette sandbox complète** : recharge wallet (redirection → paiement → webhook → crédit),
   paiement de consultation Mobile Money, paiement WALLET, réconciliation manuelle
   (`RECONCILE_TOKEN`), remboursement admin.
4. **Passage en production = remplacer la clé, rien d'autre** — et roter le secret webhook
   **avec** elle. Aucune modification de logique de paiement sans revue + re-tests webhooks (§5).

### 4.4 — W4 · Mise en production VPS (B3)

> **🚀 Lancé le 02/09/2026** — partie interne faite : **audit de l'infra de déploiement passé
> sans dérive** (Node 24 aligné CI/prod dans `provision.sh`, `deploy.sh` avec healthcheck,
> 5 générateurs au crontab, double archive de sauvegarde, Nginx WS + `digisante_noquery`,
> job `deploy` gardé par les e2e) et **runbook de pilotage** créé :
> `docs/SUIVI_B3_MiseEnProduction_2026-09.md`. En attente : VPS, domaine, DNS et secrets
> (fournis par le porteur), puis exécution des phases 1→6.

**Objectif de sortie** : application servie en HTTPS, `health`/`ready` verts, crons actifs,
déploiement continu armé. Dérouler `docs/DEPLOIEMENT_Checklist.md` dans l'ordre — résumé :

1. **Pré-requis** : VPS Infomaniak Ubuntu 22.04, domaine pointé (A), accès SSH.
2. **Provision** (une fois) : `provision.sh` (Node 24 — attention, la CI et la prod sont
   passées de Node 20 à 24 fin août : vérifier que le script provisionne bien **24**),
   PostgreSQL 16 natif, Redis, Nginx, Certbot, UFW, PM2 ; timezone `Africa/Porto-Novo`.
3. **Secrets** (`docs/SECRETS_Production.md`) : `apps/api/.env` complet (`NODE_ENV=production`,
   `JWT_SECRET` ≥ 32, `HEALTH_ENCRYPTION_KEY`, `RECONCILE_TOKEN`…) — l'API **refuse de
   démarrer** si la config est incomplète (fail-safe voulu). Clé de sauvegarde
   `/etc/digisante/backup.key` **copiée hors VPS**.
4. **Premier déploiement** : `deploy.sh` (install → generate → `migrate deploy` → build →
   PM2 ×2 + web).
5. **Nginx + SSL** : conf fournie (upgrade WebSocket sur `/chat/ws`, `log_format
   digisante_noquery` — vérifier après coup `grep -c 'token=' /var/log/nginx/digisante-ws.log`
   → **0**), Certbot.
6. **Crons** : `RECONCILE_TOKEN` en tête de `crontab.example`, puis vérifier que les
   **5 générateurs** répondent 200 (traitements, RDV, vaccination, CPN + dispatch) ;
   sauvegarde 02:00, réconciliation 02:30.
7. **Armer le déploiement continu** : secrets GitHub `VPS_HOST`/`VPS_USER`/`VPS_SSH_KEY`,
   variable `DEPLOY_ENABLED=true` → chaque push sur `main` passe CI (`build-and-test` + `e2e`)
   puis déploie.
8. **Vérifications post-déploiement** : `health`/`ready`, PWA installable, triggers d'audit
   actifs (UPDATE sur `audit_logs` → rejet).

### 4.5 — W5 · Test de restauration à blanc (B5)

> **🚀 Lancé le 02/09/2026** — la **répétition à blanc est EXÉCUTÉE** avec le vrai script sur
> une pile réelle (PostgreSQL 16.13, 28 migrations + seed, magasin factice) : double archive
> produite, restauration sans erreur, comptages de toutes les tables identiques, checksums
> fichiers identiques, **trigger d'audit immuable actif après restauration**. Aucun correctif
> nécessaire. Détail : `docs/SUIVI_B5_Restauration_2026-09.md`. Reste le **test réel** sur les
> archives de production (après B3 phase 6) — c'est lui le critère de sortie.

**Objectif de sortie** : les **deux** archives restaurées sur une machine tierce, données
cohérentes. Une sauvegarde jamais restaurée n'est pas une sauvegarde.

1. Lancer une sauvegarde et vérifier la présence des **deux** fichiers :
   `digisante_<stamp>.sql.gz.enc` (base) **et** `digisante_files_<stamp>.tar.gz.enc`
   (`KYC_STORAGE_DIR` — pièces KYC **et pièces jointes DMP = données de santé**, hors base).
   ⚠️ Si le script signale « magasin introuvable », corriger `KYC_STORAGE_DIR` avant toute
   mise en service.
2. Sur une machine tierce : déchiffrer avec `backup.key`, restaurer le dump dans un
   PostgreSQL 16 vierge, déballer le magasin de fichiers.
3. **Contrôle de cohérence** : ouvrir une entrée DMP avec pièce jointe — le `checksum` SHA-256
   doit correspondre ; vérifier la chaîne de hash de l'audit sur un échantillon.
4. Consigner la date du test dans la checklist ; recommencer après tout changement du script.

### 4.6 — W6 · Recette fonctionnelle de bout en bout (avant les patients réels)

Une fois W3 + W4 faits, dérouler **sur l'environnement de production** (comptes de recette,
FedaPay sandbox) une passe par rôle — c'est la seule vérification que ni les 355 tests ni les
8 e2e ne peuvent donner, car elle traverse les **vrais** fournisseurs :

1. **Patient** : inscription (OTP SMS **réel** Twilio) → RDV → paiement sandbox → notification
   push réelle → téléconsultation Daily réelle (+ bascule AUDIO/CHAT en bande passante réduite) →
   ordonnance QR → SOS (SMS dans la langue du compte).
2. **Médecin** : KYC → validation admin → agenda → démarrage/clôture consultation → orientation
   confrère.
3. **Pharmacie / Labo** : scan QR caméra sur **mobile réel** (BarcodeDetector Android + repli
   jsQR iOS) → délivrance ; pool labo → résultat → interprétation.
4. **Diaspora** : recharge sandbox → envoi à un proche → dépense WALLET par le proche.
5. **PWA installée** (Android + iPhone) : zones sûres, install, mode hors-ligne (triage,
   file de mutations), toast de mise à jour.
6. **Webhook FedaPay** : vérifier en base qu'un paiement passe PENDING→COMPLETED **par le
   webhook** (pas seulement par la réconciliation de 02:30).

### 4.7 — Critères de GO-LIVE (patients réels)

Tous doivent être vrais simultanément :

- [ ] W1 : 0 clé i18n critique manquante (relecture native tracée).
- [ ] W2 : dossier de validation clinique signé.
- [ ] W3 : 5 intégrations en réel, paiement sandbox confirmé par webhook, **puis** clé FedaPay
      production posée (+ secret webhook roté).
- [ ] W4 : checklist de déploiement intégralement cochée, CI+deploy verts sur `main`.
- [ ] W5 : restauration à blanc réussie et datée.
- [ ] W6 : recette par rôle déroulée sans blocant.

---

## 5. Conclusion

L'application est **fonctionnellement complète et vérifiable** : les boucles métier des 7 rôles
sont fermées, les trois séries de revues sont closes, les compteurs documentés concordent avec
le code mesuré ce jour, et les seuls stubs restants sont conçus pour basculer sans
redéploiement. La finalisation est un **projet d'exécution à trois pistes parallèles** —
externe (relecture native, contreseing), fournisseurs (comptes + clés), ops (VPS + sauvegardes)
— dont le chemin critique est **externe, pas technique**. Lancer B1, B2 et l'ouverture des
comptes fournisseurs **aujourd'hui** est la seule décision qui raccourcisse la date de mise en
service.
