# Revue Fonctionnelle — DigiSanté Mobile

> **Projet** : DigiSanté Mobile — Progressive Web App (PWA) de e-santé pour le Bénin
> **Cadre** : Programme **NEXT IMPACT** (FP2E / Sèmè City / Banque Mondiale) — Convention `FP2E/NI/IDÉ/2025`
> **Statut de la codebase** : Feature-complete (160 endpoints REST, 1 canal WebSocket, 63 pages frontend, 47 modèles Prisma, 32 enums, 26 migrations).
> **Auteur de la revue** : Jules (Software Engineer)
> **Date de rédaction** : Juillet 2026

---

## Table des Matières
1. [Contexte, Mission & Positionnement](#1-contexte-mission--positionnement)
2. [Cartographie des 7 Rôles Utilisateurs](#2-cartographie-des-7-rôles-utilisateurs)
3. [Architecture Fonctionnelle & Modules Métiers](#3-architecture-fonctionnelle--modules-métiers)
4. [Sécurité, Confidentialité & Conformité APDP](#4-sécurité-confidentialité--conformité-apdp)
5. [Spécificités PWA, Offline-First & Accessibilité](#5-spécificités-pwa-offline-first--accessibilité)
6. [Gestion des Langues, i18n & Phrasier Médical](#6-gestion-des-langues-i18n--phrasier-médical)
7. [Architecture d'Intégration & Services Tiers](#7-architecture-dintégration--services-tiers)
8. [Flux Fonctionnels Traversants (De Bout en Bout)](#8-flux-fonctionnels-traversants-de-bout-en-bout)
9. [Conclusion & Recommandations Produit](#9-conclusion--recommandations-produit)

---

## 1. Contexte, Mission & Positionnement

### 1.1 Les Défis Sanitaires Cibles
DigiSanté Mobile est conçu pour répondre aux défis sanitaires majeurs de la République du Bénin :
* **Infrastructure médicale limitée et inégalement répartie** (difficulté d'accès aux spécialistes en zone rurale).
* **Perte récurrente des dossiers médicaux** papier (carnets de santé égarés ou détériorés).
* **Connectivité rurale faible ou intermittente** (zones blanches, réseaux 2G/3G lents).
* **Barrières linguistiques et de littératie** (populations parlant majoritairement des langues locales comme le Fɔ̀ngbè ou le Yorùbá, avec des taux d'alphabétisation variables).

### 1.2 La Mission du Projet
Offrir une plateforme de santé universelle, **offline-first**, **multilingue**, garantissant la continuité des soins et l'inclusion numérique grâce à :
* Un Dossier Médical Partagé (DMP) sécurisé, chiffré et contrôlé par le patient.
* Un module de téléconsultation résilient (audio/vidéo/chat).
* Un réseau de confiance liant les patients, les médecins, les pharmacies, les laboratoires et la diaspora.
* L'intégration d'un rôle d'**Agent de Santé Communautaire (ASC)** pour amener la santé numérique jusqu'aux populations déconnectées.

---

## 2. Cartographie des 7 Rôles Utilisateurs

L'application orchestre l'interaction entre **7 profils d'utilisateurs distincts**, chacun ayant un espace de travail optimisé, cloisonné et adapté à son rôle :

```
                        ┌──────────────────┐
                        │    DIASPORA      │ (Soutien financier / Wallet)
                        └────────┬─────────┘
                                 │
  ┌─────────────────┐   ┌────────▼─────────┐   ┌─────────────────┐
  │   PHARMACIE     │◀──┤     PATIENT      ├──▶│   LABORATOIRE   │
  │ (Dispensation,  │   │  (DMP, Rappels,  │   │ (Analyses,      │
  │  Stock local)   │   │  Triage, SOS)    │   │  Alertes)       │
  └─────────────────┘   └────────▲─────────┘   └─────────────────┘
                                 │
  ┌─────────────────┐   ┌────────┴─────────┐   ┌─────────────────┐
  │   MÉDECIN PRO   │◀──┤  ASC (Relais)    │   │ ADMINISTRATEUR  │
  │ (Consultation,  │   │ (Suivi village,  │   │ (Scopes RBAC,   │
  │  Ordonnances)   │   │  Observations)   │   │  KYC, Audit)    │
  └─────────────────┘   └──────────────────┘   └─────────────────┘
```

### 2.1 Le Patient
* **Mission** : Gérer sa propre santé, ses constantes, ses rendez-vous et ses dépenses médicales.
* **Fonctionnalités clés** :
  * Accès à son DMP personnel (historique, constantes cliniques).
  * Auto-évaluation par triage intelligent hors-ligne (signes de danger OMS/PCIME).
  * Prise de rendez-vous avec téléconsultation et chat sécurisé en temps réel.
  * Observance médicamenteuse (prises, streaks, rappels horodatés).
  * Fiche d'urgence accessible instantanément et SOS avec transmission de géolocalisation par SMS en cas de déconnexion.
  * Suivi de grossesse et de vaccination (PEV).
  * Recherche de médicaments disponibles à proximité (stocks des pharmacies).

### 2.2 Le Médecin (PRO)
* **Mission** : Prendre en charge les patients, prescrire de manière sécurisée et interpréter les résultats médicaux.
* **Fonctionnalités clés** :
  * File d'attente en temps réel et gestion de l'agenda de consultations.
  * Accès sécurisé au DMP d'un patient (conditionné par un consentement strict).
  * Prescription assistée en DCI (Dénomination Commune Internationale) avec détection automatique d'allergies/interactions et signature numérique QR.
  * Interprétation des résultats de laboratoire et boucle de notification fermée.
  * Téléconsultation vidéo (Daily.co) dégradable en audio ou chat en temps réel.
  * Tableau de bord financier (suivi des honoraires, commissions et demandes de reversements).

### 2.3 La Pharmacie
* **Mission** : Délivrer les médicaments de manière granulaire et gérer son inventaire de proximité.
* **Fonctionnalités clés** :
  * Scan de l'ordonnance QR du patient (décodage et validation locale d'authenticité).
  * Dispensation granulaire par ligne (délivré / partiel / indisponible) pour s'adapter au pouvoir d'achat du patient.
  * Journal de dispensation sécurisé (visibilité restreinte à ses propres dispensations).
  * Déclaration et mise à jour du stock de médicaments (`PharmacyStock`) pour alimenter la recherche patient « Médicament près de moi ».

### 2.4 Le Laboratoire
* **Mission** : Recevoir les demandes d'analyses, réaliser les examens et signaler les urgences biologiques.
* **Fonctionnalités clés** :
  * File d'attente des commandes d'analyses (`LabOrder`) totalement **anonymisée** par défaut (Pool global).
  * Prise en charge, traitement (`PROCESSING`) et soumission des résultats structurés (`submitResult`).
  * Détection automatique des **valeurs critiques** (par exemple, glycémie ou hémoglobine en seuils de danger) déclenchant une alerte prioritaire immédiate (`LAB_CRITICAL` par push et SMS) pour le patient et le prescripteur.

### 2.5 La Diaspora
* **Mission** : Soutenir financièrement la santé de ses proches résidant au Bénin depuis l'étranger.
* **Fonctionnalités clés** :
  * Carnet de bénéficiaires (`Beneficiary`) isolé et sécurisé pour gérer les membres de la famille.
  * Rechargement d'un Wallet en devises (€/$ convertis en XOF) via Mobile Money ou carte internationale.
  * Paiement direct des téléconsultations, ordonnances ou examens de laboratoire de ses proches inscrits sur la plateforme.

### 2.6 L'Agent de Santé Communautaire (ASC / Relais)
* **Mission** : Assurer le relais médical dans les villages reculés auprès des populations déconnectées ou analphabètes.
* **Fonctionnalités clés** :
  * Gestion de son propre roster local de bénéficiaires (`AscBeneficiary`).
  * Journal d'observations opérationnelles (`AscObservation` : constantes vitales, résultats de triage basiques).
  * Signalement et relais des cas complexes vers des médecins vérifiés de la plateforme.
  * **Cloisonnement strict** : L'ASC fonctionne selon le **Modèle A (relais "aveugle")** ; il n'a **jamais accès au DMP** global du patient, protégeant ainsi le secret médical au niveau communautaire.

### 2.7 L'Administrateur (Admin)
* **Mission** : Monitorer la plateforme, valider les soignants, gérer le support et assurer la sécurité du système.
* **Fonctionnalités clés** :
  * Profilage granulaire basé sur **17 scopes de droits** et des presets métier (SUPER_ADMIN, OPERATIONS, FINANCE, SUPPORT, MODERATION, CONTENT) pour respecter le principe du moindre privilège.
  * Validation rigoureuse des pièces justificatives professionnelles (workflow KYC soignants, diplômes, CNOM) via une interface dense desktop dédiée (`AdminShell`).
  * Gestion des intégrations et secrets d'API chiffrés.
  * Console de support : déverrouillage de comptes (verrous OTP Redis) et notes internes de suivi.
  * CMS Éducation : relecture, traduction et publication de fiches de santé publique.
  * Consultation du journal d'audit cryptographique immuable.

---

## 3. Architecture Fonctionnelle & Modules Métiers

### 3.1 Le Dossier Médical Partagé (DMP) & Prescriptions
Le DMP est le cœur clinique de DigiSanté. Il regroupe l'historique médical, les allergies, les antécédents, les constantes de santé (auto-mesures de tension, glycémie, poids, température) et les documents du patient.
* **Prescriptions en DCI** : Les ordonnances utilisent les noms scientifiques des molécules (DCI) plutôt que les noms commerciaux. Le système inclut une analyse d'interactions médicamenteuses et d'allergies basée sur le profil du patient.
* **QR Ordonnance Local** : Un QR code contenant l'ordonnance signée numériquement est généré de façon **100 % locale** sur le terminal du patient (garantie de confidentialité, aucun transfert de jeton de prescription à des tiers).
* **Dispensation Granulaire** : Les pharmacies peuvent délivrer une ordonnance ligne par ligne, gérant les paiements partiels et les ruptures de stock.

### 3.2 La Téléconsultation & Le Chat en Temps Réel
La téléconsultation s'adapte dynamiquement à la qualité du réseau mobile béninois :
* **Flux Vidéo WebRTC** : Intégration transparente de Daily.co avec génération de salles privées et émission de tokens sécurisés à validité limitée (médecin = propriétaire avec droits d'éjection ; patient = invité).
* **Dégradation Fail-safe** : En cas de baisse de la bande passante (détectée par l'API Daily), l'application propose automatiquement de basculer de la **Vidéo → l'Audio → le Chat en temps réel**.
* **Chat WebSocket Chiffré** : Messagerie instantanée sécurisée s'appuyant sur Fastify Websockets et un fan-out Redis pub/sub (pour le clustering multi-workers). Les messages sont chiffrés au repos et l'authentification se fait de manière sécurisée.

### 3.3 Triage et Orientation Clinique Hors-Ligne
Pour pallier le manque de médecins dans les zones rurales, l'application intègre un module de triage intelligent :
* **Algorithme PCIME / OMS** : Fondé sur les signes de danger de la Prise en Charge Intégrée des Maladies de l'Enfant (PCIME) et les protocoles de santé maternelle.
* **Biais Conservateur** :
  * Un seul signe **ROUGE** (ex: convulsion, inconscience, respiration très rapide) → **URGENCE** (redirection immédiate vers le SOS ou l'hôpital).
  * Présence de signes **ORANGE** (ex: fièvre persistante, diarrhée sans déshydratation sévère) → **CONSULTER** (redirection vers l'annuaire des médecins de la plateforme).
  * Aucun signe grave → **SURVEILLANCE À DOMICILE** avec des conseils clairs.
* **Zéro Réseau** : L'arbre décisionnel s'exécute intégralement en local sur le téléphone du patient.

### 3.4 Santé Maternelle (CPN) & Vaccination (PEV)
* **Calendrier CPN (Soins Prénatals)** : Aligné sur les recommandations de l'**OMS 2016** (8 contacts prénatals obligatoires calculés à partir de la date des dernières règles - LMP). Il affiche des objectifs cliniques précis pour chaque contact (T1, T2, T3) et alerte en cas de présentation tardive.
* **Carnet de Vaccination PEV** : Génération automatique du calendrier vaccinal du Programme Élargi de Vaccination (BCG, VPO, Pentavalent, Pneumocoque, Rotavirus, VPI, Fièvre Jaune, Rougeole-Rubéole) de la naissance aux 15 mois de l'enfant.
* **Rappels Automatiques (Crons)** : Des tâches planifiées journalières génèrent des notifications de rappel multilingues idempotentes pour s'assurer qu'aucune vaccination ou visite prénatale n'est manquée.

---

## 4. Sécurité, Confidentialité & Conformité APDP

DigiSanté Mobile applique les principes les plus stricts de la protection des données de santé, en conformité directe avec la **loi béninoise n°2017-20** portant protection des données à caractère personnel et l'Autorité de Protection des Données Personnelles (APDP) :

### 4.1 Consentement DMP par Soignant & Portée par Entrée
Pour qu'un professionnel de santé puisse accéder au DMP d'un patient, un protocole strict est mis en œuvre :
* **Génération de Token de Partage** : Le patient génère un QR code ou un code temporaire de consentement.
* **Consentement Nominatif** : Le soignant réclame l'accès en présentant ce token. Un enregistrement `Consent` est créé, liant de manière unique le patient et le soignant avec une date d'expiration.
* **Portée "Par Entrée" (Minimisation des Données)** : Par défaut, le partage d'un enregistrement spécifique (`ConsentRecord`) ne donne accès qu'à **cet enregistrement précis** et non à l'intégralité de l'historique du DMP. Le soignant ne peut lire et exporter que ce qu'il a été autorisé à voir.
* **Révocation Persistante** : Le patient peut lister et révoquer à tout moment un consentement actif. Une fois révoqué, le soignant perd immédiatement l'accès, et le token d'origine ne peut plus être réutilisé pour forcer un ré-octroi.
* **Cloisonnement Admin Strict** : Les administrateurs de la plateforme n'ont **jamais** de clé de déchiffrement des données médicales. Ils gèrent la plateforme, mais le secret médical leur est totalement opaque.

### 4.2 Registre d'Audit Immuable (Audit Trail)
Toutes les actions sensibles (consultation de DMP, refus d'accès `DMP_DENIED`, octroi/révocation de consentement, export de données, soumission de KYC, etc.) sont enregistrées dans une table `AuditLog` durcie :
* **Chaînage Cryptographique SHA-256** : Chaque log contient le hash du log précédent, empêchant toute altération rétroactive.
* **Verrouillage Concurrentiel** : L'écriture utilise un verrou consultatif PostgreSQL (`pg_advisory_xact_lock`) pour éviter les forks de chaîne de hash en écriture concurrente (multi-workers).
* **Triggers de Base de Données** : Trois triggers PostgreSQL interdisent formellement les opérations d'**UPDATE**, de **DELETE** et de **TRUNCATE** sur la table d'audit.

### 4.3 Chiffrement des Données & Durcissement Technique
* **Données de Santé Chiffrées au Repos** : Chiffrement symétrique AES-256-GCM avec vecteur d'initialisation (IV) aléatoire unique par enregistrement et vérification de tag d'intégrité, basé sur une clé maître (`HEALTH_ENCRYPTION_KEY`) stockée de manière sécurisée en dehors de la base de données.
* **Secrets d'Intégration Chiffrés** : Les clés des API tierces (FedaPay, Twilio, etc.) configurées via le back-office sont stockées chiffrées en base, masquées dans l'interface (affichage write-only avec les 4 derniers caractères) et jamais journalisées.
* **Refresh Token Sécurisé** : Le refresh token de session (valable 30 jours) est stocké exclusivement dans un cookie HTTP-Only sécurisé (`HttpOnly; SameSite=Strict; Secure`). Le frontend ne manipule que l'access token en mémoire vive (durée de vie ≤ 15 min), bloquant ainsi les risques de vol de session par faille XSS.
* **Suspension Fail-Safe** : La suspension d'un compte utilisateur est réévaluée à chaque renouvellement d'access token (refresh) et lors de la validation OTP, garantissant un blocage effectif et rapide.

---

## 5. Spécificités PWA, Offline-First & Accessibilité

L'application a été pensée pour être inclusive et utilisable dans les conditions les plus rudes de connectivité rurale ou de handicap technologique.

### 5.1 Architecture Offline-First
* **Service Worker Agile** : Le service worker de la PWA met en cache l'App Shell, les feuilles de style et les motifs visuels. Il n'intercepte que les requêtes `GET` statiques et exclut formellement les routes `/api/` pour éviter de stocker des données de santé sensibles de manière non sécurisée sur le cache du navigateur.
* **File d'Attente IndexedDB** : Les actions effectuées en mode déconnecté (saisie de constantes cliniques, suivi de prise de médicaments, triage) sont enregistrées localement dans une file d'attente chiffrée en IndexedDB, puis synchronisées automatiquement dès le retour du réseau.
* **SOS Résilient** : En cas d'urgence en zone blanche, le bouton SOS de l'application bascule automatiquement sur un **envoi de SMS de repli** contenant les coordonnées de géolocalisation GPS vers le numéro d'urgence configuré.

### 5.2 Accessibilité & Design "Wax & Terre" v2
L'interface graphique de DigiSanté Mobile est le fruit d'une recherche ergonomique poussée combinant l'identité visuelle béninoise et des standards stricts d'accessibilité (WCAG 2.4.7) :
* **Wax & Terre** : Un univers graphique chaleureux basé sur une couleur de fond crème, des motifs d'inspiration africaine (Bogolan, Wax, Kenté) encodés à 100 % en CSS/SVG natif (zéro image bitmap pour économiser la bande passante), et des coutures décoratives.
* **Thématisation par Espace** :
  * Vert (`sante-600`) pour le Patient.
  * Bleu nuit / Indigo (`indigo-600`) pour le Médecin PRO.
  * Or / Ocre (`ocre-400`) pour la Diaspora, la Pharmacie et le Laboratoire.
  * Indigo nuit / Terre (`terre-500`) pour l'Administration.
* **Accessibilité Senior & Rurale (a11y)** :
  * Polices dimensionnées en `rem` (respect des réglages système de taille de texte pour les personnes malvoyantes).
  * Neutralisation des animations de transition (`animate-pulse` des skeletons de chargement) si l'utilisateur a activé l'option système de réduction des mouvements (`prefers-reduced-motion`).
  * Anneau de focus en `ring-inset` pour éviter que les éléments graphiques stylisés (`card-pagne` à coins coupés à 18°) ne masquent l'indicateur d'accessibilité clavier.
  * **Anti-zoom iOS** : Taille de police des champs de saisie (inputs) ≥ 16px pour interdire le zoom automatique d'iOS Safari au focus, qui brise le layout mobile.

---

## 6. Gestion des Langues, i18n & Phrasier Médical

### 6.1 Un Périmètre de 4 Langues
DigiSanté est entièrement traduit en 4 langues : **Français, Anglais, Fɔ̀ngbè et Yorùbá**.
* **Traductions Humaines & Validées** : Le français sert de source de vérité. L'anglais est complet. Les traductions en langues locales (Fɔ̀ngbè / Yorùbá) ont été pré-traduites localement par IA (modèle NLLB-200 exécuté en local, sans appel API tiers) puis **obligatoirement révisées par des locuteurs natifs**.
* **Double Validation d'i18n** : Les clés critiques de messages (alertes SOS, consignes labo, informations de paiement) exigent une double validation linguistique pour écarter tout risque de mauvaise interprétation médicale.
* **Synthèse Vocale Locale** : L'application intègre une lecture vocale (TTS) pour les conseils santé, l'orientation de triage et les consignes d'ordonnances, particulièrement précieuse pour les utilisateurs à faible littératie.

### 6.2 Phrasier Médical Embarqué (Communication Trans-linguistique)
Pour briser la barrière de la langue lors des consultations et des chats en direct :
* **100 % Local** : Le phrasier médical (`phrasebook.ts`) embarque ~28 phrases types couvrant les salutations, la description des symptômes, les consignes cliniques, la posologie, le suivi et les cas d'urgence.
* **Zéro Tiers, Zéro Fuite** : Aucune donnée de chat n'est envoyée à un traducteur automatique en ligne (respect de la confidentialité de la donnée de santé et fonctionnement hors-ligne).
* **Principe d'Insertion** : Le patient ou le médecin choisit une phrase prédéfinie dans sa langue, et l'application insère directement la version traduite correspondante dans la langue cible du destinataire.

### 6.3 Appariement Renforcé par la Langue
Dans l'annuaire des professionnels de santé, les médecins parlant la langue du patient (`spokenLangs ∋ patient.lang`) sont **remontés en tête de liste** avec un badge distinctif « Parle votre langue ». En cas d'absence de médecin parlant sa langue, un écran d'aide oriente l'utilisateur vers l'utilisation du phrasier médical pour faciliter l'échange.

---

## 7. Architecture d'Intégration & Services Tiers

DigiSanté Mobile orchestre un ensemble d'intégrations de pointe, gérables de manière dynamique par le Super Administrateur via l'interface d'administration :

| Service Tiers | Rôle Fonctionnel | Mode Fallback / Résilience |
|---|---|---|
| **FedaPay** | Encaissements Mobile Money (MTN, Moov, Wave) et cartes internationales. Wallet Diaspora. | Mode stub local en cas d'absence de clé ; réconciliation quotidienne à 02:30. |
| **Daily.co** | Téléconsultation vidéo WebRTC privée et sécurisée. | Dégradation automatique en audio ou chat temps réel WebSocket si le réseau faiblit. |
| **Twilio** | Envoi des OTP SMS, alertes critiques de laboratoire, rappels de soins et SOS SMS. | Fallback sur numéros longs si l'ID d'expéditeur alphanumérique est bloqué par l'opérateur local. |
| **Resend** | Envoi des emails transactionnels (factures diaspora, confirmations KYC). | Logs d'erreur et stubs en développement. |
| **Firebase FCM** | Notifications push temps réel sur mobile et navigateur (Web Push Token). | Purge automatique des tokens FCM rejetés (`UNREGISTERED`) en base pour préserver la qualité de la base. |

---

## 8. Flux Fonctionnels Traversants (De Bout en Bout)

Pour comprendre la puissance de DigiSanté, voici les trois parcours utilisateurs traversants majeurs modélisés dans l'application :

### 8.1 Parcours 1 : L'Auto-Mesure, le Triage et la Consultation Réseau
```
[Patient (Hors-ligne)]
   │ Saisie d'une constante (Tension élevée)
   ▼
[IndexedDB (Stockage local)]
   │ Retour du réseau mobile
   ▼
[Serveur Fastify / Sync] ──(Notification Push/SMS)──▶ [Médecin PRO]
   │ Saisie du triage OMS (Signe ORANGE)                │ Reçoit l'alerte
   ├────────────────────────────────────────────────────┘
   ▼
[Téléconsultation WebRTC (Daily.co)]
   │ Perte brutale de bande passante (Réseau rual 2G)
   ▼
[Bascule automatique en Chat WebSocket chiffré]
   │ Utilisation du Phrasier Médical (Français ◀─▶ Fɔ̀ngbè)
   ▼
[Prescription d'une ordonnance en DCI]
```

### 8.2 Parcours 2 : La Boucle Ordonnance - Dispensation - Pharmacie
```
[Médecin PRO]
   │ Rédige une ordonnance en DCI (Prescription assistée)
   │ Signe numériquement (Inclusion du N° CNOM)
   ▼
[Patient (PWA)]
   │ Reçoit l'ordonnance dans son espace DMP personnel
   │ Génère un QR Code d'ordonnance local (Chiffré)
   ▼
[Pharmacie de quartier]
   │ Scanne le QR Code (Validation d'authenticité locale)
   │ Vérifie le stock de médicaments local ("Médicament près de moi")
   │ Dispense de manière granulaire (Ligne par ligne selon budget)
   ▼
[DMP Patient mis à jour (Dispensation enregistrée)]
```

### 8.3 Parcours 3 : La Solidarité Diaspora & Le Wallet
```
[Diaspora (Europe)]
   │ Ajoute son proche résidant au Bénin dans son Roster
   │ Recharge son Wallet en Euros (FedaPay / Carte bancaire)
   ▼
[FedaPay Webhook (Signé HMAC)]
   │ Vérification d'idempotence & Crédit du Wallet Diaspora (XOF)
   ▼
[Patient (Bénin)]
   │ Réserve une consultation avec un médecin vérifié
   ▼
[Wallet Diaspora]
   │ Débit atomique du montant de la consultation (Anti-double dépense)
   │ Notification de confirmation à la Diaspora
   ▼
[Remboursement / Annulation (Si applicable)]
   │ Annulation du rendez-vous par le médecin
   │ Reversal interne (Crédit du wallet sans frais d'opérateur)
```

---

## 9. Conclusion & Recommandations Produit

### 9.1 Force du Système Actuel
DigiSanté Mobile est une application d'une maturité fonctionnelle remarquable pour un projet soutenu par une subvention de cette envergure. L'intégration de la philosophie **offline-first**, du respect strict de la **loi APDP (consentement par entrée, audit immuable, cloisonnement)**, et l'introduction du rôle d'**Agent de Santé Communautaire (ASC)** en font une solution parfaitement calibrée pour l'écosystème médical béninois, tant en milieu urbain qu'en milieu rural enclavé.

### 9.2 Recommandations pour la Phase de Pilote (V2)
Pour consolider le succès de la phase de déploiement en production sur le VPS Infomaniak :
1. **Lien de Compte ASC / Consentement** : En v2, faire évoluer le rôle de l'ASC (actuellement en Modèle A "relais aveugle") vers un modèle de consentement scindé (Modèle B), permettant à l'ASC de prendre des rendez-vous au nom du patient en liant de manière sécurisée leurs comptes respectifs.
2. **Vetting Géographique des ASC** : Limiter la capacité de signalement des ASC aux seuls médecins de leur zone d'affectation pour éviter tout risque de spam des soignants à l'échelle nationale.
3. **Optimisation des Batchs de Notification** : Lors de l'envoi de campagnes de veille sanitaire d'envergure (fan-out massif), implémenter un système de file d'attente asynchrone par curseur (batching) pour lisser la charge sur le serveur Fastify et l'API Twilio/FCM.
4. **Validation Clinique Formelle** : S'assurer de la signature physique ou numérique du `Dossier_Validation_Clinique.docx` par les autorités médicales béninoises (ministère ou ONMB) avant l'enrôlement du tout premier patient réel sur la plateforme.

---
*Fin du document de revue fonctionnelle. Validé pour le projet DigiSanté Mobile — Juillet 2026.*
