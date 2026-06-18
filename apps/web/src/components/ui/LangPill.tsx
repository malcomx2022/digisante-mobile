import { cn } from '@/lib/cn';

/** Pill langue « FR ▾ » — présente sur CHAQUE écran (CLAUDE.md §5). */
export function LangPill({ lang = 'FR', dark = false }: { lang?: string; dark?: boolean }) {
  return (
    <span
      className={cn(
        'text-[0.6875rem] px-2 py-0.5 rounded-full font-bold font-display',
        dark ? 'bg-white/15 border border-white/20 text-white' : 'bg-stone-900 text-creme',
      )}
    >
      {lang} ▾
    </span>
  );
}
