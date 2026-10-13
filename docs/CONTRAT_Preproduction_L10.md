# Contrat L10 — préproduction et cinq fournisseurs

> 8 octobre 2026, Africa/Lagos. Préparation sur `feat/l10-preproduction-readiness`, depuis main `a3f80a159683a217eeac6b961249b31df97e8aee` après fusion #189. Aucun accès VPS/domaine ou compte fournisseur fourni dans cette session ; aucune recette réelle attestée. L9 technique livré, références natives/cliniques différées par le porteur. L10 technique ne ferme ni L9 humain ni GO L11.

> Dérogation 13/10/2026 (porteur) : cible = VPS IONOS partagé `srv1.immipro.app` (31.70.148.167), Ubuntu 26.04, PG 18.6 natif partagé, Valkey 6379 (auth, /5 préprod). Préprod `preprod.digisantemobile.app` (web 3100 / api 3101). Le cas I2 « VPS distinct » est non conforme en l'état ; dérogation à arbitrer en L11. Voir addendum dans `docs/suivi/LOT_L10.md`.

## 1. Cible et limites

VPS **IONOS partagé** `srv1.immipro.app` (31.70.148.167, 2-4-120, Ubuntu 26.04 LTS, Espagne) — dérogation porteur 13/10/2026 (remplace le VPS Infomaniak distinct). PostgreSQL **18.6 natif partagé** (port 5432), Valkey local 6379 avec auth, Nginx/Certbot HTTPS et PM2 API ×2/web. DigiSanté n'utilise **pas** Docker (Docker présent sur l'hôte pour ImmiPro). Base `digisante_preprod`, rôle dédié `digisante_preprod`, Valkey index explicite `/5` ; aucun accès aux bases / index Valkey des autres projets hébergés (ImmiPro, BeninLink), jamais FLUSHDB/FLUSHALL. Comptes, documents et appareils synthétiques, destinataires de recette explicitement autorisés. Le conteneur PostgreSQL local utilisé dans les tests n'atteste pas cette cible native.

Relever domaine, référence privée d'accès/hôte, propriétaire, SHA complet, CI main sur ce SHA et empreinte SSH. Secrets uniquement sur le VPS/GitHub Secrets selon `SECRETS_Preproduction_L10.md`. Ne pas activer les variables GitHub ni déployer sans cible et accès autorisés. Aucune donnée patient importée pour faire fonctionner les tests. L9 : aucune traduction, signature ou décision posologie inventée ; pas d'usage clinique tant que ces gates restent ouverts.

## 2. Candidate et maintenance

Après fusion de la PR, qualifier **le SHA complet de main à déployer** : `CANDIDATE_SHA=<40hex> pnpm preprod:qualify`. Le contrôle lit l'API GitHub : CI `ci.yml` main/push terminée avec succès, `build-and-test` et `e2e` réussis sur le SHA exact. Une CI PR, un ancien SHA ou un job ignoré ne qualifient pas le déploiement. Reprendre le SHA de fusion, qui diffère normalement du head de PR.

Provision initial natif via `provision.sh` avec `DB_NAME=digisante_preprod` et secrets injectés par le coffre de l'opérateur. Relire les effets root avant exécution. Pour une cible déjà alimentée, obtenir une sauvegarde complète vérifiée avant migration ; premier bootstrap sur DB vierge déclaré comme tel, puis première sauvegarde après installation. Vérifier héritage audit/L8 sans réécriture et compatibilité des 34 migrations.

Poser et vérifier une maintenance **Nginx** avant le script ; autoriser seulement l'IP de recette de l'opérateur pendant les sondes HTTPS. La variable `DEPLOY_MAINTENANCE_READY=1` est une **déclaration**, le script ne pose/vérifie pas lui-même Nginx. Suspendre temporairement les crons mutateurs et éviter les sauvegardes concurrentes au déploiement. Consigner leur suspension/reprise ; sauvegarder la crontab actuelle avant modification. `deploy.sh` refuse les modifications Git de l'opérateur, le SHA non exact/hors branche et NODE_ENV autre que production. Arrêt PM2 API/web puis contrôle de l'arrêt **avant** checkout/install/build/migrations ; démarrage homogène, readiness JSON bornée, journal SHA/stade/succès ou échec. Pas de rolling reload pendant migration, pas de rollback automatique et aucune garantie que l'ancien code reste actif en cas d'échec.

