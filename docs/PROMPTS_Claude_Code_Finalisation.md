# Prompts Claude Code — finalisation des intégrations et corrections

Reprise du 7 octobre 2026 : L0–L6 livrés sur main, #186 = `91a0fc9` ; L7 candidate. Lire CLAUDE, `suivi/LOT_L7.md`, contrat/revue/recette finances avant les prompts historiques. Journal causal, revenu médecin PRO distinct des abonnements plateforme, CSV/receipt non fiscaux approuvés ; opérations externes manuelles, preuve unique et anomalies sans backfill. L8 ensuite après livraison/revue L7 ; langues natives L9, fournisseurs réels L10 et GO L11 restent distincts.

> **Reprise du 6 octobre 2026 :** utiliser d'abord `PLAN_Implementations_Restantes_2026-10.md`, son prompt commun et l'instruction L0–L11. Les prompts ci-dessous conservent le contexte de la finalisation précédente ; vérifier ce qui est déjà livré avant de les exécuter et mesurer les compteurs actuels plutôt que reprendre les nombres historiques.

> **Mode d'emploi :** copier **un seul prompt à la fois** dans Claude Code. Attendre le commit et la
> PR correspondants, relire les résultats, puis passer au prompt suivant. Les prompts sont classés
> dans l'ordre recommandé. Remplacer uniquement les champs `<...>` ; ne jamais coller une clé secrète
> dans le prompt, un commit, un log ou un document.

## 0. Règles communes à ajouter si nécessaire

Ces règles sont déjà rappelées dans chaque prompt, mais peuvent être ajoutées au début d'une session :

```text
Travaille dans le dépôt DigiSanté. Commence par lire CLAUDE.md et tous les AGENTS.md applicables.
Respecte les décisions verrouillées : VPS Infomaniak, PostgreSQL 16 natif, données de santé et
consentement par entrée. Ne change pas la logique FedaPay gelée sans autorisation explicite et re-tests
webhooks. N'invente jamais un résultat, une validation humaine ou un accès externe. Ne révèle aucun
secret : utilise seulement les noms de variables. Fais une modification ciblée, ajoute les tests de
non-régression, exécute les contrôles pertinents, mets à jour la documentation factuelle, puis crée un
commit Conventional Commits et une PR avec résultats et limites. Si un accès ou une donnée manque,
arrête uniquement l'étape bloquée et fournis la commande exacte que l'opérateur doit exécuter.
```

---

## Phase A — fermer les corrections techniques

### Prompt 1 — baseline locale complète et skips de tests

**À lancer en premier.** Il produit la vérité de référence avant toute intégration externe.

```text
Lis CLAUDE.md, package.json, la CI et les fichiers de test. Établis une baseline locale reproductible.
Démarre PostgreSQL 16 et Redis avec infra/docker-compose.dev.yml si Docker existe ; sinon détecte les
services natifs disponibles et documente précisément la limite sans modifier les tests pour les faire
passer artificiellement. Crée une base dédiée, exécute prisma generate, migrate deploy et le seed si
les tests l'exigent. Lance pnpm i18n:check, pnpm lint, pnpm typecheck, pnpm test, pnpm build et
pnpm test:e2e. Analyse tous les tests skipped : distingue les skips intentionnels des skips causés par
l'environnement. Corrige uniquement les défauts réels, avec tests de non-régression. Ajoute dans docs/
un rapport daté indiquant commandes, nombres passed/failed/skipped et causes, sans secret. Critères :
325 tests API, 37 web et 8 scénarios e2e exécutés ou chaque impossibilité externe explicitement prouvée.
```

### Prompt 2 — rendre le build web indépendant de Google Fonts

