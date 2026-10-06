# Contrat de synchronisation — lot L3

> 6 octobre 2026. Contrat commun : `packages/shared/src/sync.ts`. Preuves et livraison : `suivi/LOT_L3.md`. Les corps locaux seront protégés au lot L4 ; ils restent en clair dans IndexedDB à ce stade.

## Routes couvertes

Les chemins ci-dessous sont relatifs à `/api/v1`. La liste est positive et tient compte de la méthode ; toute autre mutation exige le réseau.

| Méthode | Chemin canonique | Effet transactionnel |
|---|---|---|
| POST | `/chat/threads/:id/messages` | Message et date du fil |
| POST | `/chat/threads/:id/read` | Accusés des messages reçus |
| POST | `/notifications/:id/read` | Lecture de sa notification |
| POST | `/vaccinations/subjects` | Sujet et calendrier PEV |
| DELETE | `/vaccinations/subjects/:id` | Sujet et doses supprimés |
| POST | `/vaccinations/:id/administered` | État et date de la dose |
| POST | `/maternity` | Grossesse et calendrier CPN |
| POST | `/maternity/visits/:id/done` | État et date de la visite |

Argent, paiements, abonnements, SOS, OTP/session, consentements/partages DMP, rendez-vous, prescriptions, fichiers, KYC, actions professionnelles/administratives et mutations laboratoire sont exclus. Les routes `postNow` restent en ligne. `/maternity/end` est exclue : elle cible la grossesse active au moment de l'exécution, sans identifiant stable, et un ancien rejeu pourrait clore une grossesse ultérieure. Ouvrir un fil de chat reste en ligne, avec son unicité métier existante. GET et WebSocket ne sont pas des mutations de ce contrat.

## Identité avant le premier envoi

Le client doit connaître le compte courant. Il prend une photographie JSON du corps, génère un UUID v4 et construit `Idempotency-Key: v1.<epoch-ms sur 13 chiffres>.<UUID-v4>`. UUID normalisé en minuscules côté serveur. L'identité, le compte, le corps et la route sont committés dans IndexedDB **avant fetch**, même en ligne. Échec du stockage : aucun envoi. Toutes les reprises emploient exactement la même clé ; ne jamais renouveler la clé pour un essai dont l'issue est inconnue.

Portée serveur : `(userId, méthode, chemin canonique complet incluant l'identifiant, clé)`. Les clés JSON sont triées récursivement ; une empreinte HMAC-SHA256 compare le contenu reçu, y compris les champs supplémentaires. L'ordre des propriétés JSON ne change pas le contenu ; une valeur différente produit 409. Deux actions volontaires distinctes ont deux clés. Ni l'identifiant de ligne ni la seule similitude du corps ne prouvent une même action.

Compatibilité : les appels anciens **en ligne sans en-tête** gardent leur contrat métier et leurs contrôles mais n'obtiennent pas de reçu ni de garantie de déduplication. Aucun backfill ne peut reconstruire un premier envoi perdu. Les clients anciens et les workers sans L3 doivent être arrêtés/renouvelés lors de la bascule ; ne pas promettre la protection L3 pendant un déploiement mixte.

## Transaction et confidentialité

Le serveur verrouille la ligne User, relit statut/rôle et contrôle l'appartenance. Il consulte le reçu, recontrôle les droits puis compare l'empreinte avant de déchiffrer. Sans reçu, effet métier **et création du reçu** appartiennent à la même transaction PostgreSQL ; toute panne d'écriture du reçu annule l'effet, y compris les lignes enfant. Deux connexions/onglets avec la même identité obtiennent un seul effet et le même résultat, même après redémarrage.

Le reçu contient statut, empreinte, dates et un résultat AES-256-GCM, jamais le corps ou la réponse clinique en clair. Une clé d'usage dédiée dérive de `HEALTH_ENCRYPTION_KEY` ; seul le mode test admet un secret synthétique. L'empreinte HMAC évite de publier un hash direct de valeurs cliniques prévisibles. Identifiants de compte/route/ressource restent des métadonnées à protéger dans les accès/sauvegardes DB. Aucune route publique n'expose la table.

Les créations PEV/grossesse gardent un identifiant de ressource non clinique pour revalider son propriétaire avant lecture du reçu. Ressource supprimée ou transférée : 404 et revue manuelle. Les autres mutations contrôlent la cible du chemin. La suppression PEV rejouée renvoie seulement `{removed:true}` pour le compte du reçu, avec son profil/son rôle toujours autorisés. Suspension : 401 ; rôle non autorisé : 403. Un reçu n'est jamais un droit d'accès.

