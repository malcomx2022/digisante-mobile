# Contrat hors ligne — lot L4

> 7 octobre 2026 (Africa/Lagos). Complète le contrat L3 sans élargir ses huit mutations. Implémentation et auto-revue Codex suivant CLAUDE.md ; preuves et livraison dans `suivi/LOT_L4.md`.

## Protection et gestion de clé

Le coffre est **volontaire et propre au compte sur l’appareil**. Sans coffre ouvert, aucune lecture médicale persistante ni nouveau corps de mutation en clair. Une phrase locale longue et unique, distincte de la connexion, enveloppe une clé aléatoire AES-256-GCM : PBKDF2-SHA256, 600 000 itérations, sel aléatoire 16 octets ; IV aléatoire 12 octets par chiffrement. Phrase minimale 12 caractères, recommandation de phrase longue ; aucun mécanisme de récupération. La clé ouverte est non exportable et reste en mémoire. Ni clé serveur, ni JWT, ni refresh token n’entrent dans IndexedDB/localStorage.

L’AAD lie les ciphertexts au compte, au type de donnée et aux métadonnées pertinentes : id, dates, clé d’idempotence. Une modification ou relocalisation fait échouer le déchiffrement. Les métadonnées compte/id/date/clé/statut restent visibles ; elles ne contiennent aucun titre, médicament, corps, route clinique ou secret de partage.

| Événement | Politique |
|---|---|
| Recharge, fermeture, page masquée/quittée | Clé oubliée ; déverrouillage requis |
| Inactivité de 15 min | Verrouillage ; activité crypto renouvelle le délai |
| Lock/purge dans un autre onglet | BroadcastChannel verrouille les onglets ouverts |
| Changement A→B | Verrouille ; purge les lectures A, conserve les actions chiffrées A pour réauthentification ; B ne les lit ni ne les compte |
| Logout ou effacement explicite | Une transaction supprime tous les coffres/lectures/files, héritage compris, pour tous les comptes locaux |
| Échec de purge | Coffre verrouillé et session fermée ; avertissement visible, effacement navigateur requis avant prêt de l’appareil |
| Écriture en vol pendant lock/purge | Génération vérifiée à l’intérieur de la transaction ; pas de réintroduction après effacement |

Au démarrage, une panne réseau/serveur de refresh conserve seulement le contexte local sans jeton ni rejeu ; un refus 401/403 ferme la session. `navigator.onLine` est indicatif et ne prouve pas la disponibilité de l’API.

Le cache de session se réduit à id/rôle/statut/langue, y compris lors de la première lecture d’un ancien cache. Le cookie HttpOnly est inaccessible à JavaScript ; une XSS peut néanmoins agir au nom d’une session ouverte. Le coffre ne protège pas d’une XSS/session déjà déverrouillée, d’un navigateur compromis, d’une phrase faible soumise à une attaque hors ligne ou d’un attaquant contrôlant le stockage/l’horloge. Pas de révocation à distance sans réseau ni de preuve de validité clinique actuelle ; les limites sont affichées. Une copie de ciphertext peut survivre dans une sauvegarde du navigateur ; l’effacement logiciel n’est pas une preuve d’effacement physique.

## Disponibilité exacte

Synchronisation **explicite**, uniquement par un patient authentifié, depuis `/patient/offline`. Aucune persistance automatique de GET/API arbitraires. Les pages DMP/ordonnances/urgence classiques restent en ligne et proposent un lien vers le coffre hors réseau.

| Fonction | Disponible sans réseau |
|---|---|
| Résumé DMP | 20 entrées : id/titre/type/date ; pas de contenu complet ni pièce jointe |
| Ordonnances | 10 ×20 lignes maximum : médicament/posologie/fréquence/durée, statut et validité datés ; **sans QR**, sans délivrance |
| Fiche urgence | Groupe sanguin, allergies, maladies chroniques, contact urgence ; assurance/adresse exclues |
| Triage | Orientation locale après préparation du shell ; pas un diagnostic |
| Huit mutations L3 | Mise en file/reprise seulement sous le coffre ouvert ; identité originale conservée |
| Vidéo, paiements, fichiers, consentement/partage, SOS serveur | Réseau requis ; aucune action différée |
| Appel/SMS depuis le téléphone | Action explicite ; couverture téléphonique nécessaire, pas une garantie d’envoi automatique |

Les lectures expirent **24 h après synchronisation** ; avertissement après 6 h, date toujours affichée. À l’échéance, le corps est retiré et seules les dates subsistent pour informer. L’interface rafraîchit à ces échéances. Horodatage futur de plus de 5 min : lecture refusée. Ce délai est une règle applicative, pas une horloge inviolable. Un statut d’ordonnance annulée/expirée reste visible ; une copie datée n’autorise jamais une délivrance. Les numéros d’urgence existants demandent toujours la validation opérationnelle L9/L10 ; ce lot n’atteste pas leur disponibilité réelle.

