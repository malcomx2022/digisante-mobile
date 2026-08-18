-- ─────────────────────────────────────────────────────────────
-- Journal d'audit UNIQUE (CLAUDE.md §4) — suppression d'AdminAuditLog.
--
-- `admin_audit_logs` était un SECOND registre d'audit :
--   • jamais écrit par l'application (seul le seed y posait 2 lignes de démo,
--     qu'aucun écran ne lisait) ;
--   • dépourvu de chaîne de hachage (ni `prevHash` ni `hash`), donc
--     STRUCTURELLEMENT MOINS protégé que `audit_logs`.
-- Le plan du back-office (docs/ADMIN_Backoffice_Proposal.md §9-2) laissait la
-- question du « journal unique » ouverte ; les lots A→H l'ont tranchée de fait
-- en écrivant toutes les actions d'administration dans `audit_logs`.
-- Deux registres dont un non chaîné = ambiguïté à expliquer lors d'un contrôle
-- APDP, et piège pour un futur contributeur qui écrirait dans le mauvais.
--
-- `DROP TABLE` emporte ses 3 triggers (no_update / no_delete / no_truncate),
-- ses 3 index et sa clé étrangère.
-- ─────────────────────────────────────────────────────────────

-- Garde-fou : on ne détruit JAMAIS des lignes d'audit en silence. Si la table
-- contient autre chose que les lignes de démonstration du seed, la migration
-- ÉCHOUE et le déploiement s'arrête — à traiter manuellement (export puis
-- reprise dans `audit_logs`).
DO $$
DECLARE
  unexpected bigint;
BEGIN
  IF to_regclass('public.admin_audit_logs') IS NULL THEN
    RETURN; -- déjà supprimée
  END IF;

  SELECT count(*) INTO unexpected
  FROM "admin_audit_logs"
  WHERE "id" NOT LIKE 'seed-admin-audit-%';

  IF unexpected > 0 THEN
    RAISE EXCEPTION
      'admin_audit_logs contient % ligne(s) non issue(s) du seed : exporter et reprendre dans audit_logs avant de rejouer cette migration.',
      unexpected;
  END IF;
END $$;

DROP TABLE IF EXISTS "admin_audit_logs";

-- L'enum n'était référencée que par la table supprimée. Les actions
-- d'administration vivent désormais dans `audit_logs.action` (String libre).
DROP TYPE IF EXISTS "AdminAction";
