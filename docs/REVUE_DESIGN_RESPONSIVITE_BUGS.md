# Revue Technique : Responsivité, Intégration du Design & Audit des Écrans

> **Projet** : DigiSanté Mobile — PWA e-santé pour le Bénin
> **Date de l'audit** : Juillet 2026
> **Objectif** : Analyser l'implémentation de la responsivité mobile/desktop, la fidélité visuelle au Design System « Wax & Terre » v2, et identifier les points de friction, risques d'expérience utilisateur (UX) ou bugs potentiels sur chaque écran de la plateforme.

---

## 1. Analyse de l'Architecture de la Responsivité

DigiSanté Mobile est conçu pour s'adapter dynamiquement aux environnements mobiles d'Afrique de l'Ouest (smartphones d'entrée de gamme, connexions instables, navigateurs variés) tout en offrant une densité d'information riche sur desktop pour les rôles professionnels.

### 1.1 Coquilles Adaptatives (Shells)
* **`AppShell` (Espaces Patient, Médecin, Pharma, Labo, Diaspora)** :
  * **Sur Mobile (`<lg`)** : Conteneur centré contraint à un cadre de type téléphone (`max-w-[420px]`). Barre de navigation basse (`BottomNav`) avec boutons tactiles et bouton d'action flottant (FAB).
  * **Sur Desktop (`≥lg`)** : Affichage plein écran élargi à un format grille (`max-w-5xl`). La navigation basse se replie au profit d'une barre de navigation horizontale haute (`TopNav`), exploitant l'espace horizontal pour les fiches ou listes en colonnes.
* **`AdminShell` (Espace Back-Office)** :
  * **Sur Mobile (`<lg`)** : Affichage identique en cadre `max-w-[420px]` redirigeant vers un menu mobile complet (`/admin/menu`) pour éviter l'encombrement.
  * **Sur Desktop (`≥lg`)** : Sidebar latérale gauche persistante de 260px (`bogolan-dark`), habillée d'un fond indigo nuit dégradé, libérant le reste de la largeur pour un affichage tabulaire dense de gestion.

### 1.2 Gestion du Viewport et des Hauteurs
* **Problématique mobile** : L'utilisation classique de `min-h-screen` (100vh) provoque des coupures de bas de page et des débordements sous Safari iOS et Chrome Android en raison des barres d'adresse URL dynamiques.
* **Solution technique** : Remplacement systématique de `min-h-screen` par la classe utilitaire **`.min-h-dvh-screen`** (Dynamic Viewport Height - `100dvh` avec repli `100vh`). Cela garantit que la navigation basse (`BottomNav`) reste toujours visible et calée en bas de l'écran tactile sans chevauchement ni défilement parasite.

### 1.3 Typographie et Zoom Mobile
* **Anti-Zoom iOS (Focus)** : Sur Safari Mobile, si un champ de saisie (`<input>` ou `<select>`) possède une taille de police inférieure à 16px, le navigateur effectue un zoom automatique intrusif au focus, cassant l'alignement de la PWA.
* **Solution technique** : Application d'une taille de police minimale de **16px (1rem)** sur l'intégralité des champs du formulaire dans `globals.css` et vérification des tailles locales.
* **Polices Relatives** : Toutes les polices de caractères sont exprimées en unités relatives **`rem`** (`text-[(N/16)rem]`), respectant le paramètre d'accessibilité de taille de texte choisi par l'utilisateur (public senior).

---

## 2. Intégration du Design : "Wax & Terre" v2

La charte graphique est un hommage à la culture béninoise à travers des éléments texturés, tout en préservant une performance réseau maximale.

* **Zéro Bitmap** : Les motifs Bogolan, Wax et Kenté ne sont pas des fichiers images (.png/.jpg) lourds à charger. Ils sont encodés en **CSS/SVG data-URI** purs, inlinés localement. Performance 2G/3G optimale.
* **Asymétrie "Fait Main"** : Les boutons et les cartes utilisent la classe `.card-pagne` avec des coins coupés à 18° et des ombres dures. Des rotations aléatoires de ±1° à 3° (`rotate-1`, `-rotate-1`, `rotate-2`) accentuent le style artisanal, combinées à des coutures `.stitch`.
* **Focus Accessibilité (WCAG 2.4.7)** :
  * L'effet de rognage CSS de `.card-pagne` masquait l'anneau de focus par défaut lors de la navigation au clavier.
  * L'application applique désormais un anneau de focus **`focus-visible:ring-inset`** qui reste visible à l'intérieur de la carte coupée.
* **Réduction de Mouvements (a11y)** : Les squelettes de chargement (`SkeletonCards`) désactivent leur pulsation d'animation (`animate-pulse`) si l'option système `prefers-reduced-motion` est active.

---

## 3. Revue Écran par Écran & Relevé de Points de Vigilance (Bugs Potentiels)

