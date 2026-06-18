// Barrel d'entrée pour le sync Claude Design (« Wax & Terre »).
// Re-exporte UNIQUEMENT les primitives présentationnelles du design system.
// Non destiné à l'app — consommé par .ds-sync/package-build.mjs (esbuild → window.WaxTerre).
// LocaleProvider est exporté pour servir de cfg.provider (contexte i18n de ConfirmDialog).
export { Button } from '@/components/ui/Button';
export { Badge } from '@/components/ui/Badge';
export { CardPagne } from '@/components/ui/CardPagne';
export { LangPill } from '@/components/ui/LangPill';
export { StatusBar } from '@/components/ui/StatusBar';
export { Nkyinkyim } from '@/components/ui/Nkyinkyim';
export { KenteBar } from '@/components/ui/KenteBar';
export { Loading, Skeleton, SkeletonCards, ErrorState, Empty } from '@/components/ui/States';
export { ConfirmDialog } from '@/components/ui/ConfirmDialog';
export { LocaleProvider } from '@/i18n/LocaleProvider';
