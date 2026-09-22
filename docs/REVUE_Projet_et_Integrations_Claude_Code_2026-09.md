# Revue du projet & intégrations restantes — plan d'exécution Claude Code

> **Date de revue : 22 septembre 2026** · **Branche : `work`** · **Commit audité : `c73b442`**
> Cette revue complète, sans remplacer, l'état des lieux du 1er septembre et les suivis B3/B4/B5.
> Elle distingue explicitement ce que **Claude Code peut livrer dans le dépôt** de ce qui exige
> une action du porteur, un compte fournisseur, un professionnel de santé ou l'accès au VPS.

## 1. Verdict exécutif

Le produit est **fonctionnellement très avancé et cohérent** : monorepo lisible, domaines métier
séparés, sécurité documentée, migrations versionnées, scripts de déploiement et de sauvegarde
présents. La finalisation n'est plus un chantier de création d'écrans. Elle est surtout un chantier
d'**activation, de recette et de preuve**.

La mise en service publique ne doit toutefois pas être déclarée terminée aujourd'hui : les suivis
versionnés ne démontrent encore ni VPS opérationnel, ni fournisseur réel activé, ni recette réelle
multi-rôle. La restauration n'a été répétée que sur une pile de test et les validations linguistiques
et cliniques externes restent ouvertes.

### Feu de décision

| Niveau | Verdict | Motif |
|---|---|---|
| Code statique | **Vert** | lint et typecheck passent ; aucun marqueur TODO/FIXME applicatif trouvé |
| Tests unitaires sans I/O | **Vert** | 141 tests API et 37 tests web passent dans l'environnement audité |
| Tests d'intégration | **Orange** | 184 tests API non exécutés faute de PostgreSQL/Redis locaux actifs pendant cette revue |
| Build de production | **Orange** | API construite ; web bloqué par le téléchargement de Google Fonts, donc build non hermétique |
| i18n | **Orange** | EN 100 % ; FON/YOR 92 %, 74 clés manquantes par langue dont 6 critiques |
| Infrastructure production | **Rouge** | toutes les cases B3 sont encore ouvertes dans le dépôt |
| Intégrations réelles | **Rouge** | toutes les cases FedaPay/Twilio/Daily/Firebase/Resend sont encore ouvertes |
| GO-LIVE clinique | **Rouge** | contreseing professionnel et recette réelle non tracés |

## 2. Revue technique synthétique

### 2.1 Architecture et périmètre observés

- **Frontend** : Next.js 14 / React 18, PWA et offline, 66 fichiers `page.tsx`.
- **Backend** : Fastify 5, Prisma/PostgreSQL, Redis, WebSocket ; 167 déclarations de handlers
  REST mesurées dans les fichiers `*.routes.ts` (le compteur documentaire « 163 REST + 1 WS »
  doit être recalculé avant la prochaine publication officielle).
- **Qualité** : 64 fichiers de tests API, 5 fichiers web et 2 specs Playwright.
- **Données** : migrations Prisma versionnées ; chiffrement santé, consentement par entrée,
  journal d'audit et RBAC admin documentés et testés.
- **Ops** : CI en Node 24, déploiement SSH opt-in, PostgreSQL 16 + Redis en services CI, build et
  e2e gardant le job de déploiement.

### 2.2 Forces à préserver

1. **Décisions d'architecture explicites** : VPS Infomaniak, PostgreSQL natif, pas de serverless.
2. **Frontière des secrets saine** : secrets d'infrastructure en `.env`, secrets fournisseurs
   chiffrés en base avec fallback environnement.
3. **Cloisonnement métier** : sept rôles, consentement DMP, restrictions pharmacie/labo/admin.
4. **Paiement protégé** : zone FedaPay gelée, idempotence/webhooks/réconciliation couverts.
5. **Runbooks existants** : provision, déploiement, crons, sauvegarde/restauration et activation
   fournisseurs sont déjà décrits ; il faut les exécuter, pas les réinventer.

### 2.3 Risques techniques restant à fermer

