# Recette réelle — 7 rôles, appareils et opérateurs : protocole et procès-verbal

> **Préparé le 22/09/2026 (prompt 18)** · **État : ⛔ NON EXÉCUTÉE** — aucun environnement de
> recette (`<URL_RECETTE>`), aucun appareil physique ni opérateur n'est accessible depuis Claude
> Code. Aucune ligne n'est cochée ; aucun résultat n'est supposé. Claude Code **pilote** la recette
> (déroulé, collecte, rédaction du PV) mais **ne confirme jamais** une étape physique à la place
> de l'opérateur : chaque résultat est **déclaré par l'opérateur** et consigné tel quel.

## 0. Prérequis (bloquants)

| # | Prérequis | Référence | État |
|---|---|---|---|
| R0.1 | Environnement de recette HTTPS déployé (`verify_deploy.sh` tout PASS) | SUIVI_B3 | ☐ |
| R0.2 | Fournisseurs en **sandbox/recette** : Twilio, Daily, Firebase (build avec `NEXT_PUBLIC_FIREBASE_*`), Resend, FedaPay sandbox | SUIVI_B4 + `RECETTE_*.md` | ☐ |
| R0.3 | Patch §5 d'idempotence appliqué (sinon S7/P6 non concluants) | `RECETTE_FedaPay_Sandbox.md` §1 | ☑ appliqué le 22/09/2026 |
| R0.4 | Appareils : **Android** entrée de gamme (Chrome) + **iPhone** iOS ≥ 16.4 (Safari, PWA installée) | — | ☐ |
| R0.5 | SIM **MTN** et **Moov** de recette (`+22901…`) | — | ☐ |
| R0.6 | **Comptes synthétiques uniquement** (noms fictifs, aucune donnée de santé réelle) : 1 par rôle ; médecin **vérifié** via KYC par l'admin | — | ☐ |
| R0.7 | Réseau « faible » reproductible (profil 2G/3G du téléphone ou point d'accès bridé) | — | ☐ |

## 1. Déroulé — à exécuter dans cet ordre (réseau normal, puis faible sur les lignes ★)

Colonnes de preuve : **appareil** (A = Android, I = iPhone) · **opérateur** (MTN/Moov) ·
**preuve** non sensible (capture recadrée, ID masqué ••••1234, ligne d'audit) · **résultat**
(OK / KO) · **sévérité** si KO (P0 bloquant sécurité/santé/argent · P1 parcours cassé ·
P2 dégradé · P3 cosmétique) · **reproduction**.

| # | Rôle | Étape | Attendu | A/I | Réseau | Preuve | Résultat | Sév. |
|---|---|---|---|---|---|---|---|---|
| 1.1 | Patient | Inscription + OTP SMS (MTN) | SMS < 60 s, espace patient ouvert | | | | ☐ | |
| 1.2 | Patient | Idem Moov | idem | | | | ☐ | |
| 1.3 | Tous | Installation PWA (A : « Installer » ; I : Partager → Écran d'accueil) | icône, lancement plein écran, en-tête sous l'encoche OK (`.pt-safe`) | | | | ☐ | |
| 2.1 | Médecin | Inscription + KYC (pièces) | soumis ; audit `KYC_SUBMIT` | | | | ☐ | |
| 2.2 | Admin | Revue KYC → approbation | médecin visible dans l'annuaire ; `KYC_APPROVE` | | | | ☐ | |
| 3.1 | Patient | DMP : ajouter une entrée + **pièce jointe** | téléchargement identique | | | | ☐ | |
| 3.2 | Patient → Médecin | Partage d'**une** entrée (QR/jeton) → médecin lit | le médecin ne voit **que** l'entrée partagée (portée par-entrée §4) | | | | ☐ | |
| 3.3 | Patient | Révoquer ; médecin réessaie l'ancien jeton | refus + audit `DMP_DENIED` | | | | ☐ | |
| 4.1 | Patient | RDV téléconsultation → médecin confirme | notification RDV | | | | ☐ | |
| 4.2 | Patient | Paiement Mobile Money **sandbox** | redirection FedaPay → COMPLETED **par webhook**, crédit unique | | | | ☐ | |
| 5.1 ★ | Médecin + Patient | Daily : démarrer / rejoindre (2 appareils) | vidéo + audio bidirectionnels | | | | ☐ | |
| 5.2 ★ | Patient | Réseau faible → AUDIO → CHAT | bascule sans perte de conversation ; reconnexion en CHAT | | | | ☐ | |
| 5.3 | Médecin | Clôture | salle fermée ; lien réutilisé refusé | | | | ☐ | |
| 6.1 | Médecin | Ordonnance → QR | QR affiché côté patient | | | | ☐ | |
| 6.2 | Pharmacie | Scan **caméra Android** (`BarcodeDetector`) | ordonnance chargée | A | | | ☐ | |
| 6.3 | Pharmacie | Scan **iPhone** (repli **jsQR**) | idem | I | | | ☐ | |
| 6.4 | Pharmacie | Délivrance partielle par ligne | journal de dispensation (ses délivrances seulement) | | | | ☐ | |
| 7.1 | Médecin | Demande d'examen labo | pool anonymisé côté labo | | | | ☐ | |
| 7.2 | Laboratoire | Prise en charge → résultat | notification patient | | | | ☐ | |
| 7.3 | Médecin | Interprétation | visible patient ; réservé au prescripteur | | | | ☐ | |
| 8.1 | Diaspora | Recharge wallet (carte **sandbox**) | crédit unique après webhook | | | | ☐ | |
| 8.2 | Diaspora | Ajouter un proche (numéro inscrit) → envoyer | confirmation nom + montant ; proche crédité ; **aucun accès médical** | | | | ☐ | |
| 9.1 | ASC | Roster → observation → signalement à un médecin vérifié | notification médecin ; **aucun accès DMP** | | | | ☐ | |
| 10.1 ★ | Patient FR | SOS (géoloc) | SMS au contact d'urgence (FR), alerte en cours | | | | ☐ | |
| 10.2 | Patient FON | SOS | SMS FON ; écran : **6 clés `sos.*` encore en FR** tant que B1 n'est pas intégré — à noter, pas à masquer | | | | ☐ | |
| 10.3 | Patient | « Je vais bien » / « Fausse alerte » | statut clôturé ; audit `SOS_RESOLVED` | | | | ☐ | |
| 11.1 | Patient | Push : notification RDV/labo app **fermée** | reçue ; clic ouvre l'app | | | | ☐ | |
| 12.1 ★ | Patient | **Hors-ligne** (mode avion) : triage, ordonnance, fiche d'urgence | fonctionnent ; bandeau hors-ligne | | | | ☐ | |
| 12.2 ★ | Patient | Hors-ligne : saisir auto-mesure + marquer une prise, puis réseau | **rejeu de la file** dans l'ordre, sans doublon | | | | ☐ | |
| 13.1 | Admin | Utilisateurs, audit, finance, ops, campagne (FR + FON) | aucune donnée médicale visible (§4) | | | | ☐ | |
| 13.2 | Admin | Suspendre un compte | refus au prochain refresh (≤ 15 min) | | | | ☐ | |

## 2. Règles de conduite

- **Une seule personne réelle par appareil**, comptes synthétiques ; purger l'environnement de
  recette après la campagne (même procédure que `verify_restore.sh --cleanup` pour la base).
- Tout KO **P0/P1** ⇒ une **correction séparée** (branche + PR + test de non-régression), puis
  **rejouer la ligne** concernée et consigner le nouveau résultat avant la clôture du PV.
- Jamais de numéro complet, de code OTP, de jeton ni de contenu médical dans ce PV.

## 3. Procès-verbal (à remplir à l'issue)

| Champ | Valeur |
|---|---|
| Période de recette | |
| Environnement (URL, version = SHA déployé) | |
| Opérateurs (initiales + rôle) | |
| Appareils (modèle / OS / navigateur) | |
| Lignes OK / KO / non jouées | / / |
| KO P0 / P1 ouverts à la clôture | (doit être **0 / 0** pour un GO) |
| Corrections livrées (PR) et lignes rejouées | |
| Décision | GO pilote / NO-GO |
| Signatures (porteur + opérateur) | |


## 4. Addendum L1 — DMP (6 octobre 2026), à exécuter en recette

Le PV historique reste non exécuté. Les preuves automatisées API sont dans LOT_L1 et ne cochent pas les cases physiques ci-dessous. Utiliser des comptes et pièces synthétiques sur la version L1 déployée, sans jeton ni contenu médical dans les captures.

| Cas | Attendu | Preuve opérateur | Résultat |
|---|---|---|---|
| DMP-L1.1 Deux entrées, partages 1 h et 72 h, réclamer court puis long | À l’échéance du court, seule la longue reste lisible/exportable | | ☐ |
| DMP-L1.2 Ordre inverse | La réclamation courte ne raccourcit pas la longue | | ☐ |
| DMP-L1.3 Fichiers et ajout de pièces | Même portée/expiration que l’entrée, accès authentifié | | ☐ |
| DMP-L1.4 Révoquer une entrée puis ré-octroyer le médecin | L’entrée retirée ne ressuscite pas, autres entrées selon leur bail | | ☐ |
| DMP-L1.5 Révoquer le médecin, présenter ancien/nouveau QR | Refus jusqu’au ré-octroi explicite | | ☐ |
| DMP-L1.6 Données avant migration | Sans nouveau partage : refus ; auteurs anciens NULL, pas d’auteur inventé | | ☐ |
| DMP-L1.7 Auteur patient/médecin et auteur fourni par client | Identité serveur dans les réponses API, champ client ignoré ; export performer connu seulement | | ☐ |
| DMP-L1.8 Admin/ASC/diaspora/pharmacie/labo/non-vérifié | Refus même avec QR, aucun contenu clinique | | ☐ |
| DMP-L1.9 Retrait KYC, changement de rôle, suspension | Accès refusé ; suspension → 401 à la prochaine requête | | ☐ |
| DMP-L1.10 Revocation/claim concurrents | Après les réponses, aucune réintroduction d’accès retiré | | ☐ |

La saisie d’une entrée par un médecin ne lui octroie pas un accès implicite : le propriétaire la partage. L’export enrichi ne constitue pas une validation FHIR clinique complète.
