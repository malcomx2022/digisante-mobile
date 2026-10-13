# Contrat L8 — résiduels de sécurité et configuration

> 7 octobre 2026. Branche `feat/l8-security-residuals`, base main `ebd0547240e1fcd80b6c5a528bf9c5d6c74d05f5` après #187 ; CI main 37656606253 réussie. Corrections par Codex à la demande du porteur, selon les conventions Claude Code. Aucun fournisseur réel, VPS ou test d’intrusion exécuté dans ce lot.

## Authentification et UX

Inscription syntaxiquement valide : 201 et `otp:{channel,expiresInSec}`, sans identifiant/état/rôle/code en développement ou production. Un conflit téléphone/e-mail/licence ne révèle pas quel champ est déjà utilisé : le compte existant au numéro présenté reçoit un OTP sans modification de son profil ; sans compte à ce numéro, génération d’un état fictif sans envoi payant ni création partielle. Le compte nouvellement inscrit n’est identifié publiquement qu’après possession du téléphone. Les champs requis/422 et les quotas/429 restent explicites, indépendamment du contenu de la base. Diagnostic `user`/`devCode` réservé aux tests synthétiques `NODE_ENV=test`, jamais autorisé pour un pilote réel.

Demande OTP connue/inconnue : même réponse 200. Inconnue : état Redis et quotas identiques, aucun SMS. Vérification : 401 générique pour code absent, expiré, faux ou code fictif correct sans compte ; jamais de session dans ce dernier cas. Un échec même sans OTP est compté avant comparaison : cinq échecs verrouillent 30 min, renvoyer un code ne remet pas le compteur à zéro. La forme du code est validée avant lookup (422). Suspension courante reste 401 après preuve de possession.

Libellés FR/EN conditionnels : une réponse d’acceptation ne prouve pas la livraison SMS. Numéro, couverture, connexion puis support si code absent ; les conflits licence/e-mail peuvent nécessiter une intervention support/KYC, sans renvoyer une identité à un visiteur. Les validations natives sont L9. Les temps de lookup/envoi réel ne sont pas garantis constants : mesurer la distinction statistique lors du pentest L10/X15 et décider avant GO L11 ; aucune acceptation de ce risque n’est inventée.

Empreinte OTP HMAC-SHA256 avec séparation `digisante:otp:v1` et clé infrastructure JWT_SECRET. Une fuite Redis seule ne permet plus une recherche exhaustive sans clé. Téléphone et code entrent dans l’empreinte ; comparaison constante sur deux hex SHA256 valides. Rotation JWT/code L8 invalide les anciens OTP SHA256 et nécessite renvoi (TTL cinq minutes), sans accepter de repli non poivré. Aucun secret nouveau en base. Test/development ne sont pas des modes de production.

JWT_REFRESH_TTL configure le JWT, le cookie Max-Age et la TTL de l’allowlist ensemble ; entier suivi de s/m/h/d, 1 s à 90 j, défaut 30d. Rotation du refresh et GETDEL, cookie HttpOnly/SameSite et algorithme HS256 conservés. Panne Redis refuse les opérations, sans repli mémoire ni skipOnError. La disponibilité/panne/CGNAT est à qualifier sur la cible L10.

## Chaîne d’audit et transactions

Sous le verrou PostgreSQL 4021957 : dernier par createdAt DESC/id DESC, nouvelle date `max(Date.now(), dernier.createdAt+1 ms)`. Un CUID ne départage pas causalement des insertions à la même milliseconde ; la date logique évite de nouveaux ex æquo ou inversions d’horloge. La date d’audit peut avancer de quelques millisecondes sous charge/horloge reculée : ce n’est pas une attestation d’heure fournisseur. Sérialisation des écritures, hash canonique, triggers append-only et formule de hash restent intacts, aucun backfill ni migration.

L’audit des effets consentement DMP (partage, réclamation, révocation, ré-octroi, révocation QR), KYC (soumission/décision) et laboratoire (prise en charge/résultat critique) appartient à la transaction READ COMMITTED de l’effet. Échec audit : rollback, réponse d’échec ; aucune réussite silencieuse. Audits de lecture/refus DMP restent séparés et sans corps clinique. Ces transactions locales ne promettent pas de livraison SMS ou d’effet fournisseur exactly-once.

