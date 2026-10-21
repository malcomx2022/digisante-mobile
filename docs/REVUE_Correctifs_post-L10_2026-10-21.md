# Revue — correctifs post-recette L10 (21 octobre 2026)

Branche `claude/inspiring-shannon-6c26ex`, base `main` `b26c1c8`. Candidat suivant (L11) : **rien n'est déployé sur la préprod** pendant la recette en cours sur `ec6b0dc`. Source : brief porteur « Correctifs post-recette L10 » (constats vérifiés en recette les 20–21/10/2026).

## Contrainte transverse : instantané L9 inchangé

`apps/web/src/i18n/messages.ts` fait partie des sources de l'instantané L9 (`scripts/validation/content.mjs`). La campagne de relecture native du 14/10 est verrouillée sur l'instantané `3e061d52…` : toute modification de ce fichier fait échouer `pnpm validation:campaign:check` (CI) et romprait le rattachement des retours annoncés. **Aucune clé i18n n'a donc été ajoutée ni modifiée** : les correctifs réutilisent des libellés existants (FR/EN, avec FON/YOR déjà traduits ou en repli FR). Aucune clé brute n'est affichée. Après intégration des retours natifs, des libellés dédiés pourront être ajoutés (voir « Limites »).

## Correctifs

| # | Constat | Correction | Preuve |
|---|---|---|---|
| C1 | Paiement Portefeuille COMPLETED affiché « Paiement initié » (`prescriptions.paid`) | L'état du paiement d'un RDV est lu sur `paymentStatus` serveur et affiché avec la famille existante `subscriptions.payment_*` (confirmé / en attente / en cours / refusé / annulé / remboursement interne). Un paiement existant, quel que soit son statut, n'offre plus de bouton « Payer » voué au refus (`Payment.appointmentId` unique). `prescriptions.paid` n'est plus utilisé. | `lib/payments.status.test.ts` ; E2E `post-l10-fixes` C1 (paiement Wallet → « Paiement confirmé », avant et après rechargement) |
| C2 | `ConfirmDialog` piégé dans une `card-pagne` (campagnes ; renouvellement PRO sans POST) | Rendu par **portail** sous `document.body` (le `clip-path`, un `transform` ou un `overflow` d'ancêtre ne peut plus le contenir). Concerne tous les usages, dont `FinanceOperations` (même motif). | E2E C2 en viewport mobile : dialogue enfant direct de `<body>`, visible, POST `/send` émis, campagne SENT. Rejoué sur l'ancien composant : échec sur l'assertion de portail (le confinement visuel lui-même ne s'est pas reproduit en Chromium headless local) |
| C3 | Pas de canal EMAIL ; audience ADMIN exclue du formulaire | Canal `EMAIL` (enum Prisma existante, dispatch Resend existant). Audience EMAIL = comptes ACTIFS **avec adresse e-mail** (portée annoncée et fan-out identiques). Audience ADMIN ouverte : aucun motif de sécurité (message non médical, déjà inclus dans « Tous les rôles ») ; libellé « Administrateurs » existant. | `campaigns.test.ts` : DRAFT → SENT, notification EMAIL tracée puis dispatch SENT, admin sans e-mail exclu, canal inconnu 422 |
| C4 | FAB diaspora = « Mon portefeuille » en double | FAB = « Recharger » (`wallet.topup` existant) vers `/diaspora/wallet#topup`, focus sur le montant. Navigation inchangée. | E2E C4 |
| C5 | `callback_url` FedaPay identique pour tous les types | `lib/payment-return.ts` : CONSULTATION → `/patient/appointments`, WALLET_TOPUP → `/diaspora/wallet`, SUBSCRIPTION → `/pro/stats` (règle unique, utilisée aussi par les abonnements). | `payment-return.test.ts` ; `payments.appointment-review.test.ts` (corps envoyé au fournisseur simulé) ; `subscriptions.test.ts` |
| C6 | Paiement REFUNDED introuvable dans `/admin/finance` | `GET /api/v1/admin/finance/payments` (finance:read, paginé, filtre `status` sur les 6 statuts), sans identité du payeur ; date = création. UI : liste filtrable remplaçant « confirmés récents » ; remboursement proposé sur COMPLETED seulement. | `admin.test.ts` (REFUNDED listé et filtrable, minimisation des champs, 422 statut inconnu, 403 sans scope) |
| C7 | Message générique masquant les 422 métier | `lib/api/errors.ts` `apiErrorMessage` : refus 4xx structuré affiché tel que l'API le formule (422 : champ + règle) ; générique seulement réseau / 5xx / 401 / réponse non structurée. `proofSchema` porte un message explicite (règle inchangée). | `errors.test.ts` ; `finance.test.ts` (422 nommant `proofRef`, opération inchangée) |

