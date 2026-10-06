# Addendum à l'audit de septembre — X1/X2, lot L1

> 6 octobre 2026 (Africa/Lagos). Rapport daté `AUDIT_Securite_Release_2026-09.md` conservé ; cet addendum décrit la candidate L1, pas une contre-expertise externe.

| Finding historique | Traitement dans L1 | Preuves |
|---|---|---|
| X1 — échéance par entrée écrasée | ConsentRecord.expiresAt, guard commun strict, NULL fermé, transitions sérialisées ; réclamation B indépendante de A | dmp.entry-scope.test.ts : deux ordres de réclamation, expiration exacte, liste/export/fichiers, révocation/regrant et concurrence |
| X2 — auteur DMP absent | authorId/authorRole authentifiés serveur, héritage inconnu conservé, export conditionnel ; aucun droit de lecture par auteur | tests patient/doctor/spoofing client, suppression du compte, héritage et performer |

Migration 29→30 : DDL additive sans réécriture. L'échéance du QR courant et celle du parent historique ne démontrent pas le bail réclamé ; les anciens liens restent fermés. Aucun auteur déduit d'un propriétaire ou d'un simple accès à l'entrée. Statut de test/fusion/CI : `docs/suivi/LOT_L1.md`, revue : `docs/REVUE_L1_2026-10.md`.

X3 (laboratoire) reste L2. X4–X15 et les autres risques résiduels conservent leurs lots/arbitrages ; cet addendum ne déclare pas l'audit global terminé. Une autorisation vérifiée à la requête ne rappelle pas une réponse déjà reçue. La validation clinique, FHIR, native et opérateur reste indépendante.
