# Recette Daily privée — lot L5 et fournisseur L10

> 7 octobre 2026 (Africa/Lagos). Implémentation candidate décrite dans `GUIDE_DailyCo_Teleconsultation.md` et `CONTRAT_Teleconsultation_L5.md`. Tests locaux simulés et E2E sans identifiants ne valident pas ces cases. Aucun appel réel entre appareils n'est attesté ici. Reporter les résultats, incidents, appareils et preuve d'opérateur avant le GO L11.

## Smoke serveur réel, opt-in

Configurer Daily via l'admin (`apiKey`, `domain`) ou le fallback serveur `.env`. Aucun secret dans un document/log. Sur une pile de recette autorisée, appliquer les migrations puis lancer :

```bash
SMOKE_DAILY=1 pnpm --filter @digisante/api test:smoke -- daily
```

Création `smoke-<horodatage>`, lecture effective de salle privée et protections, émission de JWT fournisseur borné, suppression et constat de 404. Le service vérifie aussi frappe interdite, limite de participants, identité unique et capacités désactivées. Le smoke ne prouve pas les médias ni l'éjection de participants connectés. Échec explicite si non configuré. Nettoyage dans afterAll ; aucun token ni clé publiés.

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

Consigner date, modèle/OS/navigateur Android et iOS, réseau, version/commit, opérateur, résultat par case et incident. Vérifier Permissions-Policy/CSP après Nginx en HTTPS : caméra/micro délégués au seul domaine Daily, pas bloqués par un en-tête proxy. Recette B4/Daily L10 : toutes les garanties privées/médias critiques et les cas D1–D18 examinés, aucun échec bloquant ouvert. La qualification fournisseur (région, télémétrie, traitements, contrat de sous-traitance) reste à valider par le porteur avant usage médical.

## Retour sûr et héritage

Désactiver DAILY dans l'admin : aucune nouvelle salle/token ; message vidéo indisponible et chat. Une salle externe déjà ouverte garde son bearer jusqu'à échéance si les tentatives d'éjection/suppression échouent. Supprimer les salles historiques sans privacy/expiration/frappe conforme avant recette. Ne pas remettre l'ancien stub externe ou un token dans `?t=`. Rotation chez Daily puis configuration write-only admin ; ne jamais copier un JWT dans le PV.
