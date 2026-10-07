# Contrat L6 — abonnement médecin payant

> Décisions commerciales approuvées par le porteur le 7 octobre 2026. Implémentation et auto-revue Codex selon les conventions Claude Code. Preuves : `suivi/LOT_L6.md`, `REVUE_L6_2026-10.md`. Ce contrat ne prouve ni paiement fournisseur réel, ni déploiement.

## Catalogue et périmètre

Catalogue partagé versionné `doctor-pilot-2026-10-v1`, imposé par l'API : FREE, gratuit ; PRO, **5 000 XOF / un mois calendaire**. STARTER et CLINIC indisponibles. Les autres abonnements restent après pilote selon L0. Prix/devises/dates/droits ne sont pas des entrées client ; les champs inconnus sont refusés. Paiement d'une période, **aucun prélèvement ni renouvellement automatique**.

PRO réserve le **démarrage d'une nouvelle téléconsultation**. `revenueStats` prépare la garde du lot L7 ; aucune API de revenus ni montant de revenu inventé en L6. FREE conserve les fonctionnalités de base, les droits médicaux soumis à leur habilitation/consentement et les soins engagés. Join/session/downgrade/end d'une consultation ouverte restent régis par L5 même après expiration PRO ; aucune interruption clinique pour une échéance commerciale. La vérification médecin et le statut/rôle courant restent obligatoires.

