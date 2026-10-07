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


## 5. Addendum L2 — Laboratoires (6 octobre 2026), à exécuter en recette

Les tests API/navigateur dans LOT_L2 ne cochent aucune ligne du PV. Utiliser des structures, comptes et pièces synthétiques ; ne pas publier identité patient, résultats, pièces légales ou jetons dans le PV.

| Cas | Attendu | Preuve opérateur | Résultat |
|---|---|---|---|
| LAB-L2.1 Compte historique ACTIVE/APPROVED avant migration | Aucune habilitation automatique, dossier L2 complet requis | | ☐ |
| LAB-L2.2 Structure incomplète ou autorisation absente | Soumission refusée, pas d'accès au pool/identités/résultats | | ☐ |
| LAB-L2.3 Pièces présentes mais non vérifiées | Approbation refusée serveur et désactivée côté admin | | ☐ |
| LAB-L2.4 Identité/pièces en revue et dossier approuvé | Modification refusée ; identité figée visible à l'admin sans contenu clinique | | ☐ |
| LAB-L2.5 Renvoi/correction puis resoumission | Anciennes coches effacées, nouvelle vérification requise ; rejet ouvre un nouveau dossier vide | | ☐ |
| LAB-L2.6 Deux laboratoires réclament une même demande | Un gagnant ; attribution stable, aucune identité dans la file du perdant | | ☐ |
| LAB-L2.7 Prescription ciblée | Pool du destinataire sans identité avant claim ; autre labo refusé | | ☐ |
| LAB-L2.8 Deux publications et panne de notification DB | Un seul résultat/notification ; panne annule transition/résultat puis reprise possible | | ☐ |
| LAB-L2.9 Suspension puis réactivation administrative | Commandes/résultats conservés, accès labo fermé, lecture patient/médecin conservée ; KYC ne lève pas la suspension | | ☐ |
| LAB-L2.10 Laboratoire approuvé complet, smartphone/desktop | Structure → pièces → admin → claim → traitement → résultat → lecture/interprétation ; langues et erreurs lisibles | | ☐ |

Aucune remise automatique au pool ou transfert des demandes d'une structure suspendue. Confirmer les autorisations d'exercice réelles et le circuit opérateur pour une interruption durable avant ouverture du pilote.

## 6. Addendum L3 — Rejeu sans doublon, à exécuter en recette

Préparer une candidate homogène après migration, comptes synthétiques, appareil partagé et deux onglets. Contrat : `CONTRAT_Synchronisation_L3.md`. Tests automatiques et émulation Pixel 5 ne remplacent pas ces preuves physiques ; cases laissées non cochées.

- [ ] PEV : couper la réponse après confirmation du commit serveur, recharger puis reprendre ; même clé et un seul sujet/calendrier. Répéter avec un message chat et une CPN, vérifier les dates stables.
- [ ] Deux onglets d'un compte reprennent la même entrée : une seule écriture ; une action volontaire différente conserve sa propre clé.
- [ ] Redémarrer l'API après commit avant réponse : reçu durable retrouvé ; aucune dépendance au cache Redis.
- [ ] Modifier le corps sous une même clé : 409 et archive pour revue ; ne pas créer une clé de remplacement sans vérifier l'effet réel.
- [ ] Révoquer/suspendre la session : 401 arrête la file ; reconnecter le même compte pour reprendre. Changer vers B pendant refresh : aucune mutation de A envoyée sous B.
- [ ] Ancienne file sans clé, route exclue et horloge future : conservation pour revue sans envoi. Entrée >7 j : 410 ; après purge des reçus expirés, elle reste refusée.
- [ ] Paiement/SOS/OTP/consentement/partage DMP et fermeture de grossesse : hors ligne refusé avant la file.
- [ ] Vérifier les métadonnées et le contenu opaque des reçus, la purge interne authentifiée et sa fraîcheur ; ne pas imprimer les réponses cliniques dans les journaux.

Consigner appareil/version, SHA candidate, heures/conditions réseau, identités synthétiques et résultats observés. Protection du stockage local, interface de revue et disponibilité hors réseau complétées par L4 ci-dessous ; ne pas attester ces fonctions à partir du seul test L3.

