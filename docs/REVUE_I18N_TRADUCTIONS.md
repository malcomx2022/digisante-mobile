# Revue Technique : Système d'Internationalisation (i18n) & Traduction Multilingue

> **Projet** : DigiSanté Mobile — PWA e-santé pour le Bénin
> **Date de l'audit** : Juillet 2026
> **Objectif** : Auditer l'architecture technique d'i18n, le niveau de complétude des traductions (Français, Anglais, Fɔ̀ngbè, Yorùbá), le protocole de double validation des clés critiques, et identifier les bugs potentiels ou risques de parité linguistique.

---

## 1. Architecture Technique de l'i18n

DigiSanté Mobile s'appuie sur une architecture d'internationalisation unifiée et partagée entre le frontend (Next.js) et le backend (Fastify) pour garantir une expérience utilisateur cohérente à travers 4 langues.

### 1.1 Invariants Structuels
* **Alignement avec la Base de Données** : Les 4 langues supportées (**`FR`**, **`EN`**, **`FON`**, **`YOR`**) sont définies de manière stricte dans l'enum Prisma `Lang`.
* **Règle d'or** : Aucune chaîne de caractères utilisateur (UI) n'est écrite en dur dans le code. Toutes les chaînes passent par le dictionnaire plat de clés `namespace.key` (`packages/shared/src/i18n.ts`).
* **Les Namespaces** : Le système de traduction est divisé en **18 namespaces** (`common`, `onboarding`, `auth`, `dmp`, `sos`, `payments`, etc.) pour structurer les fichiers et optimiser le chargement.
* **Résilience du Fallback** : La langue par défaut est le **Français (`FR`)**. En cas de clé manquante dans une langue (ex: Fɔ̀ngbè), le système applique la cascade de repli suivante :
  $$\text{Langue Cible (ex: FON)} \longrightarrow \text{Français (FR)} \longrightarrow \text{Clé brute en clair (ex: namespace.key)}$$
  Cela garantit que l'application ne plante jamais et n'affiche jamais d'écran vide en cas d'omission.

---

## 2. État d'Avancement des Traductions par Langue

### 2.1 Le Français (FR) — 100 % Opérationnel
* **Statut** : Source de vérité absolue du projet.
* **Validation** : Toutes les formulations cliniques et opérationnelles proviennent des cahiers de charges officiels validés par le porteur de projet.

### 2.2 L'Anglais (EN) — 100 % Opérationnel
* **Statut** : Entièrement traduit et complet.
* **Validation** : Parité totale avec le dictionnaire français. Couverte par les tests automatisés du package shared.

