# Kit de relecture native : phrasier médical (27 phrases, FON / YOR)

Préparé le 15 novembre 2026 depuis `main` `b4ca6aa`. **Aucune traduction n'est fournie.** Les relecteurs écrivent
eux-mêmes les textes. La règle du projet (CLAUDE.md §6 et §8, « Barrière linguistique ») interdit de publier une
traduction automatique.

## État au 16 novembre 2026

Retours reçus : FON (réf. `PHR-FON-2026-11`, FON-R1 + FON-R2) et YOR (réf. `PHR-YOR-2026-11`, YOR-R1 + YOR-R2),
datés du 2026-11-15. Ils sont intégrés par la PR dédiée #257. Le 16/11/2026, sur décision du porteur, la campagne L9
`L9-2026-11-15` a été archivée et `L9-2026-11-16` ouverte sur cette version, qui contient le phrasier.

| Langue | Intégrées | Renvoyées aux relecteurs (repli FR) |
|---|---|---|
| FON | 26 / 27 | `pos.finish` : « azɔn » désigne-t-il le traitement ou la maladie ? |
| YOR | 25 / 27 | `pos.once_day` : « lọ́sàn-án » se lit « l'après-midi », pas « par jour ». `sym.vomit_diarrhea` : « ìgbẹ́ » désigne les selles, le vomissement n'y figure pas. |

À confirmer aussi, sans blocage : FON `greet.hello` contient le caractère « ‚ » (U+201A, guillemet bas) à la place
d'une virgule. Le texte est repris tel quel.

Les corrections reviendront sous une référence `-C1`. Kit de correction prêt : `correction-C1/`. Le contreseing clinique (portée `phrasebook`) reste attendu.

## À quoi sert le phrasier

Dans la messagerie patient↔médecin, le panneau 🗣 propose des phrases toutes faites : accueil, questions sur les
symptômes, consignes, posologie, suivi, urgence. Le soignant ou le patient choisit une phrase et une **langue
cible**, et la phrase est insérée dans le message. Tout reste sur l'appareil : aucune traduction n'est faite au
moment de l'envoi.

Aujourd'hui, les 27 phrases n'existent qu'en français et en anglais. Une personne qui choisit le Fɔ̀ngbè ou le
Yorùbá reçoit donc **le texte français**.

Source : `packages/shared/src/phrasebook.ts`. Ce sont des phrases de **communication**, pas un diagnostic.

## Fichiers

| Fichier | Pour qui |
|---|---|
| `phrasier.fon.csv` | Relecteurs Fɔ̀ngbè : remplir la colonne `fon` |
| `phrasier.yor.csv` | Relecteurs Yorùbá : remplir la colonne `yor` |

Colonnes :
- `key`, `critical`, `category` : à ne pas modifier ;
- `fr` : texte de référence, à ne pas modifier ;
- `en` : aide à la compréhension ;
- **colonne de la langue : à remplir** ;
- `contexte` : où et comment la phrase est utilisée.

Les 27 phrases se répartissent en 5 d'accueil, 8 sur les symptômes, 4 consignes, 5 de posologie, 3 de suivi et
2 d'urgence. Elles ne contiennent aucune variable.

Empreintes SHA-256 des modèles vierges :
- FON : `64c74f5a4ace535a3a934bc541eb0881e6312af1a29191da2379626f2510a45b`
- YOR : `43a609c91bb5eea5a465d783ffd30a30bc0bfe62de349f787ec52137453122ed`

## Consignes aux relecteurs

1. Traduire le **sens**, de façon courte et simple. La personne qui lit peut être âgée, peu à l'aise avec l'écrit
   ou inquiète.
2. **Consignes, posologie et urgence** (`ins.*`, `pos.*`, `em.*`) : le sens doit être exact. Pas d'ambiguïté sur
   le nombre de prises (« une / deux / trois fois par jour ») ni sur le moment (« **après** le repas »). La phrase
   ne doit jamais dire le contraire : une négation mal placée inverse une consigne.
3. Les phrases de posologie sont des **fragments** (« Une fois par jour. »), souvent envoyés après le nom du
   médicament. Elles doivent rester compréhensibles seules.
4. Dans `em.sos`, garder « **SOS** » tel quel : c'est le nom du bouton d'alerte de l'application.
5. `sym.pain_here` est dite **par le patient**, à la première personne. Les autres phrases de symptômes sont des
   questions du soignant.
6. Ne pas recopier le français.
7. Si une phrase n'a pas d'équivalent naturel, laisser la cellule **vide** et écrire une remarque à part. Rien
   n'est inventé.

## Validations requises

Le phrasier est un contenu clinique embarqué. Sa validation demande **deux niveaux**, enregistrés séparément dans
`docs/validation/L9/evidence.json` :

| Niveau | Qui | Portée L9 |
|---|---|---|
| Relecture native | Pour chaque langue, un premier relecteur remplit le fichier ; un **second relecteur, différent**, le relit et le confirme | `native`, `scope: phrasebook-native`, par langue |
| Contreseing clinique | Un professionnel de santé habilité vérifie les phrases cliniques (consignes, posologie, urgence) | `clinical`, `scope: phrasebook` |

Le porteur conserve les retours signés **hors dépôt**, sous une référence privée. Aucune donnée personnelle
n'entre dans le dépôt.

## Intégration (une fois les relectures faites)

Le phrasier **ne passe pas** par `scripts/i18n/import-validated.mjs` : cet outil ne traite que le dictionnaire
d'écran (`messages.ts`). L'intégration se fait par une **PR dédiée** qui ajoute les textes `FON` et `YOR` dans
`packages/shared/src/phrasebook.ts` (champ `text` de chaque phrase).

Cette PR doit :
1. reprendre les textes du retour **mot pour mot** ;
2. mettre à jour le commentaire d'en-tête du fichier avec la référence privée du retour, les codes des
   relecteurs et la date (aucun nom) ;
3. ajouter une ligne dans `docs/i18n/TRACABILITE_Relectures.md` : date, codes des relecteurs, nombre de
   phrases, empreinte du CSV reçu, référence, sans texte traduit ;
4. régénérer l'instantané L9, car `phrasebook.ts` en fait partie : `pnpm validation:prepare`, régénération et
   validation du dossier clinique L9, puis `pnpm validation:check` ;
5. lancer les tests de `@digisante/shared`, les tests web et les tests des scripts de validation.

Une phrase laissée vide reste en repli français. Le repli est voulu : il évite d'afficher un texte non relu.

## Limite connue

La lecture vocale du phrasier utilise la voix française (`fr-FR`) pour FON et YOR. Un texte natif lu par cette
voix n'est pas de l'audio Fɔ̀ngbè ou Yorùbá. Ce point est suivi par la réserve `RES-AUDIO` du dossier L9 et n'est
pas couvert par ce kit.

## Si le phrasier change

Ce kit correspond aux 27 phrases de `phrasebook.ts` au commit `b4ca6aa`. Si une phrase est ajoutée, retirée ou
modifiée en français ou en anglais, le kit est à régénérer avant d'être envoyé aux relecteurs.