```bash
# Depuis le checkout cible, utilisateur applicatif ; maintenance déjà vérifiée.
DEPLOY_REF=<SHA_COMPLET_QUALIFIE> DEPLOY_ENVIRONMENT=preproduction \
  DEPLOY_MAINTENANCE_READY=1 bash infra/deploy/scripts/deploy.sh
# Sondes/configuration ; aucune tâche de notification exécutée par défaut.
sudo DOMAIN=<DOMAINE_PREPROD> bash infra/deploy/scripts/verify_deploy.sh
```

Workflow `.github/workflows/preproduction.yml` : manuel, `PREPROD_DEPLOY_ENABLED=true`, SHA qualifié main et maintenance explicitement confirmée ; quatre accès `PREPROD_VPS_*` obligatoires dont fingerprint. Bootstrap lit le script **du SHA qualifié**, pas le script obsolète du checkout. Aucun smoke, paiement ou message automatique. Production : CI requiert **DEPLOY_ENABLED ET DEPLOY_MAINTENANCE_READY** ; conserver les deux désactivées hors fenêtre autorisée, remettre le second à false après la fenêtre. Le workflow n'est pas exécuté par cette livraison.

## 3. Configuration et sondes fournisseurs

Configurer l'intégration via SUPER_ADMIN, `integrations:write`, jeu complet de secrets chiffrés ; infrastructure reste exclusivement `.env`. Source DB prime sur fallback env : contrôler la source réellement résolue. Firebase public/VAPID dans `.env.production` web **avant build** ; API same-origin, aucune URL production dans le client. Readiness et acceptation HTTP fournisseur ne prouvent pas la réception SMS/push/email ni un appel deux appareils.

Les smoke tests ont un setup distinct, **sans FLUSHDB, seed ou migration**. Exécution sur le checkout exact de la cible isolée, NODE_ENV=production, un seul fournisseur par commande. Le nom PostgreSQL local doit finir `_preprod`, et l'index Redis local doit correspondre à la déclaration. Ces gardes attestent la cohérence de la configuration déclarée, pas la propriété physique du VPS. Ne jamais lancer `pnpm test`/tests ordinaires sur la cible (ils utilisent un setup destructif destiné aux tests).

```bash
cd /var/www/digisante-preprod/apps/api
# Les connexions/secrets sont lus depuis le fichier privé 0600 via Node24.
# Définir les métadonnées publiques ci-dessous pour CHAQUE commande ; un seul opt-in.
NODE_ENV=production SMOKE_ENVIRONMENT=preproduction \
SMOKE_EXPECTED_SHA=<SHA_COMPLET_QUALIFIE> SMOKE_DATABASE_NAME=digisante_preprod \
SMOKE_REDIS_DB=5 SMOKE_FEDAPAY=1 \
node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.smoke.config.ts
```

Remplacer **seulement** `SMOKE_FEDAPAY=1` par `SMOKE_TWILIO=1`, `SMOKE_DAILY=1`, `SMOKE_FCM=1` ou `SMOKE_RESEND=1` ; désactiver les autres flags hérités. Twilio exige `SMOKE_TWILIO_TO`, FCM `SMOKE_FCM_TOKEN`, Resend `EMAIL_RECIPIENT_TEST` : injecter les valeurs depuis un coffre privé, jamais commande publiée/log partagé. Daily crée une salle éphémère privée et tente sa suppression ; vérifier le dashboard en cas d'erreur et nettoyer les seules ressources de recette.

FedaPay refuse avant tout réseau les clés live, inconnues, configuration incomplète/désactivée ; dernier appel recontrôle la clé et vise exclusivement l'API sandbox avec timeout et sans redirection. **GET de préflight seul** : S1–S7, webhooks réels, L6 et L7 restent à effectuer. Aucune logique paiement modifiée, pas de DLQ applicative, retry ×5 fournisseur. Bascule live séparée après sandbox, selon le plan existant/quatre yeux.

Twilio : OTP/SOS sur MTN/Moov, quotas/verrouillage L8, langue du destinataire. Ne pas envoyer au SAMU ou autre numéro public réel lors d'une recette ; T11 seulement vers destination de test autorisée, ou N/A décidé/référencé par le porteur si fonctionnalité non configurée. FCM : Android + iPhone PWA installée ; rotation ne garantit pas le rejet immédiat de l'ancien token. Test de refus avec token effectivement invalidé et `SMOKE_FCM_EXPECT_REJECTED=1` ; une panne transport n'est pas un rejet token. Après logout, tester le **dispatch applicatif vers le compte sans token**, pas un smoke direct vers le token brut. Resend : DNS SPF/DKIM/DMARC, domaine expéditeur, réception inbox/spam réellement observée. Daily : D1–D18, deux appareils, admission/expiration, média AUDIO/CHAT et fermeture ; smoke serveur n'atteste pas la caméra cliente.

