-- ─────────────────────────────────────────────────────────────
-- Durcissement de l'immuabilité de l'audit (CLAUDE.md §4).
-- Les triggers BEFORE UPDATE/DELETE existants ne se déclenchent PAS sur TRUNCATE :
-- un rôle propriétaire de la table pourrait vider tout le registre par
-- `TRUNCATE audit_logs`. On ajoute un garde BEFORE TRUNCATE (niveau statement)
-- réutilisant la fonction d'exception existante.
-- ─────────────────────────────────────────────────────────────
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION digisante_prevent_audit_mutation();

CREATE TRIGGER admin_audit_logs_no_truncate BEFORE TRUNCATE ON "admin_audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION digisante_prevent_audit_mutation();
