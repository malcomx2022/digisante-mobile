# Suivi du chantier B5 — test de restauration des sauvegardes

> **Lancé le 2 septembre 2026** · Chantier **B5** de l'état des lieux
> (`docs/ETAT_DES_LIEUX_Finalisation_2026-09.md` §4.5). Principe : *une sauvegarde jamais
> restaurée n'est pas une sauvegarde.* Le chantier se joue en deux temps : une **répétition à
> blanc** qui valide la mécanique des scripts (faite, ci-dessous), puis le **test réel** sur les
> archives de production, qui attend B3 (phase 6 du runbook).

---

## 1. Répétition à blanc — EXÉCUTÉE le 02/09/2026 ✅

Cycle complet **sauvegarde → restauration → contrôle de cohérence**, exécuté avec le **vrai
script** (`infra/deploy/scripts/pg_dump_encrypted.sh`, aucune modification), sur une pile
réelle : PostgreSQL **16.13** natif, base `digisante` vierge migrée (**28 migrations
`migrate deploy`**) + **seed** (5 assureurs) + données de test (8 users, 1 assurance patient),
magasin de fichiers factice (2 fichiers binaires, 200 Ko + 350 Ko), clé AES-256 générée selon
la procédure du script (`openssl rand -base64 48`).

| Étape | Résultat |
|---|---|
| Sauvegarde (script réel, env overridé : `BACKUP_DIR`, `BACKUP_KEY_FILE`, `KYC_STORAGE_DIR`) | ✅ **Deux archives** produites : `digisante_<stamp>.sql.gz.enc` (16 K) **et** `digisante_files_<stamp>.tar.gz.enc` (540 K), permissions `0400` |
| Restauration base (formule documentée en fin de script : `openssl enc -d … \| gunzip \| psql`) dans une base **vierge** `digisante_restore` | ✅ Sans erreur |
| Restauration fichiers (`openssl enc -d … \| gunzip \| tar -x`) dans un répertoire distinct | ✅ 2 fichiers restaurés |
| **Comptage de TOUTES les tables** source vs restaurée (généré dynamiquement depuis `pg_stat_user_tables`) | ✅ **Identiques** (dont `users=8`, `insurances=5`, `patient_insurances=1`) |
| **Checksums SHA-256 des fichiers** source vs restaurés | ✅ Identiques |
| **Trigger d'audit immuable après restauration** : `UPDATE audit_logs` sur la base restaurée | ✅ **Rejeté** (`audit_logs est append-only — CLAUDE.md §4`) — la protection §4 est bien **dans le dump** et renaît avec lui |

**Conclusion de la répétition** : la mécanique est saine de bout en bout — chiffrement/
déchiffrement symétriques, double archive effective, formules de restauration du script
exactes telles quelles, intégrité données + fichiers vérifiée, triggers de conformité
préservés. Aucun correctif nécessaire.

ⓘ Observations : ① le script invoque `sudo -u postgres pg_dump` — il s'exécute donc en root
(c'est le cas du cron de prod) ; ② la base compte désormais **28 migrations** (27 documentées
en août + 1 depuis) — compteurs à rafraîchir à la prochaine passe de documentation.

## 1 bis. Répétition outillée — EXÉCUTÉE le 22/09/2026 ✅ (prompt 14)

Machine tierce = conteneur isolé de Claude Code (jamais la production), PostgreSQL **16** natif.
Base vierge migrée (28 migrations) → **suite API complète** exécutée dessus avec chiffrement
actif (357 tests verts : utilisateurs, paiements, DMP, audit…) → 3 entrées DMP **synthétiques**
avec pièce jointe chiffrée → **vrai script** `pg_dump_encrypted.sh` → `verify_restore.sh` :

