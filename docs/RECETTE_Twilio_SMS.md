# Recette Twilio — OTP, SMS SOS et délivrabilité MTN / Moov (B4)

> **Prérequis humains** : compte Twilio **hors trial** (le trial n'envoie qu'aux numéros
> vérifiés), `fromNumber` = **numéro long** (le sender ID alphanumérique n'est pas garanti au
> Bénin — CLAUDE.md §8), deux téléphones de recette : un **MTN** et un **Moov**, format
> `+22901XXXXXXXX` (10 chiffres depuis la renumérotation de 2024).
> **Règle** : une case B4 n'est cochée que pour une réception **constatée par l'opérateur**
> sur le téléphone. Un « accepté par Twilio » n'est pas une réception.

## 0. Ce que le dépôt garantit déjà (vérifié le 22/09/2026)

| Point | Où | Preuve |
|---|---|---|
| Format `+229` + 10 chiffres | `phoneSchema` (`@digisante/shared`) | tests `auth` |
| Quota d'envoi OTP : **5 envois / 15 min / numéro** | `auth.otp.ts` (`OTP_SEND_MAX`, `OTP_SEND_WINDOW_SECONDS`) | `auth.quota.test.ts` |
| Verrouillage **30 min après 5 échecs**, audit `AUTH_FAIL` / `AUTH_LOCKOUT` | `auth.service.ts` | `auth.test.ts` |
| SMS SOS dans la **langue du patient** (FR/EN/FON ; **YOR → repli FR**) | `sos.service.ts` (`SOS_SMS`) | `sos.service.test.ts` |
| Expéditeur = **numéro long** `fromNumber` | `services/twilio.ts` | `twilio.test.ts` |
| Journaux : numéro **masqué** (`+229••••••0001`), SID masqué, code OTP/corps SMS **jamais** en production (même en stub) ; erreur Twilio réduite à `code` + `more_info` | `lib/redact.ts`, `services/twilio.ts` | `twilio.test.ts` |
| Bascule stub ↔ réel dynamique (sans redéploiement) | resolver `lib/integrations` | `integrations.routes.test.ts` |

⚠️ **Écart connu** : pas de texte SOS en **Yorùbá** (repli FR). À fournir par un locuteur natif
avec les 6 clés `sos.*` critiques (B1) — **jamais par traduction machine**.

## 1. Smoke test serveur (opt-in, avant la recette sur téléphone)

Sur l'environnement cible (VPS de recette), avec ses variables `DATABASE_URL`, `REDIS_URL`,
`HEALTH_ENCRYPTION_KEY` et `NODE_ENV` — les clés Twilio sont lues **comme en production**
(base chiffrée saisie via `/admin/integrations`, sinon `.env`) :

```bash
cd /var/www/digisante-mobile
SMOKE_TWILIO=1 SMOKE_TWILIO_TO=+22901XXXXXXXX \
  pnpm --filter @digisante/api test:smoke -- twilio
```

Sortie attendue (la seule à reporter) : `[smoke:twilio] destinataire +229••••••XXXX · SID ••••abcd · accepté=true`.
Ce test **n'est jamais** exécuté par `pnpm test` (exclu de `vitest.config.ts`) ; sans clés il
**échoue** explicitement (« Twilio non configuré (stub) ») au lieu de simuler un succès.

## 2. Fiche de recette manuelle

Remplir une ligne par essai. **SID** = 4 derniers caractères seulement (console Twilio →
*Monitor → Messaging logs*). Aucun code OTP, aucun numéro complet dans cette fiche.

| # | Scénario | Réseau | Action | Résultat attendu | SID (masqué) | Reçu (heure) | Opérateur | OK |
|---|---|---|---|---|---|---|---|---|
| T1 | OTP SMS | MTN | `/login` → numéro MTN → « Recevoir le code » | SMS `DigiSanté: NNNNNN` en < 60 s, depuis le numéro long | •••• | | | ☐ |
| T2 | OTP SMS | Moov | idem, numéro Moov | idem | •••• | | | ☐ |
| T3 | Connexion | MTN | saisir le code reçu | espace du rôle ouvert | — | | | ☐ |
| T4 | Quota d'envoi | MTN | 6 demandes de code en < 15 min | 6ᵉ refusée (429 « Trop de demandes ») ; **5 SMS max** reçus | — | | | ☐ |
| T5 | Verrouillage | Moov | 5 codes faux | 5ᵉ → « verrouillé 30 minutes » ; audit `AUTH_LOCKOUT` visible `/admin/audit` | — | | | ☐ |
| T6 | Déverrouillage support | Moov | `/admin/support` → déverrouiller (scope `otp:write`) | nouvelle demande de code acceptée ; audit `OTP_RESET` | — | | | ☐ |
| T7 | OTP vocal | MTN | canal VOICE | appel lisant le code chiffre par chiffre | •••• | | | ☐ |
| T8 | SOS — FR | MTN | patient FR, contact d'urgence = numéro Moov → SOS | SMS « URGENCE DigiSanté… » + lien carte, reçu par le **contact** | •••• | | | ☐ |
| T9 | SOS — FON | Moov | patient FON → SOS | SMS « DigiSanté ADANDÓ… » | •••• | | | ☐ |
| T10 | SOS — EN | MTN | patient EN → SOS | SMS « DigiSanté EMERGENCY… » | •••• | | | ☐ |
| T11 | Numéro public SOS | — | `SOS_PUBLIC_NUMBER` posé → SOS | SMS reçu par la destination **validée par le porteur** | •••• | | | ☐ |
| T12 | Repli numéro long | MTN + Moov | vérifier l'expéditeur affiché sur les 2 réseaux | numéro long affiché (pas d'ID alphanumérique rejeté) | — | | | ☐ |

Critère de sortie B4 Twilio : **T1, T2, T3, T4, T5, T8, T12 OK**. T9/T10 conditionnent
l'ouverture aux patients FON/EN ; T11 conditionne l'annonce du numéro d'urgence.

## 3. Rollback (immédiat, sans redéploiement)

1. `/admin/integrations` → carte **TWILIO** → **Désactiver** (`PATCH enabled=false`, audit
   `INTEGRATION_TOGGLE`). Les envois repassent **instantanément** en stub (cache invalidé).
2. En production, un stub **ne délivre aucun OTP** : les utilisateurs ne peuvent plus se
   connecter. Prévenir avant, et ne désactiver qu'en cas d'envoi erroné massif ou de coût anormal.
3. Rotation d'un `authToken` compromis : régénérer chez Twilio **puis** `PUT` du jeu complet
   (`accountSid`, `authToken`, `fromNumber`) — le `PUT` remplace toutes les clés.