| Priorité | Risque | Constat | Action recommandée |
|---|---|---|---|
| **P0** | Absence de preuve d'intégration complète | La passe locale n'avait ni PostgreSQL ni Redis ; 184 tests sont donc restés non exécutés | lancer la pile, migrer puis rejouer tests + e2e |
| **P0** | Production non matérialisée | B3 ne contient aucune case cochée | provisionner le VPS et remplir les preuves du runbook |
| **P0** | Fournisseurs encore en stub | B4 est entièrement vide | activer et tester les cinq fournisseurs, sandbox avant live |
| **P1** | Build web dépendant de Google | `next/font/google` télécharge deux polices au build ; échec constaté lorsque Google Fonts est inaccessible | embarquer les fontes sous licence avec `next/font/local` ou garantir/monitorer cet accès au build |
| **P1** | Documentation de comptage en dérive | 167 handlers mesurés contre l'ancien total documenté | ajouter un script de comptage stable et mettre les chiffres à jour |
| **P1** | Couverture linguistique critique | 6 clés SOS critiques absentes en FON et YOR | double validation humaine, puis réintégration et contrôle |
| **P1** | Validation clinique non indépendante | décision porteur tracée, mais pas de contreseing professionnel | obtenir signature et versionner uniquement la trace, jamais une donnée sensible inutile |
| **P2** | Dépendance à des validations manuelles | mobile réel, délivrabilité +229, caméra iOS/Android, push et WebRTC ne sont pas simulables fidèlement | exécuter une recette physique avec matrice d'appareils/opérateurs |

## 3. Intégrations restantes — inventaire exhaustif

### 3.1 FedaPay — paiement Mobile Money, carte et recharge wallet (**P0**)

**État observé :** implémentation et tests unitaires présents ; aucun compte, aucune clé, aucun
webhook sandbox ou paiement réel n'est coché dans B4.

**Actions externes (porteur/FedaPay)**

1. Ouvrir et faire valider le compte marchand.
2. Obtenir `secretKey`, `publicKey`, `webhookSecret` sandbox.
3. Après B3, déclarer l'URL HTTPS `/api/v1/payments/webhook`.
4. Après recette sandbox complète, demander/poser la clé live et **faire tourner simultanément**
   le secret webhook.

**Actions Claude Code**

- préparer un script de smoke test sans secret en clair ;
- vérifier signatures HMAC valide/invalide, rejeu, retry, DLQ et idempotence ;
- tracer les résultats wallet recharge, consultation Mobile Money, WALLET, remboursement et
  réconciliation ;
- ne modifier aucun fichier de logique paiement sans revue explicite de la zone gelée §5.

**Critère de sortie :** un paiement sandbox passe `PENDING → COMPLETED` par webhook, une
réconciliation est idempotente, puis un premier paiement live contrôlé est rapproché.

### 3.2 Twilio — OTP, SOS et SMS critiques (**P0**)

**Reste à faire :** compte hors trial, `accountSid`, `authToken`, `fromNumber`, numéro public SOS,
tests de délivrabilité réels MTN et Moov au format béninois `+22901XXXXXXXX`.

**Claude Code peut :** automatiser un smoke test opt-in, vérifier les templates et langues, produire
une fiche de résultats anonymisée. **Claude Code ne peut pas :** ouvrir le compte, recevoir le SMS
physique, négocier le sender ID ou choisir le numéro d'urgence officiel.

**Critère de sortie :** OTP reçu sur les deux réseaux cibles, verrouillage anti-abus vérifié, SOS
reçu par la destination validée, repli numéro long testé.

### 3.3 Daily.co — téléconsultation WebRTC (**P0**)

**Reste à faire :** compte, `apiKey`, `domain`, test de création/entrée en salle et test réseau
dégradé sur deux terminaux distincts.

**Claude Code peut :** ajouter/faire tourner des probes de readiness non destructives et préparer
la feuille de recette VIDEO → AUDIO → CHAT. La qualité média et les permissions navigateur doivent
être vérifiées humainement sur appareils réels.

**Critère de sortie :** patient et médecin rejoignent la même salle, permissions et expiration
fonctionnent, la bascule dégradée ne perd pas la conversation.

### 3.4 Firebase FCM — notifications push web (**P0**)

**Reste à faire :** projet Firebase, compte de service (`projectId`, `clientEmail`, `privateKey`),
application web, six variables publiques incluant VAPID, rebuild de la PWA, autorisation et réception
sur Android ainsi qu'iPhone installé.

**Point d'attention :** les `NEXT_PUBLIC_FIREBASE_*` sont injectées **au build** et ne sont pas
remplaçables par la seule console admin. La configuration serveur peut être dynamique, la config web
exige un nouveau build/déploiement.

