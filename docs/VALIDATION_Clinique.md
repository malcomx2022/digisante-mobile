# Contenus cliniques à faire valider — DigiSanté Mobile

> **Objet** : recenser tous les contenus à portée **clinique** embarqués dans l'application
> (calendriers, arbres de décision, seuils) qui reposent sur une **hypothèse d'implémentation**
> et doivent être **validés/signés par un professionnel de santé** (ou le programme national
> concerné) **avant tout usage clinique réel**.
>
> Ces contenus sont **volontairement isolés** dans `@digisante/shared` (logique pure, testée,
> sans I/O) pour qu'une relecture médicale porte sur un fichier unique et versionné, sans avoir
> à lire le reste du code.
>
> **Principe produit** : aucun de ces écrans n'est un **diagnostic**. Ce sont des aides à
> l'orientation / au suivi, avec un **biais conservateur** (en cas de doute → consulter). Les
> libellés à l'écran le rappellent.

---

## Dossier opposable à soumettre au professionnel de santé

Un **dossier DOCX prêt à signer** est généré à partir des sources (contenu extrait verbatim,
un bloc « Décision du relecteur » par section + page d'attestation/signature) :

```bash
export NODE_PATH=$(npm root -g)          # ou un dossier contenant la lib `docx`
pnpm --filter @digisante/shared build    # dist à jour (source de vérité importée)
node scripts/docs/generate-validation-dossier.js   # → docs/Dossier_Validation_Clinique.docx
python <skill docx>/scripts/office/validate.py docs/Dossier_Validation_Clinique.docx   # obligatoire (§7)
```

Le fichier livré : **`docs/Dossier_Validation_Clinique.docx`**. La **structure** (flux de triage,
calendrier PEV, phrasier) est importée de `@digisante/shared` (jamais re-saisie) ; seuls les
libellés cliniques lisibles sont transcrits des i18n FR/EN dans le script. Régénérer après toute
évolution d'un contenu clinique.

## Synthèse

| Contenu | Fichier source | État | Décision |
|---|---|---|---|
| Triage / orientation hors-ligne | `packages/shared/src/triage.ts` | ✅ **Validé** — porteur, 19/08/2026 | Motifs, questions et sévérités retenus en l'état |
| Calendrier vaccinal PEV | `packages/shared/src/pev.ts` | ✅ **Validé** — porteur, 19/08/2026 | Calendrier retenu en l'état |
| Calendrier CPN (santé maternelle) | `packages/shared/src/maternity.ts` | ✅ **Validé** — porteur, aligné OMS 2016 | Objectifs cliniques par contact intégrés |
| Format matricule CNOM (KYC médecin) | `apps/api/src/lib/kyc.cnom.ts` | ✅ **Confirmé** — porteur, 19/08/2026 | Format `BJ-XXX-#####` retenu (aucune API publique ONMB) |
| Phrasier médical (chat) | `packages/shared/src/phrasebook.ts` | ✅ **Validé** — porteur, 19/08/2026 | Phrases FR/EN retenues ; FON/YOR en repli FR |
| Clés i18n critiques `sos.*` (clôture d'alerte) | `apps/web/src/i18n/messages.ts` | ✅ **Repli FR accepté** — porteur, 19/08/2026 | 6 clés FON/YOR non renseignées : repli français assumé |

### Décision de validation du 19 août 2026

> **Qui valide** : **SEGLA E. Ulrich Gislain**, porteur du projet, en sa qualité de responsable de
> la mise en œuvre. **Ce n'est pas la signature d'un professionnel de santé habilité** : aucun
> médecin ni le programme PCIME national n'a contresigné à cette date. Le présent document
> l'énonce explicitement pour que tout contrôle ultérieur (APDP, bailleur, ordre professionnel)
> puisse apprécier la nature exacte de la validation.
>
> **Portée** : les contenus ci-dessus sont retenus **en l'état** pour la mise en service. Ils
> restent des **aides à l'orientation et au suivi, à biais conservateur — jamais des
> diagnostics** ; les libellés à l'écran le rappellent, et cette qualification n'est pas modifiée
> par la présente décision.
>
> **Recommandation maintenue** : faire contresigner le triage OMS/PCIME et le calendrier PEV par
> un professionnel de santé ou le programme national concerné dès qu'un interlocuteur est
> disponible, et confirmer le format de matricule auprès de l'ONMB. Le dossier opposable
> (`docs/Dossier_Validation_Clinique.docx`) reste généré et prêt à signer à cette fin. La présente
> décision **lève le blocage de mise en service**, elle ne remplace pas cette revue.
>
> **Traduction fɔ̀ngbè / yorùbá** : les 6 libellés critiques de clôture d'alerte SOS restent
> **non traduits**. Le repli français est accepté à titre transitoire. Un locuteur fɔ̀ngbè ou
> yorùbá verra donc du français sur cet écran. Les clés demeurent exportées dans
> `docs/i18n/todo.{fon,yor}.csv` pour relecture native — **jamais par traduction automatique**
> (§6).

> Rappel : `sos.*`, `labo.*`, `payments.*` relèvent d'une **double validation** i18n (§4/§6) —
> hors périmètre de ce document (contenu de messages, pas de logique clinique).

---

## 1. Triage / orientation hors-ligne — `triage.ts`

**Écran** : `/patient/triage`. **Nature** : auto-évaluation 100 % embarquée (aucun appel réseau),
destinée aux zones reculées à faible connectivité.

**Fondement revendiqué** : signes de danger **OMS / PCIME (IMCI)**, biais conservateur :
- un seul signe **ROUGE** → **URGENCE** (orientation SOS) ;
- sinon un signe **ORANGE** → **CONSULTER** rapidement (orientation annuaire) ;
- sinon → **SURVEILLANCE À DOMICILE** (+ « en cas de doute, consulter »).

**Motifs couverts** (priorisés sur la charge de morbidité au Bénin) :

| Motif (`id`) | Portée | i18n |
|---|---|---|
| `FEVER` | Fièvre / suspicion de paludisme | `triage.flow.FEVER` |
| `DIARRHEA` | Diarrhée / déshydratation de l'enfant | `triage.flow.DIARRHEA` |
| `BREATHING` | Détresse respiratoire | `triage.flow.BREATHING` |
| `PREGNANCY` | Signes de danger en grossesse | `triage.flow.PREGNANCY` |

**Garantie technique** (test `pev`/`triage`) : chaque motif comporte **≥ 1 question ROUGE** ;
`evaluateTriage(flow, answers)` est pur et couvert.

**À valider par un professionnel** :
1. La **liste des motifs** est-elle suffisante / prioritaire pour le contexte visé ?
2. Pour chaque motif : les **questions** correspondent-elles bien aux signes de danger PCIME,
   et la **sévérité** (ROUGE vs ORANGE) de chacune est-elle correcte ?
3. Le **seuil de décision** (un seul ROUGE → URGENCE) est-il acceptable cliniquement ?
4. Les **libellés patient** (formulation des questions, pictogrammes, audio) sont-ils
   compréhensibles par un public à faible littératie ?

**Traçabilité** : consigner la validation (nom, fonction, date) — un simple commit modifiant le
commentaire d'en-tête de `triage.ts` (« validé le … par … ») suffit à versionner l'accord.

---

## 2. Calendrier vaccinal PEV — `pev.ts`

**Écran** : carnet de vaccination patient (soi + enfants), génération des échéances depuis la
naissance, marquage des doses, rappels multilingues (cron `/vaccinations/reminders/generate`).

**Fondement revendiqué** : schéma PEV usuel (Programme Élargi de Vaccination), naissance → 15 mois.
Constante `PEV_SCHEDULE` (`code`, `vaccineKey`, `doseLabel`, `ageOffsetDays`).

**Contenu embarqué à confronter au calendrier officiel** :
- **Naissance** : BCG, VPO 0, HepB 0 ;
- **6 / 10 / 14 semaines** : Penta, VPO, Pneumo (PCV), Rota ;
- **14 semaines** : VPI ;
- **9 mois** : RR (rougeole-rubéole), fièvre jaune ;
- **15 mois** : RR 2.

**À valider par un professionnel / le PEV national** :
1. **Âges cibles** (`ageOffsetDays`) conformes au calendrier PEV en vigueur au Bénin ?
2. **Liste des antigènes** et **nombre de doses** exacts (ex. Rota 2 ou 3 doses ; VPI 1 ou 2) ?
3. **Libellés** de vaccins (`vaccine.<key>`) corrects et compréhensibles ?
4. Politique de **rattrapage** (le générateur cible les doses non faites dont l'échéance est
   ≤ aujourd'hui + 7 j, retards inclus) — acceptable ?

> ⚠️ Le fichier porte déjà l'avertissement en en-tête. Ne pas retirer l'avertissement avant
> validation formelle.

---

## 3. Calendrier CPN (santé maternelle) — `maternity.ts` ✅ VALIDÉ

**Écran** : `/patient/maternity` (suivi de grossesse + CPN).

**État** : **validé par le porteur**, aligné **OMS 2016** — conservé ici pour mémoire.
- Terme = LMP + 280 j (`TERM_DAYS`).
- **8 contacts** (`ANC_SCHEDULE`) : 1 au T1 (**≤ 12 SA**), 2 au T2 (**20 / 26 SA**),
  5 au T3 (**30 / 34 / 36 / 38 / 40 SA**).
- **Objectifs cliniques par contact** affichés à l'écran (`maternity.objective.1..8`).
- Note **présentation tardive** (`maternity.late_note`) : le soignant réadapte le calendrier.
- Signes de danger : réutilisation du motif `PREGNANCY` du triage (cf. §1 — celui-ci reste à valider).

Aucune action requise sur le calendrier lui-même. La seule dépendance encore à valider est le
motif de triage `PREGNANCY` (voir §1).

---

## 4. Format matricule CNOM (KYC médecin) — `kyc.cnom.ts`

**Non clinique mais réglementaire.** La vérification soignant repose **par conception** sur une
**heuristique de format** (`BJ-XXX-#####`) **+ revue manuelle des pièces** — il **n'existe aucune
API publique** de vérification de l'Ordre des médecins au Bénin (ONMB `ordremedecinsbenin.bj` =
espace membre authentifié, investigué juin 2026).

**À confirmer auprès de l'ONMB** : le format `BJ-XXX-#####` est une **hypothèse** ; le corriger si
le format réel diffère. ⚠️ Ne jamais référencer l'ancien domaine `.org` (compromis).

---

## 5. Phrasier médical (chat) — `phrasebook.ts`

**Écran** : messagerie patient↔médecin (`ChatRoom`), panneau **phrasier** 🗣. **Nature** :
aide à la communication quand patient et soignant ne partagent pas de langue. **100 % local**
(offline-first, §4 : aucun contenu de chat n'est envoyé à un service de traduction tiers) — ce
sont des **phrases figées** insérées dans la langue cible, **pas** de traduction automatique.

**Contenu** : ~28 phrases de **communication** (salutations, questions sur les symptômes,
consignes, posologie, suivi, urgence), FR + EN complets.

**À valider par un professionnel** :
1. Les phrases **cliniques** (consignes, posologie, urgence) sont-elles correctes et non
   ambiguës ? (Les phrases de pure courtoisie sont à faible risque.)
2. Les traductions **FON/YOR** doivent être fournies par des **locuteurs natifs** avant d'activer
   ces langues (aujourd'hui : repli FR, §6 — aucune MT publiée telle quelle).

> Le fichier est isolé dans `@digisante/shared` et couvert par un test pur (FR+EN présents,
> repli FON/YOR→FR). C'est de la **communication assistée**, jamais un diagnostic.

---

## Processus de validation recommandé

1. Un professionnel de santé habilité relit le fichier concerné (`triage.ts` / `pev.ts`).
2. Corrections portées **dans le fichier partagé** (une PR par contenu, tests verts).
3. La validation est **tracée** dans l'en-tête du fichier (« validé le … par … ») et dans ce
   document (colonne « État » passée à ✅).
4. Tant qu'un contenu n'est pas validé, l'**avertissement d'en-tête reste** et l'écran conserve
   sa mention « ceci n'est pas un diagnostic / à confirmer par un soignant ».

*Dernière mise à jour : 11 juillet 2026.*

## Suivi du contreseing (B2) — état au 22 septembre 2026 (prompt 17)

⛔ **Aucun retour signé** du professionnel ou du programme compétent n'a été remis : **aucune
modification** de `triage.ts`, `pev.ts`, `phrasebook.ts` ni `kyc.cnom.ts` ; aucun seuil ni contenu
médical n'a été ajouté, modifié ou supposé. La décision transitoire du porteur (19/08) reste la
seule trace — elle ne vaut pas contreseing.

**Contrôle de synchronisation du dossier** (22/09/2026) : `Dossier_Validation_Clinique.docx`
régénéré depuis `@digisante/shared` (`scripts/docs/generate-validation-dossier.js`) puis comparé
au dossier versionné du 01/09 : **317 paragraphes, contenu identique** — seules la date de version
et la date d'instantané diffèrent. ⇒ La version en circulation pour signature **correspond au code
actuel** ; ne pas la régénérer (la signature porte sur la version du **2026-09-01**).

**À réception du retour signé** (procédure du prompt 17) :

1. Déposer le document annoté/signé hors dépôt public si des données personnelles y figurent ;
   ne versionner que la **trace** (professionnel, qualité, date, version signée).
2. Produire d'abord un **diff fonctionnel** (demande signée → fichier → impact : orientation,
   échéance de dose, phrase affichée) et le faire confirmer ; **toute ambiguïté reste bloquée**
   et listée pour arbitrage clinique — rien n'est interprété.
3. Appliquer uniquement les corrections explicitement validées dans `packages/shared/src/*`
   + tests de non-régression aux **limites** (âge/semaines/seuils) et aux cas **ROUGE**.
4. `pnpm release:check`, puis régénérer le dossier (`NODE_PATH=<dossier contenant docx>
   node scripts/docs/generate-validation-dossier.js`) et le **valider structurellement**
   (workflow DOCX, CLAUDE.md §7) ; re-signature sur la version corrigée.

## Reprise L9 — 8 octobre 2026 : état actuel avant ouverture

La décision du porteur d’août reste historique ; elle **ne lève pas le gate clinique L9/L11 du plan actuel**. Le porteur indique que des retours validés existent et transmettra leurs références ultérieurement. Aucun document/version/signataire/habilitation/correction n’a été vérifié ici. Ne pas considérer l’existence annoncée comme un contreseing du code courant.

Nouveau dossier **non signé**, sans remplacement de la version historique en circulation : `docs/validation/L9/Dossier_Clinique_L9.docx`. Il utilise le dictionnaire actuel et les modules sources compilés fraîchement, inclut les huit contacts CPN/objectifs, le phrasier exact (27 phrases), les règles de posologie/allergies verbatim et les fichiers des parcours correspondants. Voir `CONTRAT_Validation_L9.md`, le README L9, le snapshot/manifest et le registre `evidence.json` encore vide. Validation OOXML/concordance textuelle seulement ; pas de rendu Word ni signature contrôlés.

Points à arbitrer dans le retour prescripteur : premier entier extrait des doses (fractions/quantités en mg), horaires déduits depuis le nombre de prises, durée sans unité supposée en jours et pictogrammes/audio dérivés. Le dossier **n’accepte pas** ces hypothèses ; aucune règle ni contenu médical modifié en l’absence de correction explicite. Relire aussi unités/bornes des auto-mesures et corpus d’articles réellement publiés en DB : le seed synthétique n’en est pas une preuve.

À réception : vérifier pièce privée, qualité/habilitation, version, portées et réserves ; présenter le diff clinique explicite pour confirmation selon le circuit ci-dessus, tester limites/urgences/rendu et faire contresigner la version corrigée. Aucune signature produite par l’assistant. `pnpm validation:gate` reste **non vert attendu** tant que corpus/langues/pièces ne sont pas intégrés ; son succès futur vérifiera une cohérence de métadonnées, jamais l’authenticité ou un GO automatique.
