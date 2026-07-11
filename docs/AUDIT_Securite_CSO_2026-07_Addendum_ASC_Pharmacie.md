# Addendum audit CSO — modules ASC & stock pharmacie (juillet 2026)

> **Objet** : passe de sécurité ciblée (OWASP Top 10 + STRIDE) sur les **nouveaux modules** livrés
> après l'audit CSO principal (`AUDIT_Securite_CSO_2026-07.md`) :
> - **Agent de Santé Communautaire (ASC)** — `modules/asc/*` (roster + observations + signalement) ;
> - **« Médicament près de moi »** — `modules/pharmacy/pharmacy.stock.ts` (stock + recherche patient).
>
> **Méthode** : lecture intégrale des services + routes, preuves `fichier:ligne`, focus §4
> (cloisonnement, pas de DMP) et injections (Prisma/LIKE). Rien n'est rapporté sans preuve.

---

## Synthèse

| # | Sévérité | Module | Constat | Statut |
|---|---|---|---|---|
| P1 | MOYEN | Pharmacie | `contains` (SQL `LIKE`) sans échappement des jokers `%`/`_` → une recherche `%` dumpe tout l'inventaire | ✅ **Corrigé** |
| A1 | FAIBLE | ASC | ASC auto-inscrit peut signaler (`relay`) n'importe quel médecin vérifié → vecteur de spam | ⏸ **Résiduel** (vetting opérationnel) |
| A2 | INFO | ASC | Cloisonnement §4 par `ascId`, aucune lecture DMP — **conforme par conception** | ✅ Vérifié |
| P2 | INFO | Pharmacie | Cloisonnement par `pharmacyId` (403/404), recherche patient authentifiée — **conforme** | ✅ Vérifié |

---

## Corrigé dans ce lot

### P1 — Injection de joker `LIKE` dans la recherche de stock *(MOYEN)*

**Constat.** `searchAvailability` construit un filtre Prisma
`medicationName: { contains: needle }` (`pharmacy.stock.ts`). Prisma compile `contains` en SQL
`LIKE '%needle%'` **sans échapper** les métacaractères `LIKE` `%` (n'importe quelle séquence) et
`_` (un caractère). Une requête `GET /pharmacy/availability?q=%` produisait `LIKE '%%%'`,
c'est-à-dire **« tout »** → l'endpoint renvoyait l'inventaire (statut ≠ OUT) de **toutes les
pharmacies**, avec leurs coordonnées. Ce n'est pas une fuite de données médicales (§4 : le stock est
de l'inventaire, pas du DMP), mais une **fuite d'exhaustivité commerciale** non voulue et un
contournement du seuil `needle.length < 2`.

**Correctif** (`normalizeMed`, `pharmacy.stock.ts`) : la normalisation retire désormais les
métacaractères `LIKE` **et** l'échappement (`.replace(/[%_\\]/g, '')`), en plus de la mise en
minuscules / suppression d'accents. Appliqué **à la fois** au besoin de recherche et aux noms
stockés (cohérence de la clé `pharmacyId_medicationName`). Une recherche `%` ou `_` se réduit à une
chaîne vide → tombe sous le seuil `< 2` → **0 résultat**.

**Tests** :
- unitaire pur (`pharmacy.rules.test.ts`) : `normalizeMed('%') === ''`, `normalizeMed('parac%') === 'parac'`, `a_b\c → abc` ;
- intégration (`pharmacy.stock.test.ts`) : `?q=%25` (`%`) et `?q=_` renvoient **0 item** (l'inventaire n'est pas dumpé).

---

## Résiduel — décision opérationnelle

### A1 — Signalement ASC → n'importe quel médecin vérifié *(FAIBLE)*

**Constat.** `relayToDoctor` (`asc.service.ts`) exige (a) que le bénéficiaire appartienne à l'ASC
(cloisonnement OK) et (b) que le destinataire soit un **médecin vérifié** (`verifiedAt != null`),
puis crée une `Notification`. Il n'y a **pas** de relation préalable ASC↔médecin : un ASC
auto-inscrit peut donc envoyer un signalement à **tout** médecin vérifié de la plateforme →
**vecteur de spam / nuisance** ciblant les soignants.

**Facteurs atténuants déjà en place** :
- le **rate-limit Redis global** (`@fastify/rate-limit`, partagé inter-workers) borne le débit ;
- le contenu partagé est **strictement opérationnel** (nom, village, message libre borné à 1000 car.) —
  **jamais un DMP** (§4) ; aucune donnée médicale structurée n'est exposée ;
- l'auto-inscription ASC exige un **profil de rôle** (`zone` obligatoire) et reste soumise, comme
  les autres rôles soignants, à une **revue KYC** avant activation opérationnelle.

**Résiduel accepté (v1)** : le filtrage fin (l'ASC ne signale qu'aux médecins de sa zone / à un
médecin référent) relève d'un **vetting opérationnel** (KYC ASC + affectation de zone), pas d'un
correctif de code isolé. **Pistes v2** (déjà notées dans `PLAN_ASC.md`) :
1. restreindre les destinataires aux médecins d'une **même zone géographique** ;
2. journaliser les signalements (compteur par ASC) pour détecter l'abus ;
3. lien de compte patient (accès scindé B par consentement `Consent`) remplaçant le relais aveugle.

---

## Vérifiés — conformes par conception

### A2 — Cloisonnement ASC (§4, « relais aveugle »)

- `ascIdOf` → **403** si l'appelant n'a pas de profil `CommunityHealthWorker` (`asc.service.ts`).
- Toutes les requêtes filtrent par `ascId` ; `ownBeneficiary` / `findFirst({ where: { id, ascId } })`
  → **404** sur le bénéficiaire d'autrui (pas de fuite d'existence exploitable).
- **Aucune** lecture de DMP patient : le modèle est `AscObservation` (constantes/triage/note
  **opérationnelles**), pas un dossier médical. RBAC `requireRole('ASC')` sur toutes les routes.
- Validation d'entrée stricte (`asc.routes.ts`) : bornes numériques (TA, pouls, température, poids),
  `triageOutcome` en enum, chaînes bornées, `id` en `cuid`. `zParse` → **422** sur invalide.

### P2 — Cloisonnement stock pharmacie

- `pharmacyIdOf` → **403** sans profil `Pharmacy` ; `listStock`/`removeStock` filtrent par
  `pharmacyId` (une pharmacie ne voit/supprime que **son** stock).
- Recherche patient **authentifiée** ; ne renvoie que des données d'**inventaire** publiques
  (nom du médicament, statut, prix indicatif, coordonnées publiques de la pharmacie) — **hors §4**.

---

*Références : `AUDIT_Securite_CSO_2026-07.md` (audit principal), `PLAN_ASC.md` (modèle A + v2),
CLAUDE.md §4 (cloisonnement / DMP). Dernière mise à jour : 11 juillet 2026.*