**Critère de sortie :** token enregistré/renouvelé, notification reçue au premier plan et en arrière-
plan, révocation gérée, aucune clé privée exposée au bundle.

### 3.5 Resend — email transactionnel (**P1**)

**Reste à faire :** compte, clé API, domaine d'envoi, enregistrements DNS SPF/DKIM et adresse
`fromEmail`, puis tests de réception et de réputation minimale.

**Critère de sortie :** readiness vert, message reçu sans usurpation, SPF/DKIM validés, aucun secret
dans les logs.

### 3.6 Infrastructure transverse — VPS, DNS, TLS, DB, Redis, stockage (**P0**)

Ce n'est pas un « sixième fournisseur », mais c'est le socle bloquant de tous les autres : VPS
Ubuntu 22.04, domaine et DNS, SSH, PostgreSQL 16, Redis, PM2 ×2, Nginx/WS, Certbot, magasin de
fichiers chiffrés, crons et secrets d'infrastructure.

**Critère de sortie :** `health` et `ready` verts, WebSocket sans jeton dans les logs, cinq
générateurs de rappels à 200, deux archives créées, déploiement CI opt-in réussi.

### 3.7 Validation humaine — i18n et clinique (**P0 avant patients réels**)

- **FON/YOR :** 74 clés manquantes par langue, dont 6 critiques SOS ; traduction native puis double
  validation des namespaces critiques.
- **Clinique :** contreseing du triage, PEV, phrasier et confirmation ONMB du format CNOM.

Claude Code peut exporter, réintégrer, contrôler la parité et régénérer le dossier DOCX. Il ne doit
ni inventer une validation, ni signer, ni publier une traduction machine critique.

## 4. Séquence recommandée pour finaliser avec Claude Code

### Lot 0 — Baseline reproductible (Claude Code, immédiat)

1. Démarrer `infra/docker-compose.dev.yml`.
2. Appliquer les migrations et le seed sur une base dédiée.
3. Lancer lint, typecheck, tests, build et Playwright ; conserver les rapports.
4. Rendre le build frontend indépendant de Google Fonts, après vérification de la licence des fichiers.
5. Créer un script `release:check` non destructif qui agrège les contrôles sans secret.

**Sortie :** aucun skip d'intégration involontaire, build hors-ligne reproductible, baseline datée.

### Lot 1 — Socle production (binôme porteur + Claude Code)

1. Le porteur fournit VPS, domaine, accès et secrets d'infrastructure.
2. Claude Code déroule B3 sans afficher les secrets, collecte uniquement les preuves non sensibles.
3. Activer `DEPLOY_ENABLED=true` seulement après un premier déploiement manuel sain.
4. Exécuter le test réel B5 sur une machine tierce et vérifier DB + pièces jointes.

**Sortie :** application en recette fermée HTTPS, restauration réelle prouvée.

### Lot 2 — Fournisseurs en parallèle (porteur + Claude Code)

Ouvrir simultanément Twilio, Daily, Firebase, Resend et FedaPay sandbox. Les intégrer un par un pour
isoler les erreurs. Ordre de recette conseillé : **Resend → Firebase → Daily → Twilio → FedaPay** ;
FedaPay reste dernier car il implique argent, webhook et zone gelée.

**Sortie :** tableau B4 entièrement coché en sandbox/recette, puis FedaPay live contrôlé.

### Lot 3 — Validation métier et appareils (humains assistés par Claude Code)

1. Réintégrer les traductions validées et joindre la traçabilité.
2. Intégrer les corrections cliniques signées, tests de non-régression inclus.
3. Recette sept rôles sur Android/iPhone, réseaux MTN/Moov et faible bande passante.
4. Tester PWA installée, caméra QR, offline/queue, push, WebRTC, SMS et paiement.

**Sortie :** procès-verbal de recette sans blocant P0/P1.

### Lot 4 — GO-LIVE contrôlé

1. Audit final secrets/logs/CSP/consentement/audit trail.
2. Sauvegarde immédiate pré-ouverture et vérification des alertes.
3. Ouverture progressive à un petit groupe pilote ; rollback documenté.
4. Revue à J+1 et J+7 : erreurs, files de notifications, paiements, capacité, support.

## 5. Prompts prêts à lancer dans Claude Code

Exécuter **un prompt par branche/PR**, jamais tous en une seule modification.