## 7. Addendum L4 — Coffre et appareil partagé, à exécuter

Contrat : `CONTRAT_Hors_Ligne_L4.md`. Répéter sur Android installé et iOS/Safari/PWA réels, compte synthétique A/B et ancien appareil v3 ; ces cases ne sont pas attestées par l’émulation Pixel 5.

- [ ] Sans coffre : réseau coupé, mutation couverte refusée avant stockage/envoi ; réseau actif, réponse perdue après commit, ticket minimal puis GET seul, aucun deuxième effet. Reçu absent/ambigu : revue obligatoire avant nouvelle saisie.
- [ ] Créer une phrase longue, sync explicite, couper réseau et recharger : aucune donnée avant phrase ; mauvaise phrase refusée, bonne phrase restitue uniquement projection/date, pas QR/pièce/DMP complet/assurance.
- [ ] Lock manuel, masquage/fermeture/reload et 15 min : disparition des lectures ; verrouillage propagé aux autres onglets.
- [ ] Six heures : copie ancienne visible avec avertissement ; à 24 h/futur >5 min : contenu inaccessible, reconnecter. Ordonnance annulée/expirée signalée, jamais autorisation de délivrance.
- [ ] A→B puis A : B ne lit/compte rien de A, lectures A purgées, file chiffrée A récupérable uniquement après réauthentification/phrase A. Logout efface tous les comptes locaux.
- [ ] Migration v3 avec corps/clé, absence de clé et owner NULL : identité conservée, aucune attribution/re-cléage ; quota/lock pendant migration laisse l’ancien intact. Chaque compte migré ou effacement explicite après vérification des effets ; magasins historiques vides avant partage de l’appareil.
- [ ] Purge pendant sync/création/file : rien réintroduit après effacement. Échec stockage/purge affiché ; données navigateur effacées avant prêt si confirmation impossible.
- [ ] CacheStorage sans API/RSC/fichier médical/jeton ; shell/chunks seulement. API/fetch no-store vérifiés via le proxy ; anciens caches HTTP navigateur vidés avant partage. Route non préparée présente le secours générique ; triage local, vidéo/paiement/SOS serveur exigent réseau, appel/SMS exigent couverture.
- [ ] Rejet de file : revue des effets en ligne et suppression volontaire après confirmation ; pas de ressaisie automatique. Phrase oubliée : aucune récupération promise.
- [ ] Connectivité annoncée mais API inaccessible : contexte local conservé sans jeton/rejeu ; session réellement révoquée : fermeture. Phrases françaises de fallback FON/YOR et numéros d’urgence soumis à validation L9/L10.

Consigner SHA, appareil/OS/navigateur, compte synthétique, heure et preuves de cache/DB **sans corps/secret en capture publique**. Auto-revue et tests locaux ne valent pas signature clinique ni GO pilote.

## Addendum L5 — patient et médecin, téléconsultation privée

Candidate/revue : `suivi/LOT_L5.md`, `REVUE_L5_2026-10.md`. Contrats SDK/fournisseur simulés et parcours UI/API/DB sans identifiants ne remplacent pas la recette physique/fournisseur. Compléter les cases D1–D18 de `RECETTE_Daily_Teleconsultation.md` : deux appareils Android/iOS, accès nominatif, URL seule et bearer expiré refusés, caméra coupée en AUDIO, micro/caméra libérés en CHAT/sortie, suspension/KYC/annulation/clôture, en-têtes après proxy. Aucune case fournisseur n'est cochée automatiquement par ce lot ; GO/NO-GO L11 reste requis.

## Addendum L6 — offre médecin du pilote

Reprendre A1–A17 de `RECETTE_Abonnements_L6.md` : FREE/PRO 5 000 XOF/mois approuvés, démarrage PRO uniquement, soins ouverts conservés, paiement/renouvellement/expiration/arrêt, refus et reprise, abandon réglé tardivement, restitution wallet/intervention opérateur. Tests locaux et CI ne valent ni recette fournisseur ni signature humaine ; consulter LOT_L6/REVUE_L6. Autres abonnements après pilote, revenus L7 restant.