```text
Lis CLAUDE.md et inspecte apps/web/src/lib/fonts.ts. Le build ne doit plus dépendre d'un téléchargement
vers fonts.googleapis.com. Vérifie d'abord la licence et la provenance officielle de Bricolage Grotesque
et DM Sans. Migre vers next/font/local avec les fichiers WOFF2 minimaux nécessaires, conserve les noms
de variables CSS, les graisses 400/500/600/700/800 et le rendu actuel. Ajoute un fichier de licence ou
une notice de provenance si requis. Ne modifie ni la charte Wax & Terre ni les composants. Teste lint,
typecheck et un build avec l'accès réseau désactivé. Si les fichiers ne peuvent pas être obtenus avec
une licence vérifiable, ne les invente pas : produis le plan exact et marque la tâche bloquée.
```

### Prompt 3 — commande unique de contrôle release

```text
Lis les scripts racine, la CI et les runbooks. Ajoute une commande pnpm release:check qui orchestre les
contrôles locaux non destructifs : i18n, lint, typecheck, tests, build et vérification des migrations.
Elle doit échouer au premier vrai défaut, ne jamais lancer de déploiement, ne jamais contacter un
fournisseur et afficher clairement les prérequis PostgreSQL/Redis. Évite de dupliquer la logique CI.
Ajoute un test ou une vérification du script et documente son usage dans README.md. Exécute la commande
autant que l'environnement le permet et rapporte honnêtement tout contrôle non exécuté.
```

### Prompt 4 — stabiliser les compteurs documentaires

```text
Le dépôt documente plusieurs nombres d'endpoints/pages/tests qui semblent avoir dérivé. Crée un script
de comptage déterministe sous scripts/ qui mesure séparément routes REST, canal WebSocket, pages Next,
fichiers et cas de tests. Définis les règles de comptage dans le script pour éviter les faux positifs.
Ajoute une commande pnpm metrics:check capable de comparer les valeurs publiées à une source unique et
d'échouer en cas de dérive. Mets à jour uniquement les compteurs réellement mesurés dans CLAUDE.md et
les documents actifs, sans réécrire les archives datées. Teste le script et joins sa sortie à la PR.
```

---

## Phase B — préparer puis activer chaque fournisseur

### Prompt 5 — audit de la console d'intégrations avant saisie des clés

```text
Lis CLAUDE.md, docs/PLAN_Gestion_API_Admin.md, docs/COMPTES_ET_CLES.md et le module admin integrations.
Audite le chemin complet création/mise à jour/test des configurations FedaPay, Twilio, Daily, Firebase
et Resend. Vérifie : scope SUPER_ADMIN, chiffrement AES-256 au repos, absence de secret dans réponses et
logs, remplacement atomique du jeu complet de clés, audit INTEGRATION_*, fallback .env et bascule
dynamique. Ajoute des tests de non-régression pour chaque manque constaté, sans clé réelle. Ne touche pas
à la logique métier FedaPay. Exécute les tests ciblés, puis mets à jour la documentation uniquement si
le comportement vérifié diffère de celle-ci.
```

### Prompt 6 — Twilio : OTP, SOS et SMS multilingues

**Prérequis humain :** compte Twilio hors trial et numéros MTN/Moov de recette disponibles.

```text
Lis le guide Twilio, les modules auth/SOS/notifications et les règles i18n critiques. Sans exposer de
secret, ajoute un smoke test Twilio explicitement opt-in, désactivé par défaut, qui envoie vers un numéro
de recette fourni par variable d'environnement et masque le numéro dans les logs. Vérifie le format
+22901XXXXXXXX, OTP, rate-limit, verrouillage après cinq échecs, langue du SMS SOS et fallback numéro
long. Le test ne doit jamais tourner dans pnpm test standard. Fournis une fiche de recette manuelle MTN
et Moov avec résultat attendu, SID masqué et procédure de rollback. Ne coche B4 que pour une réception
réellement constatée par l'opérateur.
```

### Prompt 7 — Daily.co : téléconsultation et mode dégradé

**Prérequis humain :** compte Daily, domaine et deux appareils de recette.

