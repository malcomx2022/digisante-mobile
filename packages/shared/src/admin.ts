// ─────────────────────────────────────────────────────────────
// RBAC back-office — permissions par scope + presets de profils administrateurs.
// Source de vérité partagée web ⇄ api (cf. docs/ADMIN_Backoffice_Proposal.md §1).
// ─────────────────────────────────────────────────────────────

/** Permissions atomiques attribuables à un administrateur. */
export const ADMIN_SCOPES = [
  'admin:manage', // gérer les administrateurs (super-admin)
  'users:read',
  'users:write',
  'kyc:review',
  'ops:read',
  'finance:read',
  'finance:write', // §5 — réservé (reversements, remboursements)
  'support:write',
  'otp:write',
  'webhooks:read',
  'webhooks:replay', // §5 — réservé (replay DLQ)
  'audit:read',
  'audit:export',
  'education:write',
  'integrations:read', // vue MASQUÉE des intégrations tierces (§3.6)
  'integrations:write', // saisie/rotation des clés d'API + webhooks — SUPER_ADMIN
] as const;
export type AdminScope = (typeof ADMIN_SCOPES)[number];

/** Presets (raccourcis d'attribution) → ensembles de scopes. */
export const ADMIN_PRESETS = {
  SUPER_ADMIN: ADMIN_SCOPES,
  OPERATIONS: ['ops:read', 'users:read', 'audit:read'],
  FINANCE: ['finance:read', 'webhooks:read', 'audit:read'],
  SUPPORT: ['support:write', 'users:read', 'otp:write'],
  MODERATION: ['kyc:review', 'users:write', 'audit:read'],
  CONTENT: ['education:write'],
} satisfies Record<string, readonly AdminScope[]>;
export type AdminPreset = keyof typeof ADMIN_PRESETS;
export const ADMIN_PRESET_NAMES = Object.keys(ADMIN_PRESETS) as AdminPreset[];

/** Vrai si l'ensemble de scopes contient le scope demandé. */
export function hasScope(scopes: readonly string[] | null | undefined, scope: AdminScope): boolean {
  return Array.isArray(scopes) && scopes.includes(scope);
}
