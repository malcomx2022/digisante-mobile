# Recette Daily.co — téléconsultation et mode dégradé (B4)

> **Prérequis humains** : compte Daily (free tier suffisant), `apiKey` + `domain` saisis dans
> `/admin/integrations` (carte **DAILY**), **deux appareils** (un patient, un médecin vérifié),
> dont au moins un Android d'entrée de gamme. Ne cocher B4 qu'après exécution **réelle**.

## 0. Ce que le dépôt garantit (vérifié le 22/09/2026)

| Point | Où | Preuve |
|---|---|---|
| Salle **privée** (jeton obligatoire) | `services/daily.ts` `createRoom` | `daily.test.ts` |
| Salle **expirant 4 h** après création, éjection à l'échéance | `roomProperties` | `daily.test.ts` |
| Jeton **expirant 2 h** (≤ salle), éjection à l'échéance ; un retour rappelle `join` | `tokenProperties` | `daily.test.ts` |
| Salle **supprimée à la clôture** (le lien meurt aussitôt) | `consultations.end` → `deleteRoom` | `daily.test.ts` |
| Mode dégradé **VIDEO → AUDIO → CHAT**, plancher CHAT, **restitué à la reconnexion** | `consultations.rules`, `downgrade`, `join` | `appointments.test.ts` |
| Consultation close : ni `join`, ni `downgrade`, ni **re-clôture** (notes préservées) | `consultations.service` | `appointments.test.ts` |
| apiKey jamais journalisée, jeton de salle jamais journalisé | `services/daily.ts` | `daily.test.ts` |

⚠️ **Corrigé ce jour** : avant, salles et jetons **n'expiraient jamais** (un jeton fuité ouvrait
la salle indéfiniment) et une consultation close pouvait être « re-clôturée » (écrasement des
notes). Les salles déjà créées avant ce correctif restent sans échéance : les supprimer depuis le
tableau de bord Daily si des tests ont eu lieu.

## 1. Smoke test serveur (opt-in)

```bash
SMOKE_DAILY=1 pnpm --filter @digisante/api test:smoke -- daily
```

Crée `smoke-<horodatage>`, vérifie `privacy=private`, `exp` ≤ 4 h, `eject_at_room_exp`, émet un
jeton, **supprime** la salle et constate le 404. Sortie publiable :
`[smoke:daily] salle smoke-… · privée=true · exp=… · jeton émis=oui`. Échoue explicitement en stub.

## 2. Matrice manuelle — patient / médecin sur deux appareils

| # | Scénario | Patient | Médecin | Résultat attendu | OK |
|---|---|---|---|---|---|
| D1 | Démarrage | reçoit la notification « Téléconsultation » (sa langue) | `/pro/agenda` → **Démarrer** | salle ouverte côté médecin | ☐ |
| D2 | Entrée patient | `/patient/appointments` → **Rejoindre** | — | les deux se voient et s'entendent | ☐ |
| D3 | Permission caméra **refusée** | refuser caméra | — | message clair ; audio possible ; bouton de bascule AUDIO | ☐ |
| D4 | Permission micro refusée | refuser micro | — | message clair ; bascule CHAT proposée | ☐ |
| D5 | Réseau faible → AUDIO | limiter à 2G/3G (réglage téléphone ou point d'accès) | — | bascule AUDIO ; la conversation continue | ☐ |
| D6 | AUDIO → CHAT | couper la donnée mobile 10 s puis rétablir | — | bascule CHAT ; messages déjà échangés **conservés** | ☐ |
| D7 | Reconnexion | recharger la page | — | revient en **CHAT** (pas de relance vidéo) | ☐ |
| D8 | Jeton expiré | laisser la salle ouverte > 2 h (ou recette dédiée) | — | éjection ; « Rejoindre » redonne l'accès tant que la consultation est active | ☐ |
| D9 | Clôture | — | `/pro/teleconsult` → **Terminer** | les deux sont éjectés ; « Rejoindre » disparaît ; RDV `COMPLETED` | ☐ |
| D10 | Lien réutilisé après clôture | rouvrir l'URL de salle copiée | — | **refus** (salle supprimée) | ☐ |
| D11 | Tiers | 3ᵉ appareil sans compte ouvre l'URL | — | **refus** (salle privée) | ☐ |

Consigner pour chaque ligne : date, appareils (modèle/OS/navigateur), réseau, résultat, sévérité
si échec. Critère de sortie B4 Daily : **D1, D2, D5, D6, D9, D10, D11 OK**.

## 3. Rollback

`/admin/integrations` → **DAILY** → **Désactiver** : les nouvelles consultations repassent en
stub (URL factice) — la téléconsultation vidéo est alors **indisponible** ; le chat reste le
canal de consultation. Rotation de clé : régénérer chez Daily puis `PUT` du jeu complet
(`apiKey`, `domain`).