```text
Lis le guide Daily, les modules appointments/consultations/chat et l'écran de téléconsultation. Ajoute
un smoke test opt-in qui vérifie l'authentification API, crée une salle éphémère de recette, contrôle ses
propriétés de confidentialité/expiration puis la supprime, sans journaliser apiKey ni token de salle.
Ajoute ou complète les tests locaux du fallback VIDEO vers AUDIO puis CHAT sans appeler Daily. Produis
une matrice manuelle pour patient/médecin sur deux appareils, permissions caméra/micro, expiration,
reconnexion et réseau faible. Ne marque readiness ou B4 comme réussi qu'après exécution réelle.
```

### Prompt 8 — Firebase FCM : serveur, navigateur et service worker

**Prérequis humain :** projet Firebase, compte de service, application web et clé VAPID.

```text
Lis le guide Firebase, le service serveur, apps/web/public/firebase-messaging-sw.js et le code
d'enregistrement des tokens. Vérifie la séparation entre secrets serveur et variables publiques
NEXT_PUBLIC_FIREBASE_*. Ajoute des validations de configuration et des tests garantissant qu'aucune
privateKey/clientEmail n'entre dans le bundle web. Prépare un smoke test serveur opt-in vers un token
de recette et une recette PWA Android/iPhone couvrant permission refusée/acceptée, premier plan,
arrière-plan, clic, rotation de token et révocation. Documente qu'un changement NEXT_PUBLIC_* exige un
rebuild. Ne commit aucune configuration Firebase réelle et ne coche B4 qu'après notification reçue.
```

### Prompt 9 — Resend : domaine, SPF/DKIM et email transactionnel

**Prérequis humain :** compte Resend et accès DNS au domaine d'envoi.

```text
Lis le guide Resend et tous les appels email. Vérifie la résolution apiKey/fromEmail depuis la console
chiffrée puis .env, la validation de l'expéditeur et l'absence de données de santé dans sujet, contenu
ou logs. Ajoute un smoke test opt-in vers EMAIL_RECIPIENT_TEST, désactivé par défaut, avec identifiant
de message masqué. Prépare la checklist DNS SPF/DKIM/DMARC, réception, spam et erreur provider. Ajoute
les tests unitaires des cas succès/échec sans appel réseau. Ne coche readiness et vérification métier
qu'après validation DNS et réception réelle.
```

### Prompt 10 — FedaPay sandbox : webhook et parcours financiers

**Prérequis humain :** compte sandbox validé, clés sandbox et URL HTTPS de recette.

```text
Zone paiement gelée : commence par lire CLAUDE.md §5, le guide FedaPay et les tests payments. Ne modifie
aucune logique de paiement sans arrêter et obtenir une autorisation explicite. Effectue un préflight de
la configuration sandbox sans afficher les valeurs. Exécute les tests existants de signature HMAC
valide/invalide, idempotence, rejeu, retry/DLQ, montant serveur et réconciliation. Prépare ensuite une
recette guidée : recharge wallet avec redirection et webhook, consultation Mobile Money, paiement
WALLET, réconciliation manuelle et remboursement admin. Pour chaque étape, collecte seulement ID
masqué, statut, heure et preuve non sensible. Un paiement n'est réussi que si PENDING devient COMPLETED
par webhook sans double crédit. Mets à jour B4 uniquement avec les preuves observées.
```

### Prompt 11 — FedaPay production : bascule contrôlée

**À lancer seulement après validation complète du prompt 10.**

```text
Vérifie d'abord que toute la recette FedaPay sandbox est signée et que rollback/sauvegarde existent.
Ne change aucun code. Produis un plan de bascule avec quatre yeux : nouvelle clé live, rotation du
webhookSecret dans la même fenêtre, URL webhook HTTPS, readiness, transaction réelle de montant minimal,
contrôle du webhook, rapprochement et rollback. Masque toutes les valeurs. Demande à l'opérateur
d'effectuer les saisies dans /admin/integrations ; ne prétends pas les avoir faites. Après exécution,
vérifie audit INTEGRATION_*, absence de secret dans logs et paiement unique sans double crédit. Mets à
jour B4 avec date, opérateur et preuve non sensible seulement.
```