Un reçu renvoie la **photographie de l'action originale**, pas l'état courant. Si une dose a été annulée depuis, rejouer l'ancien marquage renvoie son résultat original sans réappliquer l'état ; relire le carnet pour connaître l'état actuel.

Le hint chat Redis est publié après commit, en best-effort, uniquement pour un nouveau message. Une panne de publication ne défait pas le message ; une reprise du reçu ne publie pas une seconde fois. La lecture REST retrouve l'effet durable. Aucune livraison WebSocket garantie, aucun SMS/push/paiement externe « exactement une fois » et aucun outbox fournisseur introduit par ce lot.

## Durées, erreurs et reprise

- Âge maximal d'une mutation : **7 jours** depuis le timestamp intégré à sa clé, contrôlé au premier envoi et au rejeu.
- Tolérance d'horloge future : **5 minutes**. Horloge de l'appareil à corriger ; ne pas reformer la clé d'une action potentiellement commise.
- Rétention serveur : **14 jours après commit**. Le timestamp de la clé permet encore de refuser l'action après purge du reçu.
- Purge quotidienne à 03:10 : `POST /api/v1/sync/receipts/prune`, en-tête `x-service-token` issu de `RECONCILE_TOKEN`, via `cron-job.sh`/`crontab.example`. Réponse : seul le nombre supprimé. Sans purge, la déduplication reste correcte mais la table croît ; superviser le cron et les volumes. Aucune purge manuelle anticipée ni suppression/recréation des reçus pour relancer une action.

| Résultat | Comportement client |
|---|---|
| 2xx original ou reçu | Retirer la mutation après réception |
| Réseau, 5xx, 408, 429 | Conserver la clé, arrêter la file et reprendre plus tard |
| 401 | Refresh au plus une fois ; si refus, arrêter sans archive ni perte, attendre réauthentification du même compte |
| 409 contenu différent | Archiver atomiquement corps/clé/statut pour revue ; aucun nouvel effet |
| 410 `MUTATION_EXPIRED` | Archiver pour revue ; aucun envoi client et aucun effet serveur |
| 400 `INVALID_MUTATION_KEY` / `MUTATION_CLOCK_INVALID` | Refus ; archive pour revue (horloge future détectée localement) |
| Autres 4xx | Archive définitive, continuer avec les entrées suivantes |

La file est ordonnée ; un flush unique par onglet évite les envois doublés locaux. Deux onglets partagent la même entrée IndexedDB et la même clé ; la transaction serveur arbitre leurs envois. L'ordre global entre deux onglets et deux actions **distinctes** n'est pas garanti par ce lot. Un changement de compte arrête chaque envoi et sa reprise après refresh ; aucune mutation de A ne part avec le jeton de B. Le propriétaire est posé immédiatement par AuthProvider ; reprise déclenchée après restauration de session et au retour du réseau.

IndexedDB v3 conserve les anciennes entrées. Sans identité démontrable ou pour une route désormais exclue : archivage 409, aucun nouveau UUID et aucun envoi automatique. Les entrées sans propriétaire attendent une revue manuelle et ne sont pas rattachées au compte courant. Les helpers `allFailed`/`removeFailed` existent pour diagnostic/revue ; il n'y a pas encore d'interface complète de reprise manuelle. Ne pas recréer automatiquement une action expirée/ambiguë : vérifier l'effet réel avant toute nouvelle saisie volontaire. Déconnexion explicite : purge locale existante ; expiration de session : conservation pour réauthentification. Chiffrement local, politique de purge/clé et UX de disponibilité/reprise restent L4.

## Vérifier et déployer

Relire `sync.test.ts`, `client.sync.test.ts` et `e2e/idempotent-sync.spec.ts`. Le test navigateur laisse Fastify committer via `route.fetch()` puis abandonne la réponse, recharge la page et observe la même clé ; il vérifie aussi deux onglets réels. Ces tests utilisent une pile synthétique, pas une validation sur appareil physique.

Sauvegarde → arrêt des anciens workers → migration `20261006164320_mutation_receipts` → Prisma generate/build → démarrage homogène → renouvellement du client/service worker → contrôle des huit routes et cron. Migration additive, table initialement vide ; aucun effet historique rejoué. Préférer une correction en avant ; revenir à un serveur ignorant les clés réouvre le risque de doublon. Ne jamais changer la clé santé sans procédure de rotation des données et reçus. Les contrats consentement et FedaPay restent séparés.
