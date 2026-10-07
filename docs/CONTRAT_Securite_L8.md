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