---

## Phase C — infrastructure et exploitation

### Prompt 12 — préflight VPS sans mutation

```text
Lis CLAUDE.md, docs/DEPLOIEMENT_Checklist.md, docs/SECRETS_Production.md et le suivi B3. Fais un audit
statique sans connexion distante et sans mutation : Node 24, pnpm, PostgreSQL 16 natif, Redis, PM2 ×2,
Nginx HTTP/WebSocket, Certbot, UFW, permissions du magasin, migrations, crons, health/readiness,
backup et déploiement GitHub Actions. Recherche placeholders, chemins incohérents, commandes non
idempotentes et risques de fuite de token dans les logs. Corrige les défauts du dépôt avec tests shell
ou lint adaptés. Produis une checklist préflight GO/NO-GO ; ne coche aucune étape distante non observée.
```

### Prompt 13 — déploiement VPS assisté et preuves

**Prérequis humain :** `<VPS_HOST>`, domaine pointé, compte SSH et secrets déjà posés hors du chat.

```text
Lis les runbooks B3. Avant toute mutation, vérifie l'hôte cible et affiche le plan sans valeur secrète.
Exécute les phases une par une : provision, secrets déjà présents, premier deploy, Nginx/TLS, crons,
health/ready et activation CI. Après chaque phase, vérifie le résultat et arrête-toi au premier échec ;
ne contourne jamais un contrôle. Vérifie pm2 api ×2 + web, migrations, certificat, WebSocket, cinq
générateurs à 200 et zéro occurrence token= dans le log WS. N'affiche ni .env ni clé. Mets à jour B3
case par case uniquement avec date et preuve effectivement observée, puis fournis le rollback testé.
```

### Prompt 14 — restauration réelle des deux archives

```text
Lis B5 et les scripts de sauvegarde. Travaille sur une machine tierce isolée, jamais sur la base de
production. Sélectionne les deux archives du même timestamp : dump PostgreSQL et magasin de fichiers.
Vérifie chiffrement/intégrité, restaure vers PostgreSQL 16 vierge, restaure les fichiers, compare les
comptages, un échantillon de checksums et la chaîne d'audit, puis confirme que le trigger bloque un
UPDATE d'audit. Ne copie aucune donnée personnelle dans le rapport et détruis l'environnement de test
selon le runbook. Mets à jour B5 seulement si tous les contrôles passent ; sinon laisse les cases
ouvertes et documente l'erreur et la procédure corrective.
```

### Prompt 15 — observabilité et alertes avant ouverture

```text
Audite l'observabilité existante sans introduire de SaaS non approuvé. Vérifie logs structurés et
redaction JWT/OTP/secrets/données de santé, rotation des logs, métriques health/ready, uptime PM2,
erreurs cron, backlog notifications, échecs fournisseurs, webhooks et espace disque sauvegardes.
Ajoute les alertes/scripts locaux minimaux compatibles avec le VPS, avec seuils, destinataire et
runbook d'escalade. Simule sans dommage une panne Redis, une erreur provider et un disque proche du
seuil. Teste et documente les preuves ; n'ajoute aucune donnée médicale aux logs.
```

---

## Phase D — validations humaines et recette finale

### Prompt 16 — intégrer les traductions FON/YOR validées

**Prérequis humain :** CSV retournés par les locuteurs natifs avec identité/date de validation.

