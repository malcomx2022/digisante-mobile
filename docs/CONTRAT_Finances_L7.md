# L7 — revenus et opérations financières du pilote

> 7 octobre 2026, Africa/Lagos. Codex, conventions Claude Code. Base main `91a0fc9b86c27563438fd552b6fc08f9c9773d84` après PR #186, fusion constatée à 14:51:11 Africa/Lagos. CI main [37631822824](https://github.com/malcomx2022/digisante-mobile/actions/runs/37631822824) verte sur ce SHA. Aucune mise en production attestée.

## Décisions et définitions

Le porteur a approuvé **CSV comptable et reçu explicitement non fiscal**, le 7 octobre. Aucune facture fiscale, numérotation fiscale, TVA ou conformité fiscale inventée. Abonnements médecin seuls au pilote ; autres abonnements après pilote. Statistiques/export réservés au médecin actif, vérifié et PRO payé en cours selon le garde L6 ; l'argent déjà dû peut être reversé par la finance même après expiration PRO.

La commission reste le calcul existant `computeCommission` : **arrondi de 3 % du montant réellement payé**, net = montant − commission. Ce snapshot est créé à la confirmation, jamais recalculé depuis le tarif courant. Une restitution totale contre-passe les mêmes trois montants. Pas de remboursement partiel dans ce lot. Les frais opérateur, retenues fiscales et recettes d'abonnement ne sont pas des commissions/revenus du médecin.

| Indicateur | Définition |
|---|---|
| Montants confirmés | Somme CAPTURE des consultations confirmées dans la période, même si remboursées ensuite |
| Remboursements internes | Somme REFUND enregistrée dans la période ; ne prouve pas le retour opérateur |
| Commission nette | Commissions CAPTURE moins commissions REFUND de cette période |
| Net acquis | Montants confirmés − remboursements internes − commission nette ; peut être négatif |
| Reversements exécutés | Somme PAYOUT EXECUTED par date de clôture avec référence de preuve ; déclaration finance, sans vérification automatique bancaire |
| Créance totale | Net de tout le journal moins reversements EXECUTED ; négatif = trop-perçu à rapprocher |
| Net réservé | Somme PAYOUT REQUESTED/EXECUTING ; aucun argent transféré par ces états |
| Net disponible | Créance totale moins réservations ; distinct des sommes éligibles au reversement |
| Activité | RDV du médecin planifiés dans la période, états courants ; taux annulés / tous les RDV de cette cohorte |
| Satisfaction | Nombre et moyenne actuelle des notes d'avis créés dans la période ; une modification ultérieure peut changer cette moyenne, aucun commentaire/patient exporté |

Les jours sont inclusifs en **Africa/Lagos**, convertis en `[début 00:00 UTC+1, lendemain de fin 00:00 UTC+1[`. Dates réelles YYYY-MM-DD, maximum 366 jours, sans cible médecin fournie par le client. L'horodatage de CAPTURE est la confirmation locale, pas la réservation/création ni l'heure annoncée par le fournisseur. Un remboursement tardif apparaît dans sa propre période. Les écritures positives du CSV se lisent avec `event` : REFUND est une contre-écriture, pas une nouvelle recette. Le CSV annonce les horodatages UTC.

## Implémentation technique

Migration additive **34 `20261007161634_l7_finance_ledger`**, trois modèles : `FinanceEntry`, `FinanceOperation`, `FinanceOperationItem`. Aucune reprise automatique des anciens paiements. Contraintes de montant/devise/type/état, références uniques, triggers UPDATE/DELETE/TRUNCATE interdisant la mutation du journal. `FinanceEntry` conserve seulement référence paiement, identifiant médecin, nature, montants, devise et date. Aucun patient, note, ordonnance, DMP, motif clinique ou URL.

Confirmation wallet/webhook/réconciliation : CAS financier existant conservé, puis CAPTURE consultation et audit **dans la même transaction**. Les autres types de paiement, dont abonnements, recharges, pharmacie/laboratoire et transferts wallet, ne créent pas de revenu médecin. Échec ledger/audit annule statut, wallet et effets associés. Le remboursement conserve CAS COMPLETED→REFUNDED, sens REFUND/REFUND_IN et révocation abonnement L6, puis contre-écriture, éventuelle demande opérateur et audits atomiques. HMAC, map fournisseur, retry/réconciliation et calcul commission ne changent pas.

Le verrou PostgreSQL transactionnel finance `4021958` précède les verrous paiement/doctor/wallet des remboursements et sérialise les allocations/états manuels entre workers. Chaque paiement ne peut être réservé/reversé au-delà de son net. Somme des allocations = montant opération ; annulation REQUESTED libère les allocations. Le remboursement d'un paiement réservé REQUESTED/EXECUTING est refusé (409) avant effet. Après EXECUTED, il produit la contre-écriture et une éventuelle dette globale. La demande suivante est plafonnée par le disponible total et peut allouer partiellement certains paiements sans effacer leur reliquat. Le montant exact apparaît sur l'opération créée, à vérifier avant l'exécution externe. Aucune collecte de dette ou retenue bancaire automatique.

Les agrégats/éligibilité lisent un snapshot transactionnel. Le CSV charge au plus 10 001 écritures en une requête et refuse au-delà de 10 000, sans troncature ; audit export avec compteur seulement, transaction READ COMMITTED compatible avec le verrou d'audit. Cellules échappées et préfixes tableur neutralisés. Pas de cache ni file offline financière ; téléchargements volontaires restent sur l'appareil et doivent être protégés/supprimés par leur détenteur.

