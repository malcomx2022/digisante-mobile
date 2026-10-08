# Recette Resend — domaine d'envoi, SPF/DKIM/DMARC et email transactionnel (B4)

> **L10, 8 octobre 2026 :** suivre d’abord `CONTRAT_Preproduction_L10.md` §3 pour les gardes obligatoires (NODE_ENV=production, préproduction isolée, SHA exact, DB *_preprod, index Redis et un seul fournisseur). Les commandes courtes ci-dessous ne suffisent plus seules. Setup smoke indépendant sans FLUSHDB/seed/migration ; aucune réception réelle attestée dans cette livraison. Résultats à référencer dans `preproduction/L10/evidence.json`.

> **Prérequis humains** : compte Resend, **accès DNS** au domaine d'envoi (celui de B3), une
> boîte de recette (`EMAIL_RECIPIENT_TEST`). Ne cocher readiness **et** vérification métier
> qu'après **validation DNS chez Resend** et **réception constatée**.

## 0. Ce que le dépôt garantit (vérifié le 22/09/2026)

| Point | Où | Preuve |
|---|---|---|
| Résolution `apiKey`/`fromEmail` : base chiffrée → `.env` (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`) | `lib/integrations`, `services/resend.ts` | `integrations.test.ts` |
| `PUT` RESEND : clé `re_…` et expéditeur `adresse@domaine` / `Nom <adresse@domaine>` validés, **sans reprendre la valeur** dans l'erreur | `validateSecretsShape` | `integrations.test.ts` |
| Expéditeur par défaut `DigiSanté <no-reply@digisante.bj>` si `fromEmail` absent — **à remplacer** par une adresse du domaine vérifié | `DEFAULT_FROM` | `resend.test.ts` |
| Journaux : adresse **masquée** (`u•••@domaine`), id masqué ; sujet/corps **jamais** en production (même en stub) ; erreur réduite à `name` | `services/resend.ts` | `resend.test.ts` |
| Succès / échec fournisseur / erreur réseau / stub : jamais de throw, aucun appel réseau en stub | `services/resend.ts` | `resend.test.ts` (fetch simulé) |
| **Aucune donnée de santé par email** : seul le canal des **campagnes de santé publique** (`/admin/campaigns`, non médical) emprunte `EMAIL` ; les notifications typées (labo, RDV, ordonnance…) partent en `IN_APP`/`PUSH` avec des gabarits génériques | `notifications.service.ts`, `campaigns.service.ts` | revue de code (grep `channel:`) |

## 1. DNS — à faire chez l'hébergeur du domaine

Resend → *Domains → Add domain* affiche les enregistrements **exacts** à créer : les copier tels
quels (ne pas les recopier depuis ce document — les valeurs sont propres au compte).

| Enregistrement | Type | Rôle | Vérif. |
|---|---|---|---|
| Sous-domaine de retour (ex. `send.<domaine>`) | **MX** | rebonds (bounces) | ☐ |
| `send.<domaine>` | **TXT** SPF (`v=spf1 include:… ~all`) | autorise Resend à émettre | ☐ |
| `resend._domainkey.<domaine>` | **TXT** DKIM (clé publique) | signature des messages | ☐ |
| `_dmarc.<domaine>` | **TXT** `v=DMARC1; p=none; rua=mailto:<boîte du porteur>` | politique + rapports (commencer en `p=none`, durcir après 2-4 semaines de rapports propres) | ☐ |
| Statut du domaine chez Resend | — | **Verified** | ☐ |

Contrôle indépendant : `dig TXT resend._domainkey.<domaine> +short`, `dig TXT send.<domaine> +short`,
`dig TXT _dmarc.<domaine> +short`.

## 2. Smoke test serveur (opt-in)

```bash
SMOKE_RESEND=1 EMAIL_RECIPIENT_TEST=recette@<domaine> \
  pnpm --filter @digisante/api test:smoke -- resend
```

Sortie publiable : `[smoke:resend] destinataire r•••@<domaine> · message ••••abcd · accepté=true`.

## 3. Fiche de recette

| # | Scénario | Attendu | OK |
|---|---|---|---|
| R1 | Smoke test | `accepté=true` | ☐ |
| R2 | Réception | message en **boîte de réception** (Gmail + Outlook), pas en spam | ☐ |
| R3 | Authentification | en-tête d'origine : `spf=pass`, `dkim=pass`, `dmarc=pass` | ☐ |
| R4 | Expéditeur | adresse du **domaine vérifié** (pas le défaut `digisante.bj` si ce n'est pas le vôtre) | ☐ |
| R5 | Erreur fournisseur | `fromEmail` d'un domaine NON vérifié → échec propre (`accepté=false`), journal `resendError=validation_error`, sans adresse en clair | ☐ |
| R6 | Campagne email | `/admin/campaigns`, canal EMAIL, audience de recette → reçu dans la langue du destinataire | ☐ |

Critère de sortie B4 Resend : **R1→R4 OK** et domaine **Verified**.

## 4. Rollback

`/admin/integrations` → **RESEND** → **Désactiver** (envois en stub, immédiat). Clé compromise :
la révoquer chez Resend, en créer une nouvelle, `PUT` du jeu complet (`apiKey`, `fromEmail`).