Avant bascule : arrêter les anciens workers, vérifier l’héritage avec le vérificateur de chaîne sur copie restaurée et `ORDER BY createdAt,id`. Si incohérence historique : NO-GO, diagnostic documenté et décision opérateur ; ne jamais réécrire/purger les maillons ni attribuer arbitrairement un ordre historique. Ancien code d’écriture ne doit pas être redémarré avec le nouveau. Sous restauration, vérifier aussi le rôle DB non propriétaire et UPDATE/DELETE/TRUNCATE interdits. Audit lu en pagination déterministe ; filtres temporels ne deviennent pas des preuves financières.

## Journaux et liens

API : URL sans query/fragment (même clé encodée/inconnue), aucun en-tête/corps ; erreurs 4xx réduites au code/reqId, exception inconnue sans message/pile arbitrary, erreurs Prisma avec noms/type/opération minimisés. Services Twilio/Resend/FCM évitent chaînes d’erreur amont arbitraires, et stubs masquent le contenu en développement et production.

Nginx : format noquery hérité de tout le serveur, sans Referer/User-Agent. Les journaux d’erreur de requête sont désactivés (`error_log /dev/null`) car Nginx ne les expurge pas : les erreurs upstream recopient request/Referer. Statut/volume/horodatage/IP via access_log, diagnostic métier via API structurée et healthwatch. Débogage Nginx avec requêtes exclusivement synthétiques sur pile séparée ; pas de retour temporaire à combined en production. Vérifier CDN/proxy/collecteurs et ancien historique L10/L11 ; conserver ou purger conformément à la politique validée, sans supprimer arbitrairement une preuve.

FCM : normaliser avec URL WHATWG puis vérifier même origine ; rejeter double slash, antislash brut/encodé, séparateur encodé et caractères de contrôle. Normalisation à réception et au clic ; chemin/query interne conservé, navigation attendue avant focus. Ce contrôle ne rend pas légitime le contenu clinique d’une notification sur appareil verrouillé (recette minimisation L10).

## Sous-lot paiement §3.5

Helper API/client commun : seulement `https://checkout.fedapay.com` et `https://sandbox-checkout.fedapay.com`, port standard/443 ; credentials, hôtes approximatifs, port arbitraire, espaces/contrôles/antislash refusés. Les autres hôtes, même fedapay.com, ne sont pas un checkout autorisé. Toute extension exige preuve officielle et revue/re-tests. Redirections HTTP API refusées, identifiant amont borné/opaque et encodé dans le chemin. URL invalide → 502 avant retour au client ; jamais de lien factice en production sans clé. Les stubs synthétiques test/dev restent identifiés comme tels, pas une preuve de paiement.

Les corps et exceptions bruts amont ne sont ni lus pour diagnostic ni journalisés ; status/operation seuls. Réconciliation réutilise isValidServiceToken (SHA256 de tailles fixes + timingSafeEqual, absence refusée). HMAC du rawBody et tolérance, statut terminal/CAS, effet wallet, commission 3 %, droits L6 et journal L7 restent identiques. Aucune DLQ ou automatisation de reversement/remboursement externe ajoutée. Consigner le diff exact et les régressions dans la revue L8 ; S1–S7 fournisseur restent L10.

## Configuration cible et gates externes

CSP production sans unsafe-eval et sans connect-src https:/wss: globaux ; mêmes origines, Daily/Daily-video, Googleapis/Firebaseio explicités, worker-src self/blob. Dev localhost/eval seulement ; exception gstatic uniquement sur le script SW FCM. unsafe-inline reste pour l’hydratation Next 14 sans nonce : résiduel X8 non accepté par ce document, stratégie nonce/hashes à arbitrer avec le cache/PWA et le pentest avant GO. Recette SDK réel Daily et FCM requise, pas déduite des doubles.

HSTS préparé via `infra/deploy/nginx/hsts-after-tls.conf`, inclusion manuelle HTTPS seulement après certificat/redirection/renouvellement vérifiés. Début 24 h ; pas de preload/includeSubDomains sans qualification des domaines. L’inclure aussi dans chaque location qui pose add_header (héritage Nginx). Aucun certificat réel ni HSTS sur cible attesté ici.