## API et UI

| API | Droit / réponse minimisée |
|---|---|
| GET `/professionals/me/revenue?from=&to=` | Médecin actif/vérifié/PRO courant ; statistiques propres |
| GET `/professionals/me/revenue/export?from=&to=` | Même garde, JSON `{filename,content,fiscal:false}`, CSV sans DMP |
| GET `/payments/:id/receipt` | Payeur authentifié uniquement, 404 autre propriétaire ; COMPLETED/REFUNDED, non fiscal, montant/statut/dates prouvées seulement |
| GET `/admin/finance/operations` | finance:read, journal paginé |
| GET `/admin/finance/eligible?doctorId=&page=&pageSize=` | finance:read, net résiduel paginé des consultations payées, RDV terminés, médecin indiqué |
| GET `/admin/finance/anomalies` | finance:read, historiques non prouvés/retours opérateur sans demande, paginés |
| POST `/admin/finance/payouts` | finance:write, UUID stable + doctorId + paymentIds distincts (1–100), montant serveur uniquement |
| POST `/admin/finance/operations/:id/start` | finance:write, prise en charge avant exécution externe |
| POST `/admin/finance/operations/:id/cancel` | finance:write, PAYOUT REQUESTED seulement |
| POST `/admin/finance/operations/:id/complete` | finance:write, EXECUTING + proofRef opaque unique ; pas de fichier ni URL |
| POST `/admin/finance/payments/:id/external-refund` | finance:write, rattrapage d'un REFUNDED externe identifiable, jamais wallet/sans fournisseur |

Toutes les mutations relisent admin actif, profil non suspendu et scope sous verrou dans leur transaction. UUID et empreinte doctorId/paiements permettent le rejeu identique, contenu différent 409, sans prix client. Interface `/pro/stats` : période, revenus, créance totale/réservations, activité/notes, CSV et offres L6 conservées. `/admin/finance` : sélection de références sans patients, demande, journal, prise en charge, preuve, anomalies. Reçu consultable dans historique abonnement et RDV patient ; le remboursement interne affiché n'atteste jamais un retour opérateur.

Le journal financier et les références d'opération n'ont pas de FK destructive vers compte/paiement : suppression d'un compte ne réattribue/efface pas l'historique. Identifiants pseudonymes restent des données personnelles ; politique de conservation, archivage et droits d'effacement à valider au GO L11, pas de durée légale inventée ici. Le garde-fou append-only n'est pas une protection contre le superutilisateur DB.

## Procédure opérateur et limites

1. Finance vérifie identité professionnelle, bénéficiaire et coordonnées de règlement via le circuit opérateur/KYC autorisé. Aucune nouvelle saisie de données patient dans la finance. Le net éligible exige RDV COMPLETED et capture attribuable ; pas d'attribution arbitraire d'un paiement ancien.
2. Créer une demande PAYOUT UUID stable ; vérifier le montant exact retourné et les allocations. Voir journal après toute réponse ambiguë, avant nouvelle demande.
3. `start` attribue l'opération et passe EXECUTING. Un autre admin ne peut reprendre `start` ; le rejeu du titulaire restitue l'état. **Ce bouton ne transfère aucun argent.** L'identifiant opération sert de référence externe. Exécuter une seule fois hors application.
4. Si l'issue externe est incertaine, rester EXECUTING, rapprocher chez l'opérateur ; aucune annulation, remise en file ou second transfert automatique. Un finance habilité peut clôturer après vérification, même si le titulaire initial a été suspendu, son identité de clôture est tracée.
5. Clôturer avec preuve réellement contrôlée : référence opaque préfixée par l'opérateur, sans URL/texte médical, 6–120 caractères alphanumériques avec `_.:-`, unique. Pièce originale conservée dans le registre opérateur sécurisé, hors application ; montant, devise, bénéficiaire et référence opération doivent concord­er. Le serveur garantit le journal local et l'unicité de référence, pas l'authenticité d'un document externe ni l'unicité d'une action humaine hors application.
6. Remboursement externe : transition interne crée REQUESTED avec montant/ref fournisseur, puis même circuit start→preuve→EXECUTED. WALLET restitué atomiquement n'attend pas de remboursement opérateur. Un ancien retour déjà effectué doit être **rapproché**, jamais exécuté une deuxième fois ; documenter la preuve historique via le circuit de clôture après prise en charge comptable. Sans référence fournisseur : dossier d'anomalie, aucune opération financière inventée.

Les anciens paiements COMPLETED/REFUNDED sans CAPTURE sont exclus et signalés. Aucun `updatedAt` ou statut terminal ne devient une preuve de date/commission. Le rattrapage explicite d'une obligation externe n'invente ni CAPTURE ni revenu. Un dossier legacy clôturé conserve son anomalie comptable historique tant qu'aucune procédure de reprise autorisée distincte n'existe.

Limites maintenues : preuve manuelle, règlements fournisseurs et qualification réels L10 ; facture fiscale hors pilote approuvé ; conservation L11 ; audit global ordonné par createdAt avec risque d'égalité temporelle X6 à traiter L8. Pas de DLQ existante ou de garantie d'atomicité distribuée inventée. Déploiement en maintenance, migration avant nouveaux workers, pas de mélange anciens/nouveaux chemins de paiement ; retour correctif en avant pour conserver le journal.