### 3.1 Écran de Connexion & Onboarding (`/onboarding`, `/login`)
* **Responsivité** : Formulaire centré et parfaitement proportionné sur mobile. Sur desktop, le formulaire est encadré dans un volet vertical élégant pour éviter l'étirement des champs de saisie.
* **Points de vigilance / Risques de bugs** :
  1. **Envoi multiple d'OTP** : Si l'utilisateur clique frénétiquement sur "Renvoyer l'OTP", cela peut saturer le forfait Twilio. *Sécurité en place* : Limitation stricte de quota d'envoi OTP gérée dans Redis (bloqué pendant 30 minutes après 5 envois).
  2. **Verrouillage OTP au refresh** : (Précédemment corrigé) Un compte suspendu pouvait contourner la suspension via le refresh token. Désormais, le refresh relit directement l'état de suspension en DB.

### 3.2 Espace Patient : Dashboard & DMP (`/patient`, `/patient/dmp`)
* **Responsivité** : Grille de cartes d'actions rapides sur mobile. Sur desktop, passage en colonnes asymétriques (DMP à gauche, raccourcis et constantes de santé à droite).
* **Points de vigilance / Risques de bugs** :
  1. **Consommation mémoire des graphes de constantes** : Les graphes de constantes vitales (tension, poids) sont dessinés en SVG pur sans bibliothèque lourde pour préserver la légèreté de la PWA. *Risque* : Si l'historique contient des milliers de points de données, le SVG peut ralentir l'affichage mobile. *Atténuation* : Une pagination ou un filtre temporel (7 jours, 30 jours, 1 an) doit être imposé côté API lors de la projection.

### 3.3 Triage et Orientation Clinique (`/patient/triage`)
* **Responsivité** : Écrans d'arbre décisionnel étape par étape avec de grands boutons tactiles card-pagne, adaptés à l'usage à une main sur mobile.
* **Points de vigilance / Risques de bugs** :
  1. **Synthèse vocale (TTS) bloquée** : La lecture audio des consignes de triage (Fɔ̀ngbè, Yorùbá, Français) utilise l'API Web Speech du navigateur. Sur certains téléphones Android d'entrée de gamme ou navigateurs alternatifs, le moteur TTS local peut manquer de voix françaises ou ne pas prendre en charge la lecture automatique sans interaction préalable. *Atténuation* : L'activation de la voix est conditionnée à un clic explicite de l'utilisateur sur une icône de haut-parleur.

### 3.4 SOS Urgences (`/patient/sos`)
* **Responsivité** : Bouton d'urgence géant en forme d'octogone rouge, centré.
* **Points de vigilance / Risques de bugs** :
  1. **Permissions de Géolocalisation** : Le SOS envoie les coordonnées GPS du patient. Si l'utilisateur refuse la permission GPS du navigateur ou si le signal GPS est trop faible dans un bâtiment en zone rurale, le script pourrait flaker. *Solution de résilience* : Un mécanisme de repli (fallback) permet d'envoyer le SMS SOS avec le numéro d'urgence national et le nom d'utilisateur, même sans coordonnées géographiques.

### 3.5 Santé Maternelle / CPN (`/patient/maternity`)
* **Responsivité** : Calendrier des 8 contacts d'accouchement OMS sous forme de frise chronologique verticale (timeline) sur mobile, s'étendant en tableau d'objectifs cliniques sur desktop.
* **Points de vigilance / Risques de bugs** :
  1. **Saisie erronée de la LMP** : La date des dernières règles (LMP) sert à calculer la date d'accouchement (LMP + 280 jours). Si l'utilisateur saisit une date dans le futur ou incohérente, les calculs de calendrier CPN échouent. *Atténuation* : Validation Zod stricte sur l'API (`apps/api`) rejetant les dates de règles postérieures à la date du jour ou antérieures à 300 jours.

### 3.6 Vaccination PEV (`/patient/vaccinations`)
* **Responsivité** : Liste des vaccins organisée par âges cibles (Naissance, 6 semaines, etc.). Badge de statut de couleur (Vert: Fait, Orange: En attente, Rouge: En retard).
* **Points de vigilance / Risques de bugs** :
  1. **Décalage d'âge et génération de dates** : Le calendrier PEV génère des échéances de vaccination basées sur la date de naissance. Si la date de naissance du sujet est modifiée ultérieurement, toutes les échéances générées non marquées comme complétées doivent être recalculées. *Risque* : Ne pas mettre à jour ces échéances en cascade. *Vérification* : Le service de vaccination recalcule les échéances à la mise à jour de la date de naissance du sujet.

### 3.7 Recherche de Médicaments ("Médicament près de moi" — `/patient/pharmacy`)
* **Responsivité** : Barre de recherche supérieure avec filtres rapides, affichant les pharmacies sous forme de cartes d'inventaire triées par distance Haversine.
* **Points de vigilance / Risques de bugs** :
  1. **Dump d'inventaire commercial via jokers SQL** : (Corrigé lors du dernier correctif de sécurité CSO) Une recherche sur le nom du médicament avec des caractères spéciaux (comme `%` ou `_`) pouvait bypasser le filtre de longueur et dumper l'intégralité du catalogue d'inventaire de toutes les pharmacies. *Solution* : `normalizeMed` échappe et nettoie désormais tous les jokers SQL, neutralisant l'injection.