Twilio Geo Permissions SMS ET Voice : ne laisser que pays attendus ; Bénin pour OTP local, pays diaspora validés selon vrais besoins ; aucune restriction arbitraire en code cassant diaspora/SOS. Responsable exploitation/porteur : preuve console et test autorisé en L10 avant GO L11. Test d’intrusion externe : périmètre et dossier préparés dans l’addendum d’audit ; pas de faux résultat ou acceptation de risque automatique.

Consommation OTP L8 : CAS Lua Redis du hash courant avant suppression du code/compteur, une seule session par code ; un renvoi concurrent n’est jamais effacé par une ancienne vérification. CSP choisie par phase Next (développement seulement pour next dev), jamais par le seul NODE_ENV=test de la pile E2E. Tests simultané/renvoi et en-têtes du serveur de production requis.

## Amendement §3.5 — 13 octobre 2026 (bloquants B1/B2 de la revue indépendante)

Établi sur demande explicite du porteur de traiter les bloquants B1–B5 de `REVUE_Independante_L0-L10_2026-10.md` §4.1. Zone gelée §5 : diff minimal, re-tests webhooks exécutés (voir ci-dessous). Le texte du 7 octobre ci-dessus reste la décision L8 d’origine ; cet amendement la complète sans la réécrire.

**B1 — liste d’hôtes exacte étendue, liée à l’environnement de la clé.** `isFedapayCheckoutUrl(url, environnement?)` (`packages/shared/src/subscriptions.ts`, constante `FEDAPAY_CHECKOUT_HOSTS`) :

| Environnement (déduit de la clé secrète, comme la base d’API) | Hôtes exacts admis |
|---|---|
| live (`sk_live_…`) | `process.fedapay.com`, `checkout.fedapay.com` |
| sandbox (tout autre préfixe, repli fail-safe) | `sandbox-process.fedapay.com`, `sandbox-checkout.fedapay.com` |

- Preuves officielles relevées le 13/10/2026 : tests des SDK `fedapay` npm 1.2.5 (`test/TransactionTest.ts`) et `fedapay-php` (`tests/TransactionTest.php`, HEAD c96ba2d) attendant `token.url = https://process.fedapay.com/<token>` (réponse simulée, environnement `sandbox`) ; application de paiement servie par `process.fedapay.com` (`appEnv:"live"`, `apiDomain:"api.fedapay.com"`) et par `sandbox-process.fedapay.com` (`appEnv:"sandbox"`, `apiDomain:"sandbox-api.fedapay.com"`), route `/:token?` vérifiant le jeton par `GET /v1/transactions/verify_token`. `checkout` / `sandbox-checkout` = origines du widget `cdn.fedapay.com/checkout.js` (`pk_live` / `pk_sandbox`), conservées de la liste L8 ; aucune source ne les montre dans un `token.url`.
- Exclus : `fpay.li` (README fedapay-cli 2020 sans environnement, domaine NXDOMAIN au 13/10/2026), hôtes `dev-*`, tout joker ou suffixe `*.fedapay.com`.
- API : contrôle avec l’environnement de la clé (une clé bac à sable ne renvoie jamais vers la page live, ni l’inverse) → 502 sinon. Client (consultation, recharge, abonnement L6) : union des deux listes, faute de connaître l’environnement ; `paymentOutcome` (web) applique désormais ce contrôle avant toute redirection et lève une erreur sur toute autre URL, stub de développement compris — ni redirection arbitraire, ni annonce d’un paiement réglé.
- Grammaire inchangée : HTTPS, port 443 explicite au plus, ni credentials, ni espace/séparateur Unicode, contrôle ou antislash ; égalité exacte de l’hôte.
- **Non prouvé** : l’hôte réel d’un `token.url` n’a jamais été observé (live : fixtures simulées des SDK ; sandbox : déduit de la configuration de l’application hébergée). Relevé S8 (avec S1, `RECETTE_FedaPay_Sandbox.md`) obligatoire avant GO : un hôte différent donne 502 et n’est ajouté qu’après preuve exacte, jamais par élargissement. Si S1 ne montre jamais `checkout`/`sandbox-checkout`, leur retrait est une décision du porteur.

**B2 — extraction de la transaction du webhook.** `handleWebhook` ne lit plus que la forme officielle `{ name, entity: <transaction> }` (exemples docs.fedapay.com sur `event.name`, intégrations officielles PMPro `$event->entity->id` et Odoo `data['entity']`) :