### 2.3 Le Fon (Fɔ̀ngbè — FON) — ~15 % (Clés clés) & Repli FR
* **Statut** : Traduction partielle axée sur le socle fonctionnel (salutations, types de profils, actions clés d'authentification) pour la démonstration. Le reste du dictionnaire s'appuie sur le repli français.
* **Méthode** : 1er jet généré hors-ligne par IA locale (modèle **NLLB-200** exécuté sur machine de dev pour des raisons de confidentialité médicale et de souveraineté des données, cf. CLAUDE.md §8) puis soumis à relecture par des locuteurs natifs.
* **Spécificité d'Oralité** : Le Fon est marqué d'une métadonnée `hasAudio: true` dans `LANGUAGE_META`. Les contenus clés (triage clinique, conseils de santé) intègrent une **lecture vocale native** (synthèse vocale) pour surmonter le taux d'analphabétisme élevé en milieu rural.

### 2.4 Le Yoruba (Yorùbá — YOR) — ~5 % (Socle d'interface) & Repli FR
* **Statut** : Traduction au niveau des rôles de base et de la salutation de bienvenue. Le reste du dictionnaire s'appuie sur le repli français.
* **Méthode** : Même pipeline que le Fon (NLLB-200 local + relecture humaine). Pas de support audio activé pour l'instant (`hasAudio: false`).

---

## 3. Le Protocole de Double Validation des Clés Critiques (DT-3)

Une erreur de traduction sur un écran clinique ou financier peut avoir des conséquences graves (mauvaise posologie de médicament, mauvaise orientation de secours, erreur sur un montant financier).

Le projet isole **3 namespaces critiques** exigeant une **double validation obligatoire** de traduction par deux relecteurs humains habilités avant toute publication en production :
1. **`sos`** : Messages et consignes d'alerte d'urgence.
2. **`labo`** : Seuils et notifications de résultats critiques.
3. **`payments`** : Instructions de Mobile Money, commissions et transactions wallet.

---

## 4. Analyse de l'Outillage i18n d'Automatisation

La robustesse de la gestion multilingue repose sur trois scripts d'outillage :
* **`pnpm i18n:check`** : Scanne l'ensemble des fichiers de clés et vérifie la parité de couverture entre l'anglais et le français. Fait échouer la CI en cas d'écart (garantie de parité FR/EN).
* **`pnpm i18n:export`** : Extrait toutes les clés manquantes pour les langues locales dans un fichier CSV standardisé destiné aux relecteurs et traducteurs professionnels.
* **`pnpm i18n:draft`** : Lance le pipeline de traduction automatique NLLB-200 en local pour générer les propositions initiales de Fon/Yoruba à intégrer au format CSV.

---

## 5. Relevé de Bugs, Risques & Vigilances Linguistiques

### 5.1 Barrière de Compréhension sur les Écrans Cliniques complexes (Friction Majeure)
* **Constat** : Bien que l'application soit techniquement compatible avec le Fon et le Yoruba, l'absence de traduction complète des questions complexes de triage (`triage.q.*`) et des objectifs de visites prénatales (`maternity.objective.*`) dans ces deux langues force l'interface à afficher ces chaînes en **Français** chez un patient ayant pourtant sélectionné le Fɔ̀ngbè.
* **Risque** : Un relais communautaire ou un patient non francophone se retrouve bloqué devant une question médicale capitale en français, risquant une mauvaise orientation ou une mauvaise saisie.
* **Atténuation en place** : L'appariement renforcé et le phrasier médical permettent de mitiger cette barrière dans le chat de consultation, mais le triage autonome reste vulnérable.
* **Recommandation** : Prioriser la traduction complète par des natifs du namespace `triage` et `maternity` en Fon et Yoruba.

### 5.2 Prononciation Robotique de la Synthèse Vocale
* **Constat** : Pour les langues locales (FON/YOR), l'application s'appuie sur l'API Web Speech du navigateur. Or, la majorité des navigateurs mobiles d'entrée de gamme ne possèdent pas de voix native Fɔ̀ngbè ou Yorùbá, et utilisent une voix française (`fr-FR`) ou anglaise pour épeler ou lire phonétiquement les phrases locales.
* **Risque** : Rendu sonore inintelligible, voire risible, dégradant la confiance de l'utilisateur.
* **Solution technique recommandée** : Pour une V2, remplacer la synthèse vocale client du navigateur par des **fichiers audio pré-enregistrés (MP3 légers)** hébergés localement pour chaque phrase du triage et du phrasier, assurant une parfaite authenticité de diction.

### 5.3 Nettoyage d'Enum suite au Retrait du Baatɔnum/Dendi
* **Historique** : En juin 2026, le périmètre linguistique a été recentré en retirant le Baatɔnum et le Dendi pour ajouter le Yoruba.
* **Risque de bug de migration** : Si des utilisateurs ont été enregistrés avec la langue `BARIBA` ou `DENDI` en base de données avant cette date, la modification de l'enum PostgreSQL plantera ou créera des erreurs de désérialisation.
* **Vérification** : La migration `..._lang_fr_en_fon_yor` intègre une étape de repli automatique en SQL faisant basculer les anciens comptes `BARIBA`/`DENDI` vers `FR` avant de supprimer définitivement ces types de l'enum PostgreSQL. Risque éliminé.

---
*Rapport d'audit i18n établi pour le projet DigiSanté Mobile — Juillet 2026.*
