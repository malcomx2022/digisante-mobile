// ─────────────────────────────────────────────────────────────
// Routes Admin (préfixe /api/v1/admin). RBAC : ADMIN + scopes (cf. rbac.ts).
// IMPORTANT : l'admin n'accède JAMAIS au contenu médical du DMP (cloisonnement §4).
//
// Ce fichier n'est qu'un AGRÉGATEUR : chaque domaine admin vit dans son propre
// sous-module de routes, tous enregistrés SANS préfixe additionnel → les chemins,
// le RBAC et l'audit restent STRICTEMENT identiques (découpage organisationnel
// pur, aucun changement de comportement). Voir admin.<domaine>.routes.ts.
// ─────────────────────────────────────────────────────────────
import type { FastifyInstance } from 'fastify';

import adminAdminsRoutes from './admin.admins.routes.js';
import adminAuditRoutes from './admin.audit.routes.js';
import adminDashboardRoutes from './admin.dashboard.routes.js';
import adminFinanceRoutes from './admin.finance.routes.js';
import adminOpsRoutes from './admin.ops.routes.js';
import adminSupportRoutes from './admin.support.routes.js';
import adminUsersRoutes from './admin.users.routes.js';

export default async function adminRoutes(app: FastifyInstance) {
  // Enregistrés sous le préfixe hérité (/api/v1/admin) — pas de préfixe ajouté ici.
  await app.register(adminDashboardRoutes); // /me, /metrics
  await app.register(adminAuditRoutes); //     /audit
  await app.register(adminUsersRoutes); //     /users*
  await app.register(adminAdminsRoutes); //    /admins*
  await app.register(adminSupportRoutes); //   /support/*
  await app.register(adminFinanceRoutes); //   /finance/*  (⚠️ §5 — relocation seule)
  await app.register(adminOpsRoutes); //       /ops/*
}