### 3.8 Espace Médecin PRO : Consultation & Prescription (`/pro/agenda`, `/pro/prescribe`)
* **Responsivité** :
  * Mobile : Vue simplifiée de l'agenda quotidien, saisie rapide de l'ordonnance.
  * Desktop : Interface double-colonne très riche. À gauche, la vue DMP 360° du patient (soumise à consentement) ; à droite, le pavé d'édition de la prescription en temps réel.
* **Points de vigilance / Risques de bugs** :
  1. **Déconnexion de la téléconsultation Daily.co** : En cas de coupure de réseau pendant la visio, le médecin peut rester bloqué sur l'écran d'appel. *Solution de résilience* : Un écouteur de qualité de réseau bascule automatiquement l'interface sur un salon de chat textuel WebSocket léger, permettant de finaliser la prescription sans perdre l'échange.

### 3.9 Espace Pharmacie : Scan & Dispensation (`/pharmacie`)
* **Responsivité** : Adapté aux écrans de smartphones pour scanner facilement l'ordonnance d'un patient à l'aide de l'appareil photo intégré.
* **Points de vigilance / Risques de bugs** :
  1. **Caméra non détectée sur iOS Safari** : iOS Safari restreint l'accès à la caméra (`BarcodeDetector` indisponible). *Solution de résilience* : Utilisation d'un import dynamique de la bibliothèque pure-JS **`jsQR`** comme moteur de décodage de secours, et d'un champ de saisie manuelle du matricule d'ordonnance en dernier recours.

### 3.10 Espace Laboratoire : Saisie de Résultats (`/labo`)
* **Responsivité** : File d'attente globale anonymisée. Formulaire de saisie des résultats d'analyses structurés sous forme de tableau responsive.
* **Points de vigilance / Risques de bugs** :
  1. **Validation des seuils de valeurs critiques** : La saisie manuelle de valeurs numériques aberrantes par le laborantin (ex. un zéro en trop) peut déclencher à tort l'alerte d'urgence `LAB_CRITICAL` par SMS/Push. *Atténuation* : Une validation de limites physiques raisonnables (ex. glycémie impossible > 1000 mg/dL) doit être ajoutée côté Zod frontend pour demander confirmation avant validation.

### 3.11 Espace Diaspora : Gestion de Bénéficiaires (`/diaspora`)
* **Responsivité** : Formulaire de CRUD de bénéficiaires asymétrique, parfaitement responsive.
* **Points de vigilance / Risques de bugs** :
  1. **Double-dépense sur Wallet Diaspora** : (Corrigé lors du correctif de l'audit principal) Deux requêtes de débit concurrentes sur un même wallet diaspora pouvaient l'amener à un solde négatif. L'implémentation de la décrémentation atomique DB (`balance: { gte: amount }`) résout définitivement ce problème.

### 3.12 Espace Admin : KYC & Integrations (`/admin/kyc`, `/admin/integrations`)
* **Responsivité** : Layout dense de type tableau de bord de bureau sur grand écran (`AdminShell`). Sur mobile, les colonnes des tables se replient automatiquement en accordéons ou en cartes d'audit individuelles.
* **Points de vigilance / Risques de bugs** :
  1. **Secrets d'intégration affichés par inadvertance** : Lors de la consultation de l'onglet de configuration des API tierces (Twilio, Resend, Daily), les clés ne doivent jamais être exposées dans les paquets JSON du réseau ou dans l'HTML. *Sécurité en place* : L'API ne renvoie jamais les clés en clair au client (elle renvoie uniquement un état `configuré: true` et les 4 derniers caractères pour vérification). La modification se fait en écriture seule (`write-only`).

---

## 4. Synthèse des Recommandations Techniques de Finition

Pour parfaire l'intégration et la responsivité de la version de production (V1.30+) :
1. **Cache des motifs visuels (Service Worker)** : Assurer que les motifs Bogolan et Kenté, bien qu'injectés en CSS data-URI, ne provoquent aucun recalcul de style lourd (`reflow`) lors de la navigation dynamique. Les encapsuler dans des classes CSS hautement isolées.
2. **Bornage de l'Historique des Constantes** : Ajouter systématiquement un filtre de sélection temporelle par défaut (par exemple, "30 derniers jours") sur l'affichage des graphes du DMP pour éviter les surcharges de mémoire sur les navigateurs mobiles d'entrée de gamme.
3. **Double Confirmation des Valeurs Critiques (Labo)** : Ajouter une boîte de dialogue modal stylisée (`ConfirmDialog`) dans l'espace Laboratoire si la valeur saisie déclenche le protocole critique `LAB_CRITICAL`, afin de s'assurer qu'il ne s'agit pas d'une erreur de frappe.

---
*Rapport technique établi pour le projet DigiSanté Mobile — Juillet 2026.*