```text
Lis les règles i18n de CLAUDE.md et le brief natif. Importe les traductions humaines validées depuis
<CHEMIN_CSV_FON> et <CHEMIN_CSV_YOR> dans messages.ts sans altérer les clés ni interpolations. Refuse
toute ligne critique sos./labo./payments. sans double validation tracée. Contrôle encodage, accents,
variables, balises et parité avec pnpm i18n:check. Ajoute des tests des interpolations modifiées et
signale toute traduction ambiguë au lieu de l'inventer. Mets à jour la traçabilité avec noms/dates
fournis, jamais supposés. Critère : zéro clé critique manquante ; les clés non critiques restantes sont
listées explicitement.
```

### Prompt 17 — intégrer les corrections cliniques signées

**Prérequis humain :** dossier annoté/signé par le professionnel ou programme compétent.

```text
Lis CLAUDE.md, docs/VALIDATION_Clinique.md et <CHEMIN_RETOUR_CLINIQUE>. Compare les demandes signées à
triage.ts, pev.ts, phrasebook.ts et kyc.cnom.ts. Présente d'abord un diff fonctionnel et les impacts.
N'applique que les corrections explicitement validées ; n'invente aucun seuil ni contenu médical.
Ajoute des tests de non-régression couvrant limites et cas critiques, exécute lint/typecheck/tests,
régénère Dossier_Validation_Clinique.docx puis valide sa structure selon le workflow DOCX. Trace
professionnel, date et version sans publier de donnée personnelle inutile. Toute ambiguïté reste
bloquée et listée pour arbitrage clinique.
```

### Prompt 18 — recette réelle des sept rôles et appareils

```text
Prépare et pilote une recette sur l'environnement <URL_RECETTE> avec comptes synthétiques uniquement.
Couvre patient, médecin, pharmacie, laboratoire, diaspora, ASC et admin ; Android et iPhone ; MTN et
Moov ; réseau normal puis faible. Inclure OTP, KYC, DMP/consentement par entrée, RDV/paiement sandbox,
Daily VIDEO→AUDIO→CHAT, ordonnance QR avec BarcodeDetector et jsQR, labo/interprétation, wallet proche,
SOS multilingue, push, installation PWA, offline et rejeu de queue. N'automatise pas les confirmations
physiques : demande à l'opérateur le résultat de chaque étape. Produis un procès-verbal anonymisé avec
preuve, résultat, sévérité et reproduction. Ouvre une correction séparée par défaut P0/P1 et rejoue la
recette concernée avant clôture.
```

### Prompt 19 — audit sécurité de release

```text
Réalise la revue OWASP/STRIDE finale sur auth, DMP/consentements, uploads, WebSocket, admin RBAC,
intégrations, paiement, logs, stockage et sauvegardes. Vérifie particulièrement suspension au refresh,
JWT HS256/expiration, cookies HttpOnly/SameSite, rate-limit Redis, traversal/magic bytes, audit
append-only, cloisonnement admin et absence de secrets côté client. Utilise des tests non destructifs
sur une base synthétique. Classe chaque finding avec preuve et sévérité ; corrige les défauts hors zone
FedaPay, et demande une revue explicite avant toute correction dans la zone gelée. Rejoue tous les
tests concernés et mets à jour l'audit daté sans déclarer clos un point non vérifié.
```

### Prompt 20 — décision GO/NO-GO et ouverture pilote

```text
Lis tous les suivis B1 à B5, rapports de tests, recette sept rôles et audit sécurité. Construis une
matrice GO/NO-GO où chaque case contient une preuve datée ; une case sans preuve vaut NO-GO. Exige :
CI complète, build reproductible, VPS/health/crons, cinq fournisseurs, webhook FedaPay sandbox puis
live, restauration tierce, i18n critique validée, contreseing clinique, appareils/opérateurs et
rollback. Si GO, prépare une ouverture pilote limitée, sauvegarde pré-ouverture, responsables,
monitoring et revues J+1/J+7. Si NO-GO, liste uniquement les bloqueurs et leur propriétaire. Génère le
procès-verbal DOCX via build puis validate ; ne transforme jamais une déclaration en preuve.
```

## Ordre minimal recommandé

