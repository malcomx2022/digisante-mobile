# Suivi du chantier B4 — ouverture des comptes fournisseurs

> **Lancé le 1ᵉʳ septembre 2026** · Chantier **B4** de l'état des lieux
> (`docs/ETAT_DES_LIEUX_Finalisation_2026-09.md` §4.3). Référentiel des comptes et clés :
> `docs/COMPTES_ET_CLES.md` (remis à niveau à ce lancement — aligné sur
> `PROVIDER_SECRET_KEYS`/`REQUIRED_SECRET_KEYS` du code).
>
> **Objectif de sortie** : les 5 providers en statut « configuré » sur `/admin/integrations`,
> test de readiness vert, et un paiement **sandbox FedaPay confirmé par webhook** de bout en bout.
> Mettre ce tableau à jour à chaque étape franchie.

## Tableau de suivi

| Provider | Compte ouvert | Clés récupérées | Saisies `/admin/integrations` | Readiness ✔ | Vérif. métier | Notes |
|---|---|---|---|---|---|---|
| **FedaPay** (sandbox) | ☐ | ☐ `secretKey` · ☐ `publicKey` · ☐ `webhookSecret` | ☐ | ☐ | ☐ paiement sandbox confirmé **par webhook** | vérification marchand FedaPay = délai tiers — recette `RECETTE_FedaPay_Sandbox.md` · ✅ patch §5 double crédit **appliqué le 22/09/2026** (S7 à rejouer) |
| **Twilio** | ☐ | ☐ `accountSid` · ☐ `authToken` · ☐ `fromNumber` | ☐ | ☐ | ☐ OTP SMS reçu sur +229 | tester MTN **et** Moov (sender ID §8) — fiche `RECETTE_Twilio_SMS.md` + smoke `test:smoke` |
| **Daily.co** | ☐ | ☐ `apiKey` · ☐ `domain` | ☐ | ☐ | ☐ salle de téléconsultation ouverte | free tier suffisant pour la recette — matrice `RECETTE_Daily_Teleconsultation.md` + smoke `test:smoke` |
| **Firebase** | ☐ | ☐ `projectId` · ☐ `clientEmail` · ☐ `privateKey` · ☐ config web `NEXT_PUBLIC_*` (6 valeurs + VAPID) | ☐ (serveur) | ☐ | ☐ push web reçu | `NEXT_PUBLIC_*` = **build web**, pas l’admin — recette `RECETTE_Firebase_Push.md` + smoke `test:smoke` |
| **Resend** | ☐ | ☐ `apiKey` (· `fromEmail`) | ☐ | ☐ | ☐ email transactionnel reçu | vérif. DNS du domaine d’envoi = dépend du domaine (B3) — checklist `RECETTE_Resend_Email.md` + smoke `test:smoke` |
| **FedaPay** (live) | ☐ (validation FedaPay) | ☐ clé live + ☐ secret webhook **roté avec** | ☐ | ☐ | ☐ 1ᵉʳ paiement réel réconcilié | **APRÈS** recette sandbox complète (§5) — plan quatre yeux `PLAN_Bascule_FedaPay_Live.md` (NO-GO au 22/09) |

## Ce qui peut se faire dès aujourd'hui (sans attendre B3)

1. **Ouvrir les 5 comptes** et récupérer les clés — c'est le délai tiers (vérification marchand
   FedaPay, upgrade Twilio hors trial) qui détermine la date, pas la technique.
2. **Twilio** : sortir du mode trial (le trial n'envoie qu'aux numéros vérifiés) et confirmer
   la délivrabilité vers +229 ; noter l'obligation éventuelle d'un numéro long comme expéditeur.
3. **Firebase** : créer le projet + l'app web, générer la clé de compte de service **et** la clé
   VAPID ; consigner les 6 valeurs `NEXT_PUBLIC_FIREBASE_*` pour le build de production.
4. Conserver toutes les clés dans un gestionnaire de secrets personnel en attendant la saisie —
   **jamais** dans le dépôt, ni dans un document partagé en clair.

## Ce qui attend le déploiement (B3)

- **Saisie dans `/admin/integrations`** : nécessite l'app déployée + un compte SUPER_ADMIN
  (les clés vont dans la base de production, chiffrées). ⚠️ Le `PUT` **remplace toutes les
  clés du provider** — saisir le jeu complet à chaque fois.
- **Webhook FedaPay** : l'URL `https://<domaine>/api/v1/payments/webhook` doit être joignable
  en HTTPS → configurer côté FedaPay **et** saisir le `webhookSecret` dans la même session
  que la clé API.
- **Resend** : la vérification DNS (SPF/DKIM) porte sur le domaine de production.
- **Recette sandbox FedaPay (§5, ordre impératif)** : recharge wallet (redirection → paiement →
  webhook → crédit), paiement consultation Mobile Money, paiement WALLET, réconciliation
  manuelle (`RECONCILE_TOKEN`), remboursement admin. **Puis seulement** la clé live
  (remplacer la clé + roter le secret webhook — rien d'autre, l'environnement est déduit de la clé).

## Rappels de sécurité

- Secrets d'intégration : chiffrés AES-256 en base, **jamais renvoyés en clair** (UI masquée),
  toute modification auditée `INTEGRATION_*`. Scope `integrations:write` = SUPER_ADMIN seul.
- Secrets d'infrastructure : `.env` uniquement (§3.6) — ne **jamais** les mettre en base.
- FedaPay = **§5** : les clés se gèrent librement via l'admin, la **logique** de paiement reste
  gelée (toute modification = revue + re-tests webhooks).