> Pour une liste opérationnelle détaillée, découpée par correction et par fournisseur, utiliser
> `docs/PROMPTS_Claude_Code_Finalisation.md`. Les cinq prompts ci-dessous restent des raccourcis de
> pilotage ; le catalogue détaillé précise les prérequis, garde-fous et critères d'acceptation.

### Prompt A — baseline complète

```text
Lis CLAUDE.md et tous les AGENTS.md applicables. Sans modifier la logique métier, démarre la pile
locale, applique les migrations sur une base de test dédiée, puis exécute lint, typecheck, tests API
et web, build et Playwright. Analyse chaque skip et chaque échec. Produis un rapport daté dans docs/
avec commandes, résultats, limites et écarts actionnables. Ne mets aucun secret dans le rapport.
```

### Prompt B — build web hermétique

```text
Lis CLAUDE.md. Le build Next.js échoue lorsque fonts.googleapis.com est indisponible. Propose puis
implémente la plus petite migration de Bricolage Grotesque et DM Sans vers next/font/local, en
conservant exactement les familles, graisses, variables CSS, rendu et licences. Ajoute les assets
autorisés, teste un build sans réseau et documente leur provenance/licence. Ne change aucun écran.
```

### Prompt C — recette fournisseurs

```text
Lis CLAUDE.md et docs/SUIVI_B4_Comptes_2026-09.md. Prépare des smoke tests opt-in et non destructifs
pour Resend, Firebase, Daily et Twilio, sans imprimer les secrets. Pour FedaPay, ne modifie pas la
zone gelée : exécute seulement les tests existants et prépare une checklist de recette sandbox avec
webhook HMAC valide/invalide, rejeu et réconciliation. Mets à jour le suivi uniquement à partir de
preuves réellement observées.
```

### Prompt D — déploiement assisté

```text
Lis CLAUDE.md, DEPLOIEMENT_Checklist.md et SUIVI_B3_MiseEnProduction_2026-09.md. Préflight uniquement :
vérifie versions, fichiers requis, placeholders, permissions attendues et commandes sans lancer de
mutation distante. Demande ensuite explicitement l'hôte et confirme chaque phase avant exécution.
N'affiche jamais une valeur de secret. Après chaque phase, consigne uniquement statut, date et preuve
non sensible dans le suivi B3.
```

### Prompt E — dossier GO-LIVE

```text
À partir des suivis B1 à B5 et des preuves de recette, génère une matrice GO/NO-GO. Une case sans
preuve reste NO-GO. Vérifie i18n critique, signature clinique, fournisseurs, restauration réelle,
recette sept rôles et rollback. Ne transforme jamais une décision transitoire du porteur en validation
professionnelle. Produis le procès-verbal DOCX selon le workflow build puis validate de CLAUDE.md.
```

## 6. Définition de « terminé »

Le projet est finalisé uniquement lorsque les éléments suivants sont tous prouvés :

- [ ] CI complète verte, y compris les 325 tests API, 37 tests web et 8 scénarios e2e documentés.
- [ ] Build web reproductible et déploiement Node 24 réussi.
- [ ] VPS/DNS/TLS/DB/Redis/PM2/Nginx/crons opérationnels.
- [ ] FedaPay, Twilio, Daily, Firebase et Resend validés par test métier réel.
- [ ] Webhook FedaPay sandbox puis live vérifié sans double crédit.
- [ ] Restauration des deux archives de production réussie sur machine tierce.
- [ ] Zéro clé critique i18n manquante et double validation tracée.
- [ ] Contreseing clinique obtenu et format CNOM confirmé ou explicitement désactivé jusqu'à confirmation.
- [ ] Recette des sept rôles sur appareils/réseaux cibles sans P0/P1.
- [ ] Monitoring, support, rollback et revue post-ouverture attribués à des responsables nommés.

## 7. Conclusion

La bonne stratégie avec Claude Code est de lui confier **l'automatisation, la vérification, les
smoke tests, la collecte de preuves et les petites corrections reproductibles**. Il ne faut pas lui
demander de simuler les actions externes : ouverture de comptes, réception physique, validation
clinique, traduction native, DNS marchand et acceptation FedaPay restent humaines. Le chemin critique
est donc : **baseline locale → VPS → fournisseurs sandbox → validations humaines → recette réelle →
restauration → ouverture pilote**.