Un mois est calculé depuis la confirmation en **Africa/Lagos (UTC+1)**, heure conservée, jour borné au dernier jour du mois suivant. Exemple : 31 janvier 2026 → 28 février ; le renouvellement suivant part du 28 février → 28 mars. Aucun ancrage implicite au 31 ni période de 30 jours. Intervalle de droits **[startsAt, endsAt[**.

## API et stockage

| Route médecin | Contrat |
|---|---|
| GET `/subscriptions/catalog` | Catalogue, droits, offres désactivées, `autoRenew:false` |
| GET `/subscriptions/me` | Plan effectif, statut, échéance payée totale, intention d'arrêt, droits, commande en attente sans lien fournisseur |
| POST `/subscriptions` PRO | `{plan:'PRO', method, requestId:UUID}` ; médecin actif/vérifié, commande et paiement ; réponse checkout et statut financier, jamais activation par retour navigateur |
| POST `/subscriptions` FREE | Arrêt demandé à l'échéance payée ; abandon des commandes non activées ; aucun remboursement automatique |
| GET `/subscriptions/:id/checkout` | Reprise nominative, médecin vérifié ; lien seulement si commande non révoquée et paiement en attente |
| GET `/subscriptions/history` | 50 dernières commandes du médecin ; montants, périodes, révocation, statut/référence du paiement ; aucun token/lien checkout |

Toutes ces réponses portent `Cache-Control:no-store`. Le frontend utilise `postNow` : **aucune mise en file/rejeu offline**, aucun paiement dans le coffre local. Les retours `?id=…&status=approved` FedaPay sont ignorés : seule l'API donne le statut. L'UI relit le statut toutes les 15 s et au focus, affiche les commandes récentes et exige une confirmation explicite pour chaque achat/renouvellement/abandon.

`SubscriptionOrder.paymentId` unique et `(doctorId, requestId)` unique. Snapshot plan/version/montant/devise/mois ; période initialement NULL. Lien checkout scellé via `sealSecret` (AES-256-GCM hors test), jamais dans l'historique/audit ; effacé à activation, abandon ou remboursement. Seule l'API nominative de reprise le restitue en `no-store`. HTTPS et autorité FedaPay exacte exigés par un validateur partagé API/client. Pas de persistance du lien dans les stockages applicatifs. La navigation vers la page hébergée comporte l’URL fournisseur et peut figurer dans l’historique du navigateur ; ne pas la publier dans les preuves.

Les anciennes colonnes Doctor sont des traces compatibles, **jamais une preuve de droit**. L'accès PRO est dérivé d'une commande payée COMPLETED, non révoquée et actuellement dans sa période ; le serveur contrôle ce droit sous verrou avant `Daily.createRoom`. L'expiration ne dépend d'aucun cron. L7 doit réutiliser la même garde avec le RBAC courant.

## Transitions et concurrence

1. Demande : médecin User puis Doctor verrouillés ; vérifier son rôle/statut/KYC et le catalogue. Un même requestId restitue la commande existante sans fournisseur/débit ; autre méthode avec cette clé → 409. Une seule commande fournisseur non révoquée en attente par médecin ; seconde demande → 409, reprise proposée.
2. Mobile Money/carte : configuration FedaPay complète **et secret webhook** requis ; aucun checkout stub d'abonnement si absents. Création HTTP/token sous verrou, chaque appel borné à 8 s ; transaction locale bornée à 25 s. Montant 5 000 XOF, référence Payment locale, retour `/pro/stats` ; identité de facturation seulement, aucune donnée médicale.
3. Wallet : débit conditionnel existant, Payment COMPLETED, commande/période et audit PAYMENT_CONFIRMED **dans la même transaction**. Échec de solde ou d'effet annule tout. Mouvement DEBIT référencé par Payment.id. Pas d'appel FedaPay.
4. Webhook/reconcile : HMAC avant traitement et transition conditionnelle de paiement inchangés ; **effet abonnement + audit dans la transaction gagnante**. Le verrou Doctor est acquis avant de relire commande/révocation et calculer la fin déjà payée. Doublons/webhook ∥ reconcile ne créent qu'une période. PROCESSING n'accorde rien ; FAILED/CANCELLED terminaux n'accordent rien.
5. Renouvellement manuel PRO : commence à la dernière échéance COMPLETED non révoquée encore future ; sinon à la confirmation. Ne réécrit jamais les périodes précédentes. Une nouvelle commande doit être confirmée explicitement ; une ancienne clé ne renouvelle rien.
6. FREE : garde les périodes déjà activées jusqu'à leur échéance ; marque l'intention d'arrêt. Révoque les commandes non activées ; leur Payment reste réconciliable. Une confirmation tardive est enregistrée/auditée **sans période ni droits** ; référence affichée pour support/remboursement manuel. Course arrêt/confirmation sérialisée : soit confirmation d'abord et période conservée, soit abandon d'abord et absence de droits.
7. Remboursement interne : CAS COMPLETED→REFUNDED existant ; commande révoquée, éventuelle restitution wallet et audit PAYMENT_REFUND atomiques pour SUBSCRIPTION. Rejeu ne restitue pas deux fois. Le retour opérateur reste une intervention manuelle ; aucune restitution externe promise par REFUNDED.

Une période future déjà réglée n'est pas déplacée automatiquement si une période antérieure est remboursée. Un intervalle sans période payée donne FREE, même si un futur mois existe ; sa date reste consultable dans l'historique. Toute correction commerciale exige une décision et une trace, pas de backfill gratuit.

## Reprise des données et exploitation

Migration additive 33 `20261007125430_l6_paid_doctor_subscriptions` : nouvelle table/relations/index uniques + date d'arrêt Doctor. Les plans payants hérités ACTIVE deviennent EXPIRED, **plan original conservé**. Aucune création de Payment/commande/date d'activation à partir d'une ancienne colonne ; les paiements SUBSCRIPTION isolés peuvent être confirmés financièrement sans accorder PRO.

Avant migration sur un environnement réel : sauvegarde, inventaire des médecins payants et paiements isolés, contrôle humain des justificatifs. Requête d'inventaire : `SELECT id, "subscriptionPlan", "subscriptionStatus" FROM doctors WHERE "subscriptionPlan" <> 'FREE';` ; rapprocher les Payment SUBSCRIPTION sans commande après migration. Les justificatifs extérieurs ne sont pas importés automatiquement. Prévenir les médecins concernés ; toute reprise payante passe par un contrat revu et traçable.

Déployer API/client/migration cohérents après PR/CI, fermer anciens onglets. Ne pas lancer un ancien binaire qui réactive gratuitement PRO. Incident : fermer les nouvelles ventes FedaPay via l'intégration, corriger en avant ; droits déjà payés déterminés en DB, soin ouvert inchangé. Un incident de checkout externe après création amont peut laisser une transaction fournisseur orpheline (sans lien retourné au client) si la DB est annulée ; rapprocher par référence marchand, **ne pas promettre une transaction distribuée atomique**. Un webhook arrivé avant commit peut être ignoré puis repris par retry/réconciliation (> 1 h, cron 02:30).

Le montant abonnement est une recette de plateforme ; il ne représente pas un reversement médecin ou un net calculé avec la commission consultation 3 %. Frais opérateur, remboursements et rapprochement sont à qualifier en L7/L10. Le registre financier conserve l'historique ; pas de suppression manuelle pour débloquer un paiement en attente.

## Preuves et limites

Tests API/DB/Redis avec HTTP fournisseur simulé, tests client, parcours UI/wallet réels avec fonds synthétiques et checkout navigateur simulé. Retry ×5 testé par livraisons simultanées ; politique réelle de retry côté FedaPay à éprouver. **Aucune DLQ applicative n'existe** : lire la recette FedaPay, ne pas en inventer une.

L10 : paiement FedaPay sandbox effectivement réglé, webhook/reconcile réels, retour/refus/coupure/reprise, signature/configuration après proxy, remboursement opérateur réellement exécuté et rapproché. Aucun secret fournisseur disponible dans l'environnement ; aucune case réelle cochée automatiquement. i18n FR/EN, repli FR pour ajouts FON/YOR à valider en L9. Revue humaine indépendante, appareils réels et GO/NO-GO L11 restent requis.

Référence fournisseur consultée le 7 octobre : [transactions FedaPay](https://docs-v1.fedapay.com/paiements/transactions), création puis token/URL hébergée ; le statut du callback est explicitement non fiable.
