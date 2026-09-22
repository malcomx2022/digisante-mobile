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
| Tâches cron | `OK/ÉCHEC (HTTP n)` + compteurs | jeton de service jamais en argument ni journalisé |
| Rotation | `/etc/logrotate.d/digisante` : quotidienne, 14 j, compressée, `copytruncate`, `maxsize 100M` | — |

## 2. Contrôles, seuils et signification

| Clé | Contrôle | Seuil (défaut, surchargeable dans `alert.conf`) | Première action |
|---|---|---|---|
| `ready` | `GET /api/v1/ready` (DB + Redis) | ≠ 200 | `systemctl status postgresql redis-server` ; `pm2 logs digisante-api --lines 100` |
| `pm2` | api online ×2, web ×1 | autre | `sudo -u digisante pm2 status` ; `pm2 restart digisante-api` si crash en boucle → logs |
| `disk` | `df` sur `/` et `/var/backups/digisante` | ≥ `DISK_THRESHOLD`=85 % | purger vieux journaux compressés ; vérifier la rétention des sauvegardes ; agrandir le volume |
| `backup` | dernière archive base < `BACKUP_MAX_AGE_H`=26 h **et** archive fichiers du même horodatage | dépassé / absente | `tail /var/log/digisante/pg_dump.log` ; lancer `pg_dump_encrypted.sh` à la main |
| `cron` | lignes `ÉCHEC` récentes (15 min) des tâches | ≥ 1 | 401 ⇒ `/etc/digisante/reconcile.token` ≠ `RECONCILE_TOKEN` du `.env` ; 5xx ⇒ logs API |
| `providers` | erreurs Twilio/Resend/Daily/FCM/FedaPay depuis le dernier passage | ≥ `PROVIDER_ERR_MAX`=3 | `/admin/integrations` → **Tester** ; statut du fournisseur ; clé révoquée ? |
| `backlog` | notifications `PENDING` > 15 min | > `BACKLOG_MAX`=100 | dispatch en échec (`cron`) ou fournisseur en panne (`providers`) |
| `webhooks` | `AUTH_FAIL` source `fedapay_webhook` sur 1 h | ≥ `WEBHOOK_401_MAX`=5 | secret webhook FedaPay désynchronisé (base ≠ dashboard) — **§5** : re-`PUT` du jeu complet, la réconciliation 02:30 rattrape |
| `tls` | expiration du certificat (si `DOMAIN` posé) | < 14 j | `certbot renew --dry-run` ; journal Certbot |

Une notification n'est envoyée **que sur changement d'état** (🔴 nouvelle alerte, 🟢 retour à la
normale) : une panne qui dure ne génère pas un message toutes les 5 minutes.

## 3. Destinataires et escalade

Configuration root-only : `/etc/digisante/alert.conf` (0600), par exemple :

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
