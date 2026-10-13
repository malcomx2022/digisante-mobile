# Lot L10 — préparation de préproduction

> 8 octobre 2026, Africa/Lagos. Branche `feat/l10-preproduction-readiness`.
> Base main `a3f80a159683a217eeac6b961249b31df97e8aee`, PR #189 fusionnée à 09:32:49 UTC /10:32:49 Africa/Lagos. CI main [37757404974](https://github.com/malcomx2022/digisante-mobile/actions/runs/37757404974) réussie sur ce SHA exact, build-and-test/e2e réussis et deploy ignoré.
> Statut : **OUTILLAGE CANDIDAT VALIDÉ LOCALEMENT — L10 réel ouvert**. Porteur : préparer l’outillage, accès à fournir ultérieurement. Aucun VPS/domaine/compte fournisseur ou réception/crons/sauvegarde cible attestés. PR/CI finale à vérifier ; aucun merge/deploy automatique.

## Reprise Claude Code

Lire CLAUDE/playbook/prompts puis `CONTRAT_Preproduction_L10.md`, `REVUE_L10_2026-10.md`, `SECRETS_Preproduction_L10.md` et `preproduction/L10/README.md`. Workflow préprod manuel sur SHA main qualifié, fingerprint/déclaration maintenance et accès dédiés ; Infomaniak distinct, PG16/Redis **natifs**, Nginx HTTPS/PM2. Production requiert DEPLOY_ENABLED **et** DEPLOY_MAINTENANCE_READY, désactivés hors fenêtre. Préserver les règles L1–L8 et les 34 migrations ; code paiement inchangé.

Arrêt vérifié des anciens workers avant SHA/install/build/migrate, readiness JSON et erreurs tracées ; pas rolling reload ni ancien code garanti. Smoke indépendant sans Redis FLUSHDB/seed/migrate, NODE_ENV=production et un fournisseur. FedaPay sandbox strict avant réseau. Sondes/configuration par défaut sans tâches métier ; `--run-jobs` préprod est mutateur. Crontab dédiée propage DB_NAME pour backup/diagnostics. Backup complet avec snapshot commun dump/manifest DB, fichiers séparés, manifeste publié en dernier ; healthwatch léger ne vérifie pas SHA/restauration.

## Preuves locales

- Code/outillage principal : `02a7ee4884cec197745672a8c1a68f63bc38685b` ; correction TLS finale : `0c90e4ef2d56d7d51fb467de4567667cbc2d4ac1`. Commits suivants documentaires uniquement ; comparer le head/les jobs de PR pour preuve CI finale. Auto-revue dans REVUE_L10, pas revue indépendante.
- `node --test --test-isolation=none 'scripts/**/*.test.mjs'` : **65 cas réussis**, zéro échec/skip (44 existants +21 L10). Qualification SHA/jobs CI, isolation/selection smoke avant DB, garde sandbox avant fetch, arrêt/build/migration/erreurs déploiement, vrai chiffrement/gzip/tar et pipelines en panne, trio/altération/verrou backup, absence tâches par défaut/opt-in, TLS invalide, healthwatch archives partielles/futur/HTML200, artefacts frais/gate déclaratif invalide. `pnpm test:scripts` également réussie : **65 cas** répartis sur 11 fichiers ; ne pas confondre fichiers et cas.
- `pnpm lint` / `pnpm typecheck` workspace réussis ; YAML deux workflows et `bash -n` tous les scripts réussis. Pas de nouvelles dépendances/migrations/runtime métier ; ordinary API/web/E2E non rejoués localement, **605 API +121 web +24 E2E de base établis par CI main**, CI finale PR les exécute séparément. Aucun smoke/fournisseur réel exécuté.
- PG16 réel local isolé, **données/clé synthétiques** : insertion concurrente après export, base courante 2/dump restauré 1/manifeste 1 ; déchiffrement/restauration fixture DB, tête audit et fichier identiques. Conteneur/key/fichiers temporaires supprimés, services dev existants inchangés. Pas une preuve native VPS ou restore opérateur L11.
- `pnpm preprod:check` : **94 cas** et sources concordants. Source SHA256 `d3ac2b0c27b2eaf9b3c9f9799f1f5c8afd8c642b8481ff73da83a4b386e8fce1`. Registre livré vide, aucune CI/candidate/cible/approbation remplie ; `--check` sans réécriture, préparation ne remplace jamais evidence.json.
- `pnpm preprod:gate --expected-sha a3f80a159683a217eeac6b961249b31df97e8aee` : **code 1 attendu, 95 points ouverts**. Aucune pièce réellement recueillie. Les fixtures de gate cohérent existent uniquement en mémoire, sans signature/identité authentifiée. N/A seulement T11 avec décision référencée, pas de dérogation produite.
- `pnpm validation:check` : six artefacts L9 inchangés, source SHA256 `4a8a1596f460665a8f4c877a4b4031916ccb0a5a5ba5fcf52f263e000d2cbeea`. Références retours natifs/cliniques toujours différées et L9 humain ouvert ; aucune correction de règle clinique arbitraire.
- `pnpm metrics:check` : **16 compteurs /30 mentions** concordants. Application : **182 REST +1 WS/28 modules, 67 pages, 53 modèles, 31 enums, 34 migrations, 726 API+web**, inchangés.
- Plan Markdown/DOCX régénéré et validé : ZIP/XML/relations/A4/tableaux et contenu concordants ; lib docx 9.5.1 installée uniquement dans outillage temporaire hors dépôt, aucune dépendance runtime ajoutée. Contrôle structurel, pas rendu Word/signature. `git diff --check` réussi.

