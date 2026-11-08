# Runbook — observabilité et alertes de production (prompt 15)

> **Date** : 22 septembre 2026 · **Principe** : aucune dépendance SaaS. Tout tourne sur le VPS :
> journaux PM2/cron (rotation 14 j), sonde `healthwatch.sh` (cron 5 min), notification par une
> commande locale configurable. Aucune donnée de santé, aucun jeton, aucun numéro complet dans
> les journaux ni dans les alertes.

## 1. Ce qui est journalisé — et ce qui ne l'est jamais

| Source | Contenu | Protection §4 |
|---|---|---|
| API (pino JSON) `/var/log/digisante/api-*.log` | méthode, URL, IP, reqId, statut | en-têtes jamais émis ; `token`/`access_token` masqués dans l'URL (`sanitizeLogUrl`) |
| Erreurs API | type, code, pile | **message des erreurs Prisma masqué** (il recopie les arguments de la requête — mesures, titres, identifiants) : opération + noms de champs seulement (`serializeErrorForLog`, corrigé le 22/09) |
| Fournisseurs (Twilio/Resend/Daily/FCM) | statut, code d'erreur fournisseur | numéro/e-mail **masqués**, code OTP et corps de message **jamais** en production (`lib/redact.ts`) |
| Nginx WS `/var/log/nginx/digisante-ws.log` | `$uri` sans query | JWT du WebSocket jamais journalisé |
| Tâches cron (root) `/var/log/digisante-cron/*.log` | `OK/ÉCHEC (HTTP n)` + extrait de réponse borné, sans caractères de contrôle | jeton de service jamais en argument ni journalisé ; répertoire root:root (B3 : jamais dans celui de `digisante`, où un lien détournerait l'écriture root) |
| Rotation | `/etc/logrotate.d/digisante` : quotidienne, 14 j, compressée, `copytruncate`, `maxsize 100M` | — |

## 2. Contrôles, seuils et signification

| Clé | Contrôle | Seuil (défaut, surchargeable dans `alert.conf`) | Première action |
|---|---|---|---|
| `ports` | API (3101/3201) et web (3100/3200) écoutés **uniquement** par `digisante${SUFFIX}` (uid du socket, `ss -Htlne`) | port libre ou autre compte | `sudo ss -Htlnpe '( sport = :3101 or sport = :3100 )'` (prod : 3201/3200) : un autre compte ou processus ⇒ **port squatté** — l'arrêter (administrateur de l'hôte), ne pas lever la maintenance, prévenir N2 ; le trafic Nginx a pu lui parvenir depuis le dernier OK (le jeton de service, lui, n'est jamais envoyé : lignes `cron` « jeton non envoyé ») ; port libre ⇒ voir `pm2` |
| `ready` | `GET /api/v1/ready` (DB + Valkey) sur le port de l'environnement (3101/3201) | ≠ 200 | `systemctl status postgresql valkey-server` (unités de l'hôte) ; `sudo -u digisante${SUFFIX} pm2 logs digisante${SUFFIX}-api --lines 100` |
| `pm2` | `digisante${SUFFIX}-api` online ×2, `digisante${SUFFIX}-web` ×1 | autre | `sudo -u digisante${SUFFIX} pm2 status` ; « waiting restart » = échec de démarrage relancé à délai croissant (≤ 15 s), l'API repart seule : lire `sudo -u digisante${SUFFIX} pm2 logs digisante${SUFFIX}-api --lines 100` (base, Valkey, `.env`) ; après correction, relance immédiate par `sudo -u digisante${SUFFIX} pm2 stop digisante${SUFFIX}-api && sudo -u digisante${SUFFIX} pm2 start digisante${SUFFIX}-api` — `pm2 restart`/`reload` échouent dans cet état (PM2 7.0.4) |
| `disk` | `df` sur `/` et `/var/backups/digisante` | ≥ `DISK_THRESHOLD`=85 % | purger vieux journaux compressés ; vérifier la rétention des sauvegardes ; agrandir le volume |
| `backup` | dernière archive base < `BACKUP_MAX_AGE_H`=26 h **et** archive fichiers du même horodatage, magasin complet (`files_count` ≥ `files_expected`, `files_missing=0`) | dépassé / absente / magasin incomplet / module de contrôle non fiable | `tail /var/log/digisante-cron/pg_dump.log` ; vérifier `KYC_STORAGE_DIR` du `.env` API (magasin `digisante 700`, nom sans « - » initial, fichiers lisibles par `digisante` — « refusé » ou « archivage impossible sous l'identité » au journal) ; lancer `sudo DIGISANTE_ENV=<env> /usr/local/lib/digisante${SUFFIX}/infra/deploy/scripts/pg_dump_encrypted.sh` ; module non fiable ⇒ réinstaller les scripts root |
| `cron` | lignes `ÉCHEC` récentes (15 min) des tâches | ≥ 1 | « compte sans droits … absent/refusé » ⇒ créer `digisante${SUFFIX}-jobs` (`infra/deploy/README.md` §2, jamais root ni l'utilisateur applicatif) ; « jeton absent ou vide » ⇒ `/etc/digisante${SUFFIX}/reconcile.token` ; 401 ⇒ `/etc/digisante/reconcile.token` ≠ `RECONCILE_TOKEN` du `.env` ; 5xx ⇒ logs API ; réconciliation `500 RECONCILE_PARTIAL_FAILURE` (`failed` ≥ 1, reste du lot traité) ⇒ `paymentId` des lignes `[FedaPay] réconciliation : paiement en échec` du journal API, paiement resté PENDING/PROCESSING alors que FedaPay peut l’avoir encaissé — **§5** : diagnostiquer la cause (activation L6, capture L7, base) avant le passage suivant de 02:30, jamais de mise à jour manuelle du statut |
| `providers` | erreurs Twilio/Resend/Daily/FCM/FedaPay depuis le dernier passage | ≥ `PROVIDER_ERR_MAX`=3 | `/admin/integrations` → **Tester** ; statut du fournisseur ; clé révoquée ? |
| `backlog` | notifications `PENDING` > 15 min | > `BACKLOG_MAX`=100 | dispatch en échec (`cron`) ou fournisseur en panne (`providers`) |
| `webhooks` | `AUTH_FAIL` source `fedapay_webhook` sur 1 h | ≥ `WEBHOOK_401_MAX`=5 | secret webhook FedaPay désynchronisé (base ≠ dashboard) — **§5** : re-`PUT` du jeu complet, la réconciliation 02:30 rattrape |
| `tls` | expiration du certificat (si `DOMAIN` posé) | < 14 j | `certbot renew --dry-run` ; journal Certbot |

Une notification n'est envoyée **que sur changement d'état** (🔴 nouvelle alerte, 🟢 retour à la
normale) : une panne qui dure ne génère pas un message toutes les 5 minutes.

## 3. Destinataires et escalade

Hôte IONOS partagé : une instance healthwatch PAR environnement (`DIGISANTE_ENV` dans son fichier `/etc/cron.d`), le
corps de l'alerte nomme l'environnement (« DigiSanté preproduction|production »). Ci-dessous `${SUFFIX}` = `-preprod`
ou vide, `<env>` = `preproduction` ou `production`.

Configuration root-only : `/etc/digisante${SUFFIX}/alert.conf` (0600), par exemple :

```bash
ALERT_CMD='mail -s "[DigiSanté] alerte production" ops@<domaine>'   # ou tout outil local lisant stdin
DOMAIN=<domaine>
DISK_THRESHOLD=85
```

| Niveau | Qui | Délai | Quand |
|---|---|---|---|
| N1 | Exploitant d'astreinte (porteur ou délégué) | 30 min ouvrées / 2 h la nuit | toute alerte |
| N2 | Développeur référent (SEGLA E. Ulrich Gislain) | 2 h | `ready`/`pm2` > 15 min, `backup` manquée, `webhooks` |
| N3 | Fournisseur / hébergeur (Infomaniak, FedaPay, Twilio…) | selon contrat | panne externe confirmée |

⚠️ `ready` en panne ⇒ **SOS SMS indisponible** (l'API ne répond plus) : prévenir les relais ASC
et afficher le numéro d'urgence public. `webhooks` ⇒ paiements confirmés avec retard (≤ 24 h via
la réconciliation), **pas** de perte.

## 4. Simulations exécutées le 22/09/2026 (sans dommage, pile locale)

| Scénario | Méthode | Résultat |
|---|---|---|
| État nominal | API + PostgreSQL + Redis réels | tous `OK` (hors `webhooks`, cf. ci-dessous) |
| **Panne Redis** | arrêt du Redis de l'API | `ready ALERTE /ready HTTP 503` → notification 🔴 ; redémarrage → 🟢 « rétabli » |
| Anti-spam | 2ᵉ passage, état inchangé | **0** notification |
| **Erreur fournisseur** | 3 lignes `[Twilio] Messages en échec` ajoutées au journal | `providers ALERTE` → 🔴 ; passage suivant sans nouvelle erreur → 🟢 |
| Tâche en échec | ligne `ÉCHEC (HTTP 401)` d'`internal_job.sh` | `cron ALERTE` → 🔴 |
| **Disque proche du seuil** | seuil abaissé à 20 % (disque à 23 %) | `disk ALERTE` → 🔴 |
| Webhooks rejetés | base de test (tests de signature invalide de l'heure écoulée) | `webhooks ALERTE 28 rejetés` — détection réelle, attendue sur une base de test |
| Contenu des alertes | 6 messages reçus par `ALERT_CMD` | **0** jeton, **0** numéro de téléphone |

## L8 — diagnostics sans fuite

Nginx modèle : access_log global digisante-access.log/noquery et WS séparé, sans Referer/User-Agent ; error_log de requête désactivé car Nginx recopie URL+Referer sans redaction. Détecter statuts 4xx/5xx et disponibilité par accès/healthwatch, diagnostiquer via reqId et code/status/operation API structurés (les messages/piles arbitraires sont retirés). Reproduire sur pile synthétique pour traces Nginx détaillées, jamais réactiver combined/error_log sur trafic réel avec QR/JWT. Qualification cible/collecteurs et rotation de ces logs restent exploitation L10 ; les tests Docker ne prouvent pas l’installation VPS. Ancien historique : conservation/purge selon décision validée L11, sans suppression arbitraire d’une preuve. Redis reste fail-closed, aucune bascule mémoire sous incident ; mesurer impact en PM2/CGNAT en recette réelle.
