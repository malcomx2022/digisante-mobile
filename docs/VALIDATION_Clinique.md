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

## Synthèse

| Contenu | Fichier source | État | Action attendue |
|---|---|---|---|
| Triage / orientation hors-ligne | `packages/shared/src/triage.ts` | ⏳ **À valider** | Relecture des motifs, questions et sévérités par un médecin / le programme PCIME national |
| Calendrier vaccinal PEV | `packages/shared/src/pev.ts` | ⏳ **À valider** | Confrontation au calendrier PEV officiel en vigueur au Bénin (âges, doses, vaccins) |
| Calendrier CPN (santé maternelle) | `packages/shared/src/maternity.ts` | ✅ **Validé** (porteur, aligné OMS 2016) | — (objectifs cliniques par contact intégrés) |
| Format matricule CNOM (KYC médecin) | `apps/api/src/lib/kyc.cnom.ts` | ⏳ **À confirmer** | Confirmer le format `BJ-XXX-#####` auprès de l'ONMB (pas d'API publique) |

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

## Processus de validation recommandé

1. Un professionnel de santé habilité relit le fichier concerné (`triage.ts` / `pev.ts`).
2. Corrections portées **dans le fichier partagé** (une PR par contenu, tests verts).
3. La validation est **tracée** dans l'en-tête du fichier (« validé le … par … ») et dans ce
   document (colonne « État » passée à ✅).
4. Tant qu'un contenu n'est pas validé, l'**avertissement d'en-tête reste** et l'écran conserve
   sa mention « ceci n'est pas un diagnostic / à confirmer par un soignant ».

*Dernière mise à jour : 11 juillet 2026.*
