# Plan de rejeu vers le GO/NO-GO préproduction — candidat `ace0c689` (22 octobre 2026)

Candidat déclaré au registre L10 : `ace0c689686204348e33c56e95cbc387d3b438b2`, préproduction `preprod.digisantemobile.app`, CI main 39687976461 (PR #214). Instantané des cas : `sourceSnapshotSha256 = d6bfcba2…a6d` (100 cas). Le gate ne transfère aucune preuve de `ec6b0dc` (archive `docs/preproduction/archive/L10-ec6b0dc-2026-10-21/`) : chaque cas se rejoue sur `ace0c689`.

**Ce document est un plan, pas une preuve.** Un cas reste ouvert tant qu'une exécution réelle sur `ace0c689` n'a pas été rapportée par l'opérateur, vérifiée, puis inscrite au registre avec le gate rejoué sur copie (0 refusée imputable aux ajouts). La maintenance préprod reste posée jusqu'au nouveau PV GO/NO-GO signé ; la production (`digisantemobile.app`, encore `ec6b0dc`) n'est pas concernée.

## 1. Chiffrage

| Catégorie | Cas | Nombre |
|---|---|---:|
| A. Déjà PASS sur `ace0c689` | I1, RESEND-R6 | 2 |
| B. Rejouable immédiatement par l'opérateur (PASS sur `ec6b0dc`, mode opératoire connu) | voir §2 | 47 |
| C. Rejouable après préparation d'un mode opératoire / de comptes | voir §3 | 28 |
| D. Dépend d'une décision du porteur | voir §4 | 10 |
| E. Structurellement ouvert sur ce candidat | voir §5 | 13 |
| **Total** | | **100** |

Plafond atteignable sur `ace0c689` : **≈ 85 PASS** (A + B + C + les cas D tranchés favorablement), plus TWILIO-T11 en N/A référencé. Les cas E restent ouverts : ils ne peuvent figurer au PV qu'avec une décision référencée du porteur (projets en §5), jamais comme PASS.

## 2. Catégorie B — rejouable immédiatement (47)

Ordre recommandé : infrastructure d'abord (le reste en dépend), puis FedaPay (S8 **avant** S1), puis SMS, push, e-mail, abonnements.

| Lot | Cas | Points d'attention sur `ace0c689` |
|---|---|---|
| B1 Infra | I3, I4, I5, I6, I7, I8, I9 | I3 : preuve = `deploy_history` `ec6b0dc → ace0c689 SUCCESS stage=complete` + migrations à jour. I6/I7 : observations horodatées **postérieures** au déploiement du 21/10 23:59 (+01:00) ; une observation antérieure appartient à `ec6b0dc`. I8 : nouvelle sauvegarde DB + fichiers + manifeste après déploiement, `backup:check` sur son manifeste. |
| B2 FedaPay sandbox | S8 → S1 → S2, S3, S4, S5, S6, S7, S9, S10 | C5 a changé les `callback_url` (retour consultation → `/patient/appointments`, recharge → `/diaspora/wallet`) : vérifier la page de retour en S1/S2. S10 : constat seulement ; une approbation tardive ignorée est à arbitrer (décision D-10 ci-dessous). |
| B3 Twilio | T1, T3, T4, T5, T6, T8, T9, T10 | Les scénarios T5/T6/T9 nomment Moov : sur `ec6b0dc` ils ont été prouvés avec MTN/contact. Consigner l'opérateur réellement utilisé ; si la recette exige Moov, ces cas basculent en E (comme T2). Remettre le patient en FR après T9/T10. |
| B4 Firebase Android + F9 | F1 à F8-ANDROID, F9 | F7 : dispatch applicatif vers le compte déconnecté, jamais un smoke direct vers un token brut. F9 : rebuild requis — **ne pas l'exécuter pendant la recette** sans GO de déploiement (nouveau build = nouveau candidat). À rejouer par la preuve de build du 21/10 ou à reporter. |
| B5 Resend | R1, R2, R3, R4, R5 | R5 : domaine non vérifié temporaire, remettre la configuration ensuite. |
| B6 Abonnements | A2, A4, A5, A7, A9, A10, A12, A14 | Le médecin de recette est PRO jusqu'au 2026-11-21T23:58:29Z (rejeu C2) : A5/A10 peuvent s'appuyer sur ce paiement **s'il est rapporté comme exécution du cas** ; sinon nouveau paiement sandbox. A14 : remboursement interne sur un paiement de recette. |

## 3. Catégorie C — mode opératoire à préparer (28)

| Cas | Préparation nécessaire |
|---|---|
| SUBSCRIPTION-A1 | Un médecin **FREE** actif et vérifié : second compte médecin de recette (KYC approuvé) ou attendre l'échéance du 21/11/2026. |
| SUBSCRIPTION-A3 | Comptes médecin non vérifié et suspendu de recette (synthétiques). |
| SUBSCRIPTION-A6 | Refus/annulation sandbox ; secret webhook invalide **temporaire** puis restauré ; configuration absente → à faire sur une plage déclarée (impacte les autres cas FedaPay). |
| SUBSCRIPTION-A13 | Abandon pendant attente puis confirmation tardive. Le paiement PROCESSING de la commande abandonnée le 21/10 23:56:16Z (rejeu C2) peut fournir ce cas s'il est confirmé tardivement : à surveiller au rapprochement, remboursement opérateur **manuel**. |
| SUBSCRIPTION-A16 | Mode avion navigateur, inspection IndexedDB/Cache Storage. |
| DAILY-D1 à D21 | Jamais PASS sur `ec6b0dc`. Deux appareils (patient + médecin) + un tiers ; RDV confirmé, médecin PRO vérifié. La session patient s'ouvre par OTP sur le terminal du porteur : **le code n'est jamais demandé ni contourné**. D19–D21 (B5) : proxy de latence et deux démarrages simultanés — mode opératoire à écrire avant exécution. D13 : suspension puis **réactivation administrative** du compte de recette. |
| FINANCE-F6, F7 | Phase 1 (UI, CSV, reçu non fiscal), sans geste réel. Téléphone + desktop, FR/EN. |

## 4. Catégorie D — décision du porteur requise (10)

Voir la liste unique §6 (décisions D-1 à D-12). Cas concernés : TWILIO-T7, TWILIO-T11, SUBSCRIPTION-A8, SUBSCRIPTION-A17, FINANCE-F1, F2, F3, F4, F5, F8.

## 5. Catégorie E — structurellement ouvert (13) et projets de décision

Ces projets sont des **brouillons à faire valider** ; aucun n'est acquis tant que le porteur ne l'a pas repris, daté et signé dans le PV.

| Cas | Cause | Projet de décision référencée |
|---|---|---|
| I2 | Hôte IONOS partagé (dérogation du 13/10/2026), cas « VPS distinct » non conforme | « Le porteur maintient la dérogation du 13/10/2026 pour la préproduction ; I2 reste non conforme et sera arbitré en L11 avant toute ouverture production. » |
| TWILIO-T2, TWILIO-T12 | Aucun numéro Moov de recette | « OTP Moov et affichage expéditeur sur Moov non prouvés ; pilote limité aux numéros MTN jusqu'à preuve, ou acquisition d'une SIM Moov de recette. » |
| FIREBASE-F1 à F8-IPHONE (8) | Aucun appareil Apple | « Push iOS non qualifié ; pilote annoncé Android uniquement pour les notifications, l'app restant utilisable sur iOS sans push. Recette iOS avant extension. » |
| SUBSCRIPTION-A11 | Expiration calendaire (aucune période échue disponible) | « Rejouable à l'échéance du 21/11/2026 ; couvert d'ici là par les tests automatisés L6. » |
| SUBSCRIPTION-A15 | Aucune donnée PRO héritée sans preuve | « Inventaire constaté vide en préproduction ; à refaire sur la base de production avant bascule. » |

## 6. Liste unique des décisions en attente du porteur

| # | Décision | Cas | Options |
|---|---|---|---|
| D-1 | Activer les Geo Permissions **voix Bénin** (erreur Twilio 21215) ou retirer l'OTP vocal du pilote | TWILIO-T7 | activer (coût, risque fraude) / retirer le canal VOICE du pilote |
| D-2 | Reconsigner TWILIO-T11 en **N/A** avec la même référence « Décision du porteur du 21/10/2026 : aucun numéro public SOS pour le pilote… » | TWILIO-T11 | confirmer / poser `SOS_PUBLIC_NUMBER` vers une destination validée (jamais un service réel d'urgence) |
| D-3 | Paiement d'abonnement par wallet médecin : le médecin n'a pas de wallet, seule la branche « insuffisant » est prouvable | SUBSCRIPTION-A8 | accepter la preuve partielle avec décision / créer un wallet de recette crédité en sandbox |
| D-4 | iOS impossible pour A17 (EN et Android faisables) | SUBSCRIPTION-A17 | même décision que la ligne iOS de §5 |
| D-5 | Ouvrir la **phase 2 Finances en LIVE** (plafond 10 000 XOF), **geste par geste**, chaque geste exigeant un feu vert séparé au moment de l'exécution | FINANCE-F1, F3, F4 | ouvrir / reporter (cas restent ouverts) |
| D-6 | Clôture de la ligne de remboursement externe **REQUESTED de 6 560 XOF** du 16/10 | FINANCE-F2 | exécuter le retour opérateur réel / annuler avec motif tracé |
| D-7 | Second administrateur finance pour F5 (réponse ambiguë, remplacement d'un opérateur suspendu) | FINANCE-F5 | créer un second compte finance de recette / consigner la limite |
| D-8 | **Politique de conservation** des données financières et d'audit (aucune durée codée avant validation) | FINANCE-F8 | à rédiger et valider par le porteur ; L11 |
| D-9 | Arbitrage I2 (hôte partagé) | I2 | cf. §5 |
| D-10 | Approbation FedaPay tardive après FAILED/CANCELLED (si S10 la constate) | FEDAPAY-S10 | accepter l'ignorance + rapprochement manuel / PR §5 dédiée |
| D-11 | Moov (T2, T12) et iOS (F*-IPHONE) | cf. §5 | cf. §5 |
| D-12 | F9 (rebuild) pendant la recette : nouveau build = nouveau candidat | FIREBASE-F9 | reporter au prochain candidat / accepter la preuve du build `ace0c689` |

Hors registre L10, mais bloquants pour un GO pilote patients réels : validation clinique L9 (dossier non signé — ni Claude ni l'opérateur ne signent), clés critiques `sos.*` FON/YOR, rendu posologie. Le PV GO/NO-GO les reprendra comme critères distincts.

## 7. Procédure d'inscription (inchangée)

1. L'opérateur rapporte un lot : `caseId` du registre (jamais les étiquettes I1/I2/C1–C7 du brief correctifs), heure d'exécution réelle, référence **opaque** (ni téléphone, ni e-mail, ni identifiant de compte, ni lien), captures hors dépôt.
2. Claude vérifie la cohérence (candidat, heure postérieure au déploiement, non future, résultat), inscrit le lot sur une copie, rejoue `pnpm preprod:gate --expected-sha ace0c689…` sur la copie : 0 refusée imputable.
3. Une PR par lot, fiche `docs/suivi/LOT_L10.md` et ce plan mis à jour, projet de PV complété.

## 8. Avancement

| Date | Lot | Cas inscrits | Ouverts restants |
|---|---|---|---:|
| 21/10/2026 | Déclaration candidat + I1, RESEND-R6 | 2 | 98 |
| 22/10/2026 | B1 partiel : I3 (I4–I9 en attente de compléments : readiness DB/Redis, renouvellement TLS/HSTS, journal WS sans jeton, permissions/clés hors VPS, générateurs et purge du 22/10, réconciliation du 22/10, copie hors VPS du trio du 22/10, absence de devCode) | 1 | 97 |
| 22/10/2026 | B1 : I4 (readiness, dry-run certbot, HSTS, WS 101, journal WS sans jeton) ; I5–I9 en attente de compléments | 1 | 96 |
