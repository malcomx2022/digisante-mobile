// Acceptation des CGU exigée à l'inscription (conformité APDP) : à fusionner
// dans toute charge utile de test de POST /auth/register.
import { TERMS_VERSION } from '@digisante/shared';

export const REGISTER_TERMS = { acceptTerms: true as const, termsVersion: TERMS_VERSION };
