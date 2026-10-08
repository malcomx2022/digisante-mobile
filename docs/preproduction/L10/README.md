# Dossier opérateur L10

Lire `../../CONTRAT_Preproduction_L10.md` et `../../SECRETS_Preproduction_L10.md`. Cible/accès à fournir ; aucun résultat réel rempli. Données et signatures privées restent hors dépôt public.

- `snapshot.json` : empreintes des scripts/configurations/recettes et cas exacts ; aucun secret lu. Pas de SHA Git auto-inséré : le SHA de fusion qualifié est déclaré au moment de l'exécution.
- `recette.csv` : copie **vierge régénérable** de tous les cas, colonnes de retour pour travail privé. Ne pas modifier cet artefact suivi pour conserver des preuves ; consigner les résultats dans une copie privée et le registre.
- `evidence.json` : registre déclaré, jamais écrasé par `preprod:prepare`. Ne renseigner que des références opaques non sensibles, pas de captures, téléphone, JWT, token FCM, clé, lien de salle ou donnée médicale. Contrôler chaque pièce privée humainement.

```bash
pnpm preprod:prepare
pnpm preprod:check
CANDIDATE_SHA=<SHA_MAIN_40HEX> pnpm preprod:qualify
pnpm preprod:gate --expected-sha <SHA_MAIN_40HEX>
```

Schéma du registre (gabarit, **ne constitue pas une preuve**, aucune valeur copiée dans le registre livré) :

```json
{
  "schemaVersion": 1,
  "candidate": {
    "sha": "<SHA_MAIN_40HEX>", "environment": "preproduction",
    "domain": "<domaine>", "dedicatedHostRef": "<reference-privee-hote>", "ciRunId": 0
  },
  "records": [{
    "caseId": "I1", "result": "PASS",
    "candidateSha": "<SHA_MAIN_40HEX>", "sourceSnapshotSha256": "<snapshot-courant>",
    "executedAt": "<ISO_UTC_YYYY-MM-DDTHH:mm:ss.sssZ>",
    "operator": "<identite-reelle-verifiee-privee>", "evidenceRef": "<reference-opaque-piece>"
  }]
}
```

Chaque cas exige un résultat PASS daté sur ce SHA/snapshot. F1–F8 Firebase ont deux identifiants ANDROID/IPHONE. T11 est conditionnel : N/A seulement avec `reason` et `scopeDecisionRef` de la décision du porteur. Aucun test vers un service public d'urgence réel. Autres cas absents ou FAIL = lot ouvert. Les gates portent sur la cohérence des déclarations ; qualification CI réelle, signatures/pièces, hébergement et observations doivent être vérifiés séparément. Aucun message aux tiers ni GO automatique.