## Étapes opérateur ouvertes

Recevoir domaine/référence SSH/empreinte vérifiée/comptes et destinataires autorisés sans secrets dans chat. Préparer le VPS distinct, qualifier le **SHA main après fusion** (différent du head PR), constater maintenance/arrêt anciens workers et config native, dérouler les 94 cas et référencer les pièces privées. Firebase Android/iPhone installé, Daily deux appareils, Twilio MTN/Moov, Resend DNS/réception, FedaPay sandbox webhooks et finance/L6. SOS public : aucune recette vers urgence réelle ; T11 conditionnel autorisé ou décision N/A humaine.

Observer crons/effets, première sauvegarde **cible** DB+fichiers+manifest/SHA256 et copie/clé hors VPS. Snapshot DB et fichiers séparés, restauration indépendante/rollback/conservation/pentest/GO restent L11 ; L9 humain/posologie encore ouvert. Ne pas cocher un PV historique ni déclarer fournisseurs/production sur la seule CI verte. Aucun tiers contacté, aucune variable GitHub activée ou déploiement réalisé dans cette préparation.


## Addendum 13/10/2026 — dérogation cible : VPS IONOS partagé + digisantemobile.app (porteur)

L'historique ci-dessus est inchangé. Dérogation validée par le porteur le 13/10/2026 :

- **Cible** : VPS IONOS partagé `srv1.immipro.app` (31.70.148.167, Myvps1, 2-4-120, Ubuntu 26.04.1 LTS, Espagne),
  déjà hôte d'ImmiPro prod et de BeninLink prod/recette. Remplace le VPS Infomaniak distinct du contrat initial.
- **Domaines** : préprod `preprod.digisantemobile.app`, prod `digisantemobile.app` + `www.digisantemobile.app`.
- **Ports sans conflit** (audit lecture seule 13/10 : 3000 ImmiPro, 3001 Grafana pris) : préprod web **3100** / api **3101**,
  prod web **3200** / api **3201**. PG 5432 partagé, bases + rôles séparés (`digisante_preprod` / `digisante`).
  Valkey 6379 partagé, auth, index dédiés **/5 préprod**, **/6 prod**, jamais FLUSHDB/FLUSHALL.
- **Chemins séparés par environnement** : `/var/www/digisante-preprod` / `/var/www/digisante`,
  `/var/log/digisante-preprod` / `/var/log/digisante`, `/etc/digisante-preprod` / `/etc/digisante`,
  `/var/backups/digisante-preprod` / `/var/backups/digisante`.
- **Utilisateurs** : `digisante-preprod` / `digisante` (membres `sshusers`, pas `docker`, pas sudo).
  PM2 absent au 13/10 (à installer) ; noms PM2 `digisante-preprod-api/web` et `digisante-api/web`.
  Node 24.21.0 OK ; pnpm **9.12.0** épinglé (corepack 12.11.2 présent ne doit pas servir).
- **Déviations** : PG **18.6** au lieu de PG16, **Valkey** au lieu de Redis, Ubuntu **26.04** au lieu de 22.04,
  hôte **partagé** au lieu de distinct. Conséquence : le cas I2 « VPS distinct » est **non conforme en l'état** ;
  la dérogation est consignée et doit être arbitrée en L11 — un gate L10 vert ne la couvre pas.
- **Prérequis avant tout déploiement sur l'hôte partagé** : B3 (scripts root hors `APP_DIR` possédé par l'app)
  + B4 (sauvegarde lit `KYC_STORAGE_DIR` via `parseEnv` du `.env`, chemin absolu exigé).
  `provision.sh` (écrit pour Ubuntu 22.04 / PG16 / Redis) doit être **adapté**, jamais appliqué à l'aveugle.
- **Docs mises à jour** : `CLAUDE.md`, `README.md`, `CONTRAT_Preproduction_L10.md`, `SECRETS_Preproduction_L10.md`,
  `ecosystem.config.cjs`, `infra/deploy/README.md` (cette PR, docs + ecosystem uniquement).
- **Outillage par environnement (complément 13/10/2026, revue de la PR)** : `DIGISANTE_ENV` (preproduction |
  production) est **obligatoire, sans défaut**, pour `ecosystem.config.cjs` et chaque script d'exploitation
  (profil `digisante_profile`, copie identique, test de non-dérive). Il fixe noms PM2, ports et URL locale de
  l'API (jamais 3000/3001 : un jeton de service ne part plus vers Grafana), checkout, utilisateur, journaux, copie
  root, `/etc`, `/var/lib`, sauvegardes, base, `/etc/cron.d/digisante[-preprod]`. Corrigé au passage : l'API lit
  `API_PORT` (pas `PORT`) — sans cela elle aurait écouté sur le 3001 du `.env` ; API et web écoutent sur
  127.0.0.1. `deploy.sh` n'arrête que les processus de l'environnement déployé ; crontabs au format `/etc/cron.d`
  (jamais `crontab <fichier>` sur l'hôte partagé), vhosts Nginx et logrotate dédiés par environnement, zones Nginx
  préfixées sans directive globale. Preuves : `scripts/infra/environments.test.mjs` + tests d'exploitation.
- **Non changé par cet addendum** : aucune logique métier, aucune migration, aucun secret, aucun déploiement,
  aucune recette réelle. Après fusion de la PR docs, requalifier la candidate (nouveau SHA) et re-générer
  `preprod:prepare` / `metrics:check` (fraîcheur des empreintes) avant de dérouler L10 sur la cible IONOS.
