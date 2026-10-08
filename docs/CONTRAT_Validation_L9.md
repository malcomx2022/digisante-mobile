# Contrat L9 — langues natives et validation clinique

> 8 octobre 2026, Africa/Lagos. Branche `feat/l9-native-clinical-validation`, base main `4fc62c1a3a6487a8b42fa7c77a8770b01016fa78` après #188. L9 livre la préparation et les contrôles techniques ; les imports et contreseings restent ouverts.

Le porteur indique que des retours validés existent, mais précise qu’il communiquera leurs références ultérieurement. Aucune pièce/version/relecteur/signature n’a donc été vérifiée ou importée dans ce lot. La mention historique de validation par le porteur en août ne constitue pas une signature clinique habilitée ni un GO actuel.

## Instantané de référence

`pnpm validation:prepare` génère depuis les sources actuelles, sans réutiliser un dist :

- `docs/validation/L9/snapshot.json` : textes FR/EN actuels, calendriers, phrasier, empreintes et couverture.
- `messages.fon.csv` / `messages.yor.csv` : toutes les clés UI, texte natif courant séparé de la colonne de retour vierge. Présence ne signifie pas validation ; relire aussi les traductions existantes.
- `phrasebook.fon.csv` / `phrasebook.yor.csv` : 27 phrases et catégories, double relecture clinique/native obligatoire, aucun texte inventé.
- `manifest.json` : empreintes des cinq artefacts ci-dessus.

`node scripts/docs/generate-l9-dossier.cjs` produit le **nouveau dossier non signé** `docs/validation/L9/Dossier_Clinique_L9.docx`. Textes/questions/calendriers/CPN/phrases proviennent des sources et du dictionnaire, pas de tables transcrites dans le générateur. Le calendrier CPN est resoumis : la décision du porteur ne vaut pas contreseing. Posologie/allergies extraites verbatim et exemples synthétiques issus du parseur actuel, sans recommandation de dose ; inventaire de sources/pages et signature par portée. L’ancien `docs/Dossier_Validation_Clinique.docx` en circulation reste intact.

`pnpm validation:check` refuse un instantané périmé/altéré sans le réécrire. Le validateur DOCX vérifie ZIP/XML/relations/A4/tableaux/concordance textuelle ; il ne vérifie pas le rendu Word, une signature ou une habilitation. Cinq modules purs sont compilés en mémoire avec la dépendance TypeScript existante ; les règles de posologie sont transcrites verbatim et les autres fichiers recensés par empreinte ; aucun CSV ni retour humain n’est exécuté, aucun fournisseur n’est contacté.

## Réception des retours

Conserver pièces signées et données personnelles hors dépôt public. Consigner références privées non sensibles, langue, portée, version, noms/qualité et dates après vérification par le porteur. Ne pas recopier un lien temporaire contenant un jeton dans la traçabilité. Examiner le diff demandé et le faire confirmer si correction clinique ou ambiguïté ; ne pas interpréter une demande clinique.

Pour les clés UI, présenter d’abord l’essai à blanc :

```bash
node scripts/i18n/import-validated.mjs --locale fon --csv <retour.csv> \
  --reviewer '<nom vérifié>' --date AAAA-MM-JJ \
  --second-reviewer '<second nom distinct>' --second-date AAAA-MM-JJ \
  --evidence-ref '<référence privée vérifiée>' --dry-run
```

Puis supprimer `--dry-run` seulement après revue. Les six SOS et toutes clés `sos.*`/`labo.*`/`payments.*` demandent deux personnes distinctes. CSV sans doublons/colonnes incohérentes/quotes invalides, FR **et EN** actuels, variables/balises conservées, dates réelles non futures. `--overwrite` est explicite pour un remplacement validé ; `--require-all` refuse toute ligne rejetée avant écriture (utiliser un retour contenant seulement les lignes effectivement validées). Sans ce dernier drapeau, import partiel déclaré avec liste des rejets, jamais assimilé à une validation globale. Cases vides = repli FR, aucune traduction automatique publiée.

L’import trace CSV SHA256, source avant/après, références et clés exactes. Un verrou refuse deux imports simultanés ; les fichiers sont préparés avant publication, et une erreur de publication source restaure la trace. **Pas de transaction multi-fichier anti-crash** : si interruption système, inspecter source/trace/diff et retirer un verrou résiduel seulement après contrôle ; aucune relance aveugle. Métadonnées déclarées, pas authentification des relecteurs.

Le phrasier reste une PR dédiée dans `packages/shared/src/phrasebook.ts` après réception, double relecture et contreseing des phrases cliniques ; son CSV n’est pas accepté par l’importeur de clés UI. Vérifier FR/EN inchangés, aucune traduction de chat à un service tiers, repli et langue cible dans `phraseText`. Corrections de triage/PEV/CPN/posologie : uniquement diff explicitement approuvé, tests de limites/urgence/rendu, nouveau dossier et contreseing de la version corrigée.

## Registre et contrôle avant ouverture

`docs/validation/L9/evidence.json` est **vide** jusqu’à réception/vérification. `pnpm validation:gate` exige : parité FR/EN et FON/YOR annoncées, phrasier complet, deux relecteurs natifs par langue/portée, et contreseing clinique pour triage, PEV, CPN, phrasier, prescriptions/posologie, constantes et éducation. Chaque référence est liée au contenu via SHA256 ; doublon, rejet, date future, même relecteur ou empreinte périmée bloque. Éducation : inventaire des articles DB effectivement publiés à référencer séparément ; le seed synthétique ne prouve pas le corpus de production.

Le gate vérifie **la cohérence de preuves déclarées**, pas l’identité, l’ordre professionnel ou la signature privée. Un contrôle vert ne produit pas le GO : vérifier les pièces, les réserves et les habilitations, puis décision humaine L11. Le schéma et la procédure du registre sont dans `docs/validation/L9/README.md`. La CI contrôle les artefacts et l’outillage ; elle ne simule pas les retours et n’invoque pas un gate humain vide pour maquiller un succès.

## Mesure initiale et réserves

FR/EN : 1 098 clés, EN complet sans variables/balises invalides. FON/YOR : 866/1 098 (79 %), **232 manquantes dont 6 critiques** chacun ; aucune variable invalide mesurée. Phrasier : 27 phrases FR/EN, aucune FON/YOR. Un objectif historique « zéro critique manquante » ne suffit pas à fermer L9 : le plan actuel exige les langues annoncées et le contenu embarqué relu.

Posologie existante : `parsePosology` prend le premier entier (fractions/mg à qualifier), déduit des horaires par défaut depuis prises/jour et suppose des jours pour une durée sans unité. Ces hypothèses et le rendu/audio doivent être confrontés au texte prescrit ; le dossier ne les accepte pas. Aucune correction clinique ni acceptation de risque inventée. Toute réserve non résolue bloque l’ouverture ou exige retrait/révision du contenu concerné avant GO.