| Contrôle | Résultat |
|---|---|
| Deux archives + **manifeste** du même horodatage | ✅ |
| SHA-256 des archives = manifeste (avant tout déchiffrement) | ✅ |
| Déchiffrement + gzip intègres | ✅ |
| Restauration dans une base PostgreSQL 16 **vierge** + fichiers dans un répertoire 0700 | ✅ |
| Comptages **exacts** table par table = manifeste | ✅ **49 tables** |
| Fichiers référencés présents (DMP + KYC) + checksum SHA-256 du clair (échantillon) | ✅ 3/3, 0 écart |
| Tête de la chaîne d'audit = manifeste ; chaînage **et hash recalculés** | ✅ 128 entrées, 0 défaut |
| `UPDATE` / `DELETE` / `TRUNCATE` sur `audit_logs` | ✅ **refusés** |
| Contrôles négatifs : mauvaise clé ; archive altérée d'1 octet | ✅ arrêt **avant** restauration (code 1) |
| Destruction (`--cleanup`) : base et fichiers restaurés supprimés | ✅ |

🔴 **Défaut trouvé et corrigé pendant cette répétition** : le hash d'audit n'était **pas
recalculable** depuis la base — `meta` est stocké en `jsonb`, qui réordonne les clés (même
imbriquées) ; mesuré sur la base de test : **1 110 lignes sur 1 421** non vérifiables. Une
altération de `meta` n'aurait donc pas été détectable (seul le chaînage l'était). `computeAuditHash`
hache désormais une forme **canonique** (clés triées récursivement) ; `scripts/audit/verify-chain.mjs`
vérifie une base hors ligne. Aucune ligne de production n'existe encore : toutes seront canoniques.

Nouveautés d'outillage : `pg_dump_encrypted.sh` écrit un **manifeste** non chiffré (aucune
donnée personnelle : comptages, empreintes, tête de chaîne) ; `verify_restore.sh` automatise
tout le protocole ; `scripts/restore/verify-files.mjs` contrôle base ↔ fichiers.

## 2. Test RÉEL sur archives de production — À FAIRE (après B3 phase 6)

Procédure outillée (machine tierce, clé copiée hors VPS, les **trois** fichiers du même horodatage) :

```bash
sudo STAMP=<AAAAMMJJ_HHMMSS> BACKUP_DIR=<dossier des archives> KEY_FILE=<backup.key> WORK_DIR=/srv/b5 \
     PGHOST=/var/run/postgresql PGUSER=postgres \
     HEALTH_ENCRYPTION_KEY=… bash infra/deploy/scripts/verify_restore.sh   # clé santé : optionnelle, par l'environnement
sudo STAMP=<…> WORK_DIR=/srv/b5 PGUSER=postgres bash infra/deploy/scripts/verify_restore.sh --cleanup
```

Détail des contrôles manuels équivalents (conservé pour mémoire) :

C'est lui le critère de sortie du chantier. À dérouler sur une **machine tierce** (pas le VPS),
avec la clé `/etc/digisante/backup.key` **copiée hors VPS** :

- [ ] Récupérer les **deux** archives les plus récentes de `/var/backups/digisante/`.
- [ ] Restaurer la base dans un PostgreSQL 16 vierge :
      `openssl enc -d -aes-256-cbc -pbkdf2 -pass file:backup.key -in digisante_<stamp>.sql.gz.enc | gunzip | psql digisante`
- [ ] Restaurer le magasin :
      `openssl enc -d -aes-256-cbc -pbkdf2 -pass file:backup.key -in digisante_files_<stamp>.tar.gz.enc | gunzip | tar -C <parent> -xf -`
- [ ] Contrôles : comptages plausibles (users, dossiers) ; ouvrir une entrée DMP **avec pièce
      jointe** et vérifier que son `checksum` SHA-256 correspond au fichier restauré ;
      `UPDATE audit_logs` → rejeté ; chaîne de hash de l'audit vérifiée sur un échantillon.
- [ ] **Dater et consigner** le test ici et dans `DEPLOIEMENT_Checklist.md` §7 ; détruire les
      données restaurées sur la machine tierce après le test (ce sont des données de santé).
- [ ] À refaire après **toute modification** de `pg_dump_encrypted.sh` ou du magasin de fichiers.

## 3. Critère de sortie B5

Test réel daté et consigné : les deux archives de production restaurées sur machine tierce,
cohérence données↔fichiers vérifiée (checksum DMP), protections d'audit actives après
restauration, données de test détruites.