## Investigations

**I1 — `/admin/support` « ne se charge pas », aucune requête Nginx.** Non reproduit en code : E2E I1 (session ADMIN SUPPORT réelle) charge la page, recherche un compte (`/admin/users?q=`) et affiche le verrou OTP. Explication compatible avec le constat : la page **n'émet aucune requête tant qu'aucun compte n'est cherché** et Next précharge la route (RSC) dès que le lien est visible — l'absence de ligne Nginx au moment du clic est donc attendue ; la page n'affichait alors qu'un champ de recherche. Correction d'ergonomie : indice « Sélectionnez un utilisateur pour voir le détail. » tant qu'aucun compte n'est choisi. Si le symptôme persiste en préprod : relever la console navigateur et l'onglet Réseau (service worker, chunk JS 404 après redéploiement) — non observable depuis le dépôt.

**I2 — domaine Daily non persisté depuis le formulaire.** Chemin client → `PUT` → `setIntegration` correct (test API : un nouveau domaine est relu en base). Causes plausibles identifiées : (1) champ `domain` en `type=password` — la saisie était invisible ; (2) masque à 4 caractères (`••••y.co`) **identique** pour deux sous-domaines `*.daily.co` : impossible de voir le changement ; (3) une URL complète collée était acceptée puis refusée à la première salle ; (4) le `PUT` remplace le jeu complet. Corrections : relecture **en base** après écriture, échec bruyant `500 INTEGRATION_WRITE_UNVERIFIED` avant audit (`verifyIntegrationWrite`) ; contrôle de forme du domaine Daily (règle partagée `lib/daily-domain.ts`, identique au service) ; champs obligatoires exigés avant envoi ; identifiants non secrets (`domain`, `projectId`, `fromEmail`) saisis en clair (stockés chiffrés, affichés masqués) ; contrôle côté UI que la réponse reflète la saisie.

## §5 (paiements gelés)

Touchés dans `src/modules/payments/**` : `callbackUrl` (adresse de navigation, aucun effet sur la confirmation) et le **message** de `proofSchema` (règle identique). HMAC, idempotence, CAS, crédit wallet, réconciliation, L6/L7 inchangés. Re-tests exécutés : `payments*.test.ts`, `finance*.test.ts`, `subscriptions.test.ts`, `fedapay*.test.ts` (signatures valides et invalides) — tous verts dans la suite complète.

## Validation locale (PostgreSQL 16 + Redis locaux, 21/10/2026)

- API : 718 tests / 94 fichiers verts ; web : 155 tests / 19 fichiers verts ; lint et typecheck verts.
- `validation:check`, `validation:campaign:check` (instantané `3e061d52…` inchangé), `preprod:check`, `i18n:check --require-complete=en`, `metrics:check` (compteurs mis à jour : 183 endpoints REST, 840 tests déclarés).
- E2E (pile réelle, build avec proxy API, Chromium 1194) : **39/39 verts**, dont les 4 nouveaux scénarios `e2e/post-l10-fixes.spec.ts` et les parcours finances/abonnements existants.
- `test:scripts` : 204/208 ; les 3 échecs de `scripts/infra/deploy-order.test.mjs` sont **identiques sur `main`** (commande `ss` absente du conteneur local) — environnementaux, sans lien avec ce lot (aucun script d'infra modifié).

## Limites

- Libellés dédiés non ajoutés (verrou L9) : titre « Paiements » de la liste finance (section sans titre visible, filtre « Statut »), note sur la portée EMAIL, message d'aide au format de preuve côté UI (le message vient de l'API, en français). À ajouter avec la prochaine régénération de l'instantané L9.
- C2 : la cause exacte du renouvellement PRO sans POST du 20/10 21:46 n'est pas prouvée (le dialogue est hors carte sur `/pro/stats`) ; le portail supprime la classe de causes « confinement », l'E2E abonnement existant reste vert.
- RESEND-R6 réel, I1/I2 en préprod : à rejouer par l'opérateur sur le candidat suivant ; aucune recette réelle attestée ici.
