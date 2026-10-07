# Recette L6 — abonnement médecin

> Contrat : `CONTRAT_Abonnements_L6.md`. Auto-tests dans LOT_L6 ; cases ci-dessous réservées à la recette humaine/fournisseur, aucune signature ou preuve réelle inventée.

| Cas | Action et résultat attendu | Preuve / opérateur / date |
|---|---|---|
| A1 | Médecin FREE actif/vérifié : profil/agenda/messages accessibles ; nouveau démarrage téléconsultation refusé API et offre PRO proposée | À recueillir |
| A2 | Vérifier FREE + PRO 5 000 XOF/mois calendaire, absence STARTER/CLINIC et prélèvement automatique | À recueillir |
| A3 | Compte non vérifié/suspendu ou tiers : aucune vente, aucun checkout d'autrui | À recueillir |
| A4 | POST PRO sans paiement, prix client, paiement SUBSCRIPTION générique : refus sans droits | À recueillir |
| A5 | FedaPay sandbox configuré : payer effectivement 5 000 XOF, webhook HMAC réel → une période et un audit, retour PRO ne confirme rien seul | À recueillir, L10 |
| A6 | Refus/annulation opérateur, secret invalide, absence configuration : aucun droit ni lien fictif | À recueillir, L10 |
| A7 | Coupure après POST : relire/reprendre commande, même clé sans nouveau débit ; recharge historique wallet reste correcte | À recueillir |
| A8 | Wallet suffisant/insuffisant : un débit exactement 5 000 XOF avec période/audit, ou rollback total | À recueillir |
| A9 | Retry ×5 et webhook ∥ reconcile : aucune prolongation supplémentaire ; signature mauvaise refusée | À recueillir, L10 |
| A10 | Renouvellement manuel : nouveau paiement et mois à la fin payée ; fin de mois 31 janvier → 28 février, heure Bénin conservée | À recueillir |
| A11 | Expiration sans cron : nouveau démarrage refusé, join/end du soin ouvert conservés selon L5 | À recueillir |
| A12 | Retour FREE : période payée conservée jusqu'à l'échéance, aucun débit automatique ultérieur | À recueillir |
| A13 | Abandon pendant attente puis confirmation tardive : argent tracé sans droits ; historique/référence et support remboursement | À recueillir, L10 |
| A14 | Remboursement interne concurrent : droit révoqué et restitution wallet unique ; opérateur restitué manuellement et rapproché séparément | À recueillir, L7/L10 |
| A15 | Ancien PRO ACTIVE sans preuve : aucun droit ; inventaire et information médecin, aucune preuve de paiement fabriquée | À recueillir |
| A16 | Hors réseau et stockage navigateur : pas de mutation financière en file, ni checkout/token caché ; reprise en ligne relit l'API | À recueillir |
| A17 | Android/iOS, petits écrans, clavier/dialogues, FR/EN et repli natif ; droits revenus à vérifier avec L7 | À recueillir, L9/L10 |

Conserver uniquement références et résultats expurgés dans le PV ; aucune clé fournisseur, OTP réel, cookie, numéro client ou lien checkout porteur de token. Re-tests §5 dans `RECETTE_FedaPay_Sandbox.md`. Aucun appel réel autorisé/attesté par les tests simulés seuls ; GO pilote dépend toujours de L9–L11.
