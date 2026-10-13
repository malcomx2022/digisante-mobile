# Recette Daily privée — lot L5 et fournisseur L10

> **L10, 8 octobre 2026 :** suivre d’abord `CONTRAT_Preproduction_L10.md` §3 pour les gardes obligatoires (NODE_ENV=production, préproduction isolée, SHA exact, DB *_preprod, index Redis et un seul fournisseur). Les commandes courtes ci-dessous ne suffisent plus seules. Setup smoke indépendant sans FLUSHDB/seed/migration ; aucune réception réelle attestée dans cette livraison. Résultats à référencer dans `preproduction/L10/evidence.json`.

> 7 octobre 2026 (Africa/Lagos). Implémentation candidate décrite dans `GUIDE_DailyCo_Teleconsultation.md` et `CONTRAT_Teleconsultation_L5.md`. Tests locaux simulés et E2E sans identifiants ne valident pas ces cases. Aucun appel réel entre appareils n'est attesté ici. Reporter les résultats, incidents, appareils et preuve d'opérateur avant le GO L11.

## Smoke serveur réel, opt-in

Configurer Daily via l'admin (`apiKey`, `domain`) ou le fallback serveur `.env`. Aucun secret dans un document/log. Sur une pile de recette autorisée, appliquer les migrations puis lancer :

```bash
SMOKE_DAILY=1 pnpm --filter @digisante/api test:smoke -- daily
```

Création `smoke-<horodatage>`, lecture effective de salle privée et protections, émission de JWT fournisseur borné, doublon de nom (B5, 13/10/2026 : statut et type `error` consignés, refus 4xx attendu, `createRoom` en 502 sans reprendre ni supprimer la salle existante), suppression et constat de 404. Le service vérifie aussi frappe interdite, limite de participants, identité unique et capacités désactivées. Le smoke ne prouve pas les médias ni l'éjection de participants connectés. Échec explicite si non configuré. Nettoyage dans afterAll ; aucun token ni clé publiés.

## Matrice sur deux appareils + un tiers

| # | Action | Résultat attendu | Preuve / OK |
|---|---|---|---|
| D1 | Médecin actif/vérifié ouvre un RDV confirmé depuis agenda | consultation et notification patient dans sa langue ; aucune salle/notification dupliquée | ☐ |
| D2 | Patient rejoint depuis ses rendez-vous | chacun voit et entend l'autre ; SDK utilise son token nominatif | ☐ |
| D3 | Refuser caméra, accepter micro | état fournisseur clair ; AUDIO possible, caméra réellement éteinte | ☐ |
| D4 | Refuser micro | message fournisseur clair ; bouton Ouvrir le chat accessible | ☐ |
| D5 | Bouton AUDIO puis réseau très faible | caméra et émission vidéo coupées, voix continue ; autre client converge au palier serveur | ☐ |
| D6 | Nouvelle dégradation vers CHAT | caméra/micro libérés, messagerie DigiSanté accessible ; pas de contenu envoyé au chat Daily | ☐ |
| D7 | Recharger/revenir | AUDIO/CHAT serveur conservé ; aucun redémarrage vidéo silencieux | ☐ |
| D8 | Attendre l'expiration du bearer (≤ 15 min) | éjection ; message et Réessayer ; rejoin seulement si droits actuels et salle < 4 h | ☐ |
| D9 | Médecin clôture | DB COMPLETED ; éjection/ban nominatif Daily + DELETE ; autres clients quittent | ☐ |
| D10 | Ouvrir URL seule et ancien bearer après clôture | aucun accès ; contrôler séparément suppression ET éjection session déjà ouverte | ☐ |
| D11 | Tiers ouvre l'URL sans token | refus, aucune frappe/admission anonyme ; tiers/admin API refusés | ☐ |
| D12 | Token expiré réutilisé directement hors application | refus fournisseur réel, pas seulement contrôle de l'API | ☐ |
| D13 | Suspendre patient ou médecin / retirer habilitation médecin | nouveaux join refusés ; client connecté ferme au prochain polling ; bearer externe borné 15 min | ☐ |
| D14 | Annuler RDV puis tenter join et clôturer le média | join refusé ; clôture conserve CANCELLED sans changer le remboursement | ☐ |
| D15 | Inspecter historique, DOM iframe, URLs, logs/API/cache/SW | token absent des URLs/attributs/stockages ; pas de réponse cacheable ; clé API jamais exposée | ☐ |
| D16 | Quitter/raccrocher/fermer page puis Réessayer rapidement | périphériques libérés ; pas d'ancienne session qui redémarre après réponse tardive | ☐ |
| D17 | Daily 401/5xx/timeout ou configuration absente | pas d'iframe/jeton fictif ; erreur normalisée ou vidéo indisponible explicite, chat accessible | ☐ |
| D18 | Deux connexions de même identité puis troisième identité | unicité d'identité et limite deux vérifiées ; documenter le comportement fournisseur réel | ☐ |
| D19 | B5 — compte et noms : vérifier que le compte n'est pas en mode HIPAA ; créer `consult-<id>-<32 hex>`, puis tenter 129 caractères et un caractère hors `[A-Za-z0-9_-]` | nom de 105 caractères accepté ; statut et `error` des refus consignés (jamais `info`) ; mode HIPAA = flux incompatible, bloquant | ☐ |
| D20 | B5 — démarrage lent : retarder Daily (proxy/latence) puis, pendant la création, réserver un autre créneau chez ce médecin et annuler le RDV | réservation acceptée sans P2028 ; démarrage refusé (400), aucune consultation ni notification, salle de la tentative absente de la liste Daily | ☐ |
| D21 | B5 — délai/coupure après envoi du POST, et deux démarrages simultanés du même RDV | DELETE du nom envoyé (200 ou 404) ; une seule consultation/notification, salle perdante supprimée ; aucune salle orpheline au-delà des avertissements journalisés (nom seul) | ☐ |

Consigner date, modèle/OS/navigateur Android et iOS, réseau, version/commit, opérateur, résultat par case et incident. Vérifier Permissions-Policy/CSP après Nginx en HTTPS : caméra/micro délégués au seul domaine Daily, pas bloqués par un en-tête proxy. Recette B4/Daily L10 : toutes les garanties privées/médias critiques et les cas D1–D21 examinés, aucun échec bloquant ouvert. La qualification fournisseur (région, télémétrie, traitements, contrat de sous-traitance) reste à valider par le porteur avant usage médical.

## Retour sûr et héritage

Désactiver DAILY dans l'admin : aucune nouvelle salle/token ; message vidéo indisponible et chat. Une salle externe déjà ouverte garde son bearer jusqu'à échéance si les tentatives d'éjection/suppression échouent. Supprimer les salles historiques sans privacy/expiration/frappe conforme avant recette. Ne pas remettre l'ancien stub externe ou un token dans `?t=`. Rotation chez Daily puis configuration write-only admin ; ne jamais copier un JWT dans le PV.