1. Prompts **1 à 4** : fiabiliser le dépôt.
2. Prompt **5**, puis **6 à 9** en parallèle si les comptes existent.
3. Prompt **12**, puis **13 et 14** : rendre la recette distante disponible et restaurable.
4. Prompts **10 puis 11** : FedaPay sandbox avant production.
5. Prompts **16 et 17** dès réception des validations humaines.
6. Prompts **15, 18, 19 puis 20** : exploitation, recette, sécurité et décision finale.

Ne lancer le prompt 20 que lorsque tous les prompts applicables précédents ont produit des preuves
versionnées. Claude Code peut accélérer et contrôler le processus ; il ne peut remplacer ni le porteur,
ni les fournisseurs, ni les locuteurs natifs, ni le professionnel de santé.

## Reprise L7 après livraison L6

Réutiliser les commandes/périodes L6 et `requireProWithin` avec rôle/statut courant pour les revenus médecin. Une recette abonnement appartient à la plateforme, pas au revenu médecin ni à la commission consultation 3 %. Conserver CAS financiers et audit atomique SUBSCRIPTION, UUID avant premier envoi, no-store/postNow, historique/cancellation tardive. Toute modification paiement respecte §3.5 : diff explicite et re-tests HMAC/×5/reconcile/wallet/refund. Vérifier main et SHA/CI avant nouvelle branche ; produire la revue L7, sans merge automatique.

## Reprise L8 — sécurité, 7 octobre 2026

L7 livré sur main par #187 (`ebd0547`), CI main 37656606253 réussie ; L8 sur `feat/l8-security-residuals`. Lire `CONTRAT_Securite_L8.md`, l’addendum daté `AUDIT_Securite_L8_2026-10.md`, la revue et LOT_L8. Ne pas déclarer les réglages console/HTTPS, CSP à nonce ou le pentest effectués sans preuve humaine. X6 = Redis fail-closed, X12 = chaîne d’audit. Réponses publiques OTP génériques, HMAC avec clé infra, diagnostic seulement NODE_ENV=test ; durée refresh JWT/cookie/Redis unique. Audit effet DMP/KYC/labo transactionnel, horloge logique sous verrou et héritage vérifié avant bascule. Logs sans query/Referer/corps amont/exception brute ; error_log Nginx non expurgeable désactivé. Checkout exact partagé, redirections refusées, reconcile constant ; revue §5 et re-tests obligatoires. FCM normalisé, CSP prod sans eval/connect générique, exception CDN sur SW seul ; HSTS et Geo Permissions manuels L10, X8/risques résiduels à décider avant GO L11. Une branche, revue, PR et CI exact SHA par lot.


## Reprise L9 — 8 octobre 2026

L8 fusionné par #188 sur `4fc62c1`, CI main 37734382622 réussie ; gates externes sécurité toujours ouverts. L9 sur `feat/l9-native-clinical-validation` : lire contrat, revue, fiche et `validation/L9/README.md`. Le porteur annonce des retours validés mais fournira leurs références ultérieurement : préparer les contrôles et dossiers, jamais importer/inventer des textes ou signatures sans ces pièces.

À réception : vérifier identité/qualité/version/portée/réserves et conserver la pièce privée ; essai UI `import-validated --evidence-ref … --dry-run` puis diff, tests et PR. Phrasier et corrections cliniques suivent PR dédiée/diff explicitement confirmé et contreseing du dossier corrigé. Posologie existante incluse au dossier (fractions/mg/horaire/durée à qualifier), pas une acceptation. `validation:check` + validateur DOCX = preuve technique ; `validation:gate` = cohérence de preuves déclarées, aucun GO automatique. Les objectifs courants couvrent toutes les langues annoncées/phrases/contenus, pas seulement les six SOS. Ne pas remplacer dossier historique, PV ou signatures en circulation. CI technique verte avec gate humain ouvert demeure une candidate de préparation.