Les réponses API portent `Cache-Control: no-store` et le client les demande avec `cache: no-store`, y compris reçus/fichiers/auth : aucune conservation automatique dans le cache HTTP navigateur/proxy. Ceci est distinct de CacheStorage. Les caches HTTP ou sauvegardes de versions antérieures ne sont pas effacés rétroactivement par cet en-tête ; vider aussi le cache navigateur avant partage d’un ancien appareil.

Le SW v3 ne conserve que les coquilles publiques `/`, `/patient/offline`, `/patient/triage`, le secours `offline.html`, les icônes/manifest et les assets `/_next/static`. Jamais API, RSC (`RSC`/`_rsc`), document médical, réponse de navigation authentifiée ou jeton. Une route non préparée revient au secours générique. Activation : seuls les anciens caches `digisante-*` sont retirés.

## Actions et résultat incertain

**Coffre ouvert** : le corps/méthode/route sont chiffrés avant le premier fetch, puis réutilisés avec la même identité L3. Lock ou changement de compte arrête la reprise. Pending→failed reste atomique et chiffré. L’écran montre le compteur du compte courant, la reprise et les rejets à vérifier ; aucune reconstitution/re-cléage automatique. Consulter les effets en ligne avant toute suppression volontaire ou nouvelle saisie.

**Sans coffre ouvert, en ligne** : le client photographie le corps en mémoire et persiste avant fetch un ticket minimal `{id, owner, ts, idempotencyKey, onlineOnly}`. Aucun corps, méthode ni chemin clinique stocké. Après une réponse perdue/recharge, la reprise fait uniquement `GET /api/v1/sync/receipts/:key` ; elle **ne renvoie pas la mutation**. Une réponse doit confirmer explicitement `{confirmed:true,status:200|201}` pour retirer le ticket. Auth, droits et propriété courants restent obligatoires ; un reçu absent/expiré/ambigu ou une ressource devenue inaccessible exige une revue manuelle. Ce GET n’écrit aucun effet métier et n’expose aucun contenu clinique. Portée méthode/route optionnelle pour compatibilité ; la clé seule doit désigner un reçu unique de ce compte.

Tout ticket du compte courant encore pending/failed bloque une nouvelle mutation couverte, faute de corps/route fiables pour distinguer une ressaisie. Une réponse 200 sans confirmation valide ne suffit pas. 401/408/429/5xx/réseau conservent la tentative ; les refus permanents l’archivent pour vérification. Rétention serveur 14 j inchangée ; mutations chiffrées limitées à 7 j. Au-delà, **pas de garantie de récupération d’une réponse absente** et pas de nouvel effet automatique.

## Reprise IndexedDB v3→v4

Mise à niveau additive : `mutations`/`failed` historiques conservés en quarantaine ; nouveaux magasins `vaults`, `pendingSealed`, `failedSealed`, `snapshots`. Pas de reset de base ni perte silencieuse. Après création/déverrouillage, les seules lignes du compte courant sont chiffrées puis déplacées dans une transaction. Corps, id, horodatage et clé demeurent identiques ; aucun UUID de remplacement ni attribution d’owner NULL. Une panne/lock laisse la ligne historique intacte. Une ancienne ligne sans clé peut migrer pour conservation mais reste refusée au rejeu L3.

**Les lignes historiques de comptes non déverrouillés ou sans propriétaire restent en clair.** Le chiffrement ne peut pas être fabriqué sans la phrase de ces comptes. Avertissement global de présence d’héritage sans révéler identité/contenu ; actions courantes à migrer signalées séparément. Avant prêt/pilote : migrer chaque compte, ou vérifier les effets réels puis effacer volontairement l’appareil ; les entrées sans propriétaire ont un effacement explicite distinct. La protection intégrale du stockage médical ne peut être attestée tant qu’un magasin historique reste non vide.

Ancien onglet bloquant l’upgrade : erreur explicite, demander de fermer les anciens onglets. Tous les clients doivent être renouvelés : un ancien client v3 ne doit pas réécrire des corps en clair. Browser non compatible WebCrypto : coffre indisponible, actions médicales en ligne/tickets minimaux seulement. Quota/stockage indisponible avant persistence : aucun premier envoi couvert. Les données locales ne constituent jamais la source de vérité serveur.

## Maintenance Claude Code

Réutiliser `offline/db.ts`, `vault.ts`, `snapshot.ts`, `queue.ts`, `VaultControls` et `SyncActions`. Ne pas créer un second coffre/clé par écran ; ne pas mettre les réponses dans CacheStorage, les logs ou les textes d’erreur. Respecter owner/génération après chaque attente et avant écriture/envoi. Toute extension de projection, TTL, routes ou garantie SOS exige contrat, tests de panne/droits et documentation actualisés. Aucun changement de dépendance, lockfile, migration serveur ou périmètre financier L4. Recette physique dans `RECETTE_7_Roles_PV.md`, revue dans `REVUE_L4_2026-10.md`.