## 4. Crons et sauvegarde cible

Installer la crontab **préproduction** après sauvegarde/relecture des tâches existantes : `infra/deploy/crontab.preproduction.example`, DB_NAME explicite pour backup et diagnostics. Les horaires restent Africa/Porto-Novo. Secrets/tokens hors crontab ; destinataires et alertes autorisés. Une ligne installée, une invocation manuelle 2xx ou un healthwatch vert ne prouvent pas l'exécution planifiée. Recueillir heures/journaux minimisés et effets uniques : quatre générateurs → notifications, dispatch réel, prune, reconcile, healthwatch et renouvellement TLS. En option, `VERIFY_JOB_ENVIRONMENT=preproduction ... verify_deploy.sh --run-jobs` **mutera et peut envoyer des messages** : seulement fixtures/destinataires autorisés, jamais en production ; six tâches, résultat distinct de l'observation cron.

Première sauvegarde cible : clé root 0400/0600 conservée hors VPS, filestore présent, DB_NAME dédié. Verrou anti-concurrence ; fichiers temporaires sur le même filesystem. Dump et manifeste DB utilisent **le même snapshot exporté PostgreSQL**, même avec écritures concurrentes. Publication DB/fichiers puis **manifeste en dernier** ; échec avant complétude = pas de trio annoncé/purge des anciens backups. Permissions privées, deux archives chiffrées et empreintes SHA256. Crash brutal peut laisser des archives orphelines : sans manifeste, aucune sauvegarde complète ; examiner sans effacer arbitrairement.

```bash
sudo DB_NAME=digisante_preprod bash infra/deploy/scripts/pg_dump_encrypted.sh
sudo node scripts/preproduction/check-backup.mjs /var/backups/digisante-preprod/digisante_manifest_<STAMP>.txt
```

Le contrôle complet lit les deux archives et vérifie les SHA256, sans déchiffrer/restaurer. Healthwatch utilise une vérification **métadonnées seulement** pour éviter de relire des Go toutes les cinq minutes ; n'atteste pas l'intégrité. Une archive DB seule ne vaut plus sauvegarde complète. Snapshot DB et copie du filestore ne forment **pas une transaction commune** : garder les fixtures au repos lors du premier backup, puis éprouver la restauration réelle cohérente DB+fichiers sur hôte distinct en L11. Les SHA256 détectent l’altération par rapport au manifeste ; un manifeste public non signé ne prouve pas l’authenticité face à un attaquant qui modifie les trois fichiers. Copie hors VPS et récupération de clé à référencer ; 14 jours de backups ne vaut pas politique de conservation des données cliniques/financières.

## 5. Preuves et clôture

`preprod:prepare` photographie scripts/workflows/recettes ; `preprod:check` contrôle la fraîcheur sans réécriture. Registre `preproduction/L10/evidence.json` initial vide. `preprod:gate --expected-sha <SHA>` refuse absence, doublons, FAIL, autre SHA/empreinte, date invalide/future et métadonnées incomplètes. N/A seulement T11 avec décision de portée référencée ; aucune autre dérogation automatiquement admise. Ce sont des contrôles **déclaratifs**, sans authentification du signataire/lecture des pièces privées ni accès cible ; même vert, ils n'autorisent pas GO L11.

Dérogation 13/10/2026 : le cas I2 « VPS distinct » est non conforme (hôte partagé) ; la dérogation du porteur est consignée et doit être arbitrée en L11 — un gate vert ne la couvre pas.

Clôture opérateur : même candidate réellement qualifiée/déployée, neuf contrôles infrastructure et toutes les recettes référencées, appareils/réseaux/destinations autorisés, crons observés, trio sauvegarde contrôlé et conservé hors VPS. L9 humain, pentest/arbitrages L8, restauration/rollback/recette sept rôles et GO restent des preuves séparées. Une modification de code/config/recette invalide l'empreinte : nouvelle préparation, qualification et recontrôles de la portée affectée, sans recopier PASS périmés.

Finance F8 : recueillir en L10 la preuve maintenance/sauvegarde et la référence du travail de restauration/conservation encore ouvert ; la restauration réelle indépendante et l’arbitrage de conservation restent obligatoires en L11, sans clôture présumée dans le registre L10.