- identifiant = `entity.id` seulement, normalisé par `parseFedapayTransactionId` (entier JSON sûr > 0 ou chaîne `[a-z0-9_-]{1,128}`), définition partagée avec la création de transaction ; jamais `id`, `fedapayId` ni `status` racine (l’`id` racine est celui de l’événement). Un entier au-delà de 2^53, qui a perdu sa précision au parsing et pourrait désigner une autre transaction, est refusé ;
- statut = `entity.status` (chaîne requise), mappé par `mapFedapayStatus` inchangé ;
- `name` (ou `type`, forme API Events) présent et non `transaction.*` → 200 `{ ignored: true }` sans effet : un endpoint reçoit par défaut tous les événements du compte, les rejeter ferait rejouer FedaPay ; `name` absent → traitement sur `entity` ; `entity` sérialisée en chaîne tolérée ;
- forme maison antérieure (`fedapayId`/`status` racine), identifiant invalide, statut absent → 400 sans effet.

Réconciliation : `try/catch` par paiement (une exception — P2028, interblocage, conflit d’activation L6/capture L7 — n’interrompt plus le lot ; la transaction du paiement est annulée en entier et il est repris au passage suivant), ordre `createdAt`/`id` croissant, réponse `{ scanned, resolved, failed }`. Journal `[FedaPay] réconciliation : paiement en échec, lot poursuivi` avec `paymentId` et `err` (sérialiseur minimisé), sans charge utile. L’échec reste **bruyant** : dès `failed > 0`, l’endpoint répond **500** `RECONCILE_PARTIAL_FAILURE` avec les seuls compteurs (`scanned`, `resolved`, `failed`), après avoir traité tout le lot ; `fedapay_reconcile.sh` journalise alors `ÉCHEC` et sort 1, et la sonde `cron` de `healthwatch.sh` alerte dès un échec, comme lorsque l’exception remontait en 500 avant B2. La sonde `providers` compte aussi ce libellé, mais n’alerte qu’à partir de `PROVIDER_ERR_MAX` = 3 lignes par passage : elle **ne couvre pas** un échec isolé, d’où la réponse non 2xx (chaîne vérifiée par `scripts/infra/reconcile-alert.test.mjs`). Lot complet ou balayage sans clé : 200. Un échec de lecture du statut fournisseur (`getTransactionStatus` → `null`, journalisé `[FedaPay] … en échec`/`erreur réseau`) reste, comme avant, un paiement sauté et non un `failed`.

Inchangés : vérification HMAC et tolérance, transition conditionnelle terminale (CAS), crédit wallet, commission 3 %, activation L6, capture L7, `applyPaymentStatus`, remboursement interne. Aucun appel fournisseur ajouté au webhook (pas de relecture `GET /transactions/{id}` : changement plus large, à décider séparément).

**Non prouvé (B2)** : FedaPay ne publie aucun JSON de livraison réelle ; la forme retenue repose sur les consommateurs officiels. Relevés S9/S10 en bac à sable obligatoires (forme d’une livraison `transaction.approved`, puis `declined`/`canceled`, depuis le journal de livraison FedaPay). À arbitrer par le porteur : FedaPay indique que `canceled`/`declined` ne sont pas finaux (nouvelle tentative possible), alors que FAILED/CANCELLED sont terminaux ici — une approbation tardive sur la même transaction serait ignorée en idempotence.

Re-tests §5 exécutés le 13/10/2026 sur base locale synthétique (fournisseur simulé) : `payments.test`, `payments.reconcile.test`, `payments.concurrency.test`, `finance.test`, `fedapay.test`, `fedapay.security.test`, `subscriptions.test`, `wallet.test`, `journeys.test`, `l8-security.test` — 146/146 ; suite API complète 621/621, web 126/126, outillage 67/67 (dont la chaîne d’alerte `scripts/infra/reconcile-alert.test.mjs`). Les tests webhook utilisent désormais tous la forme officielle avec un `id` d’événement racine distinct (`src/test/fedapay-fixture.ts`) ; avec l’ancien `payments.service.ts`, 27 tests webhook/réconciliation échouent (500 Prisma, mauvaise transaction ou lot interrompu). Aucun paiement réel ni bac à sable exécuté.
