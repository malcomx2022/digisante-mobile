import { cn } from '@/lib/cn';
import { LangPill } from './LangPill';

/** Barre d'état mobile : heure + pill langue. Présente en tête de chaque écran. */
export function StatusBar({ dark = false, lang = 'FR', time = '9:41' }: { dark?: boolean; lang?: string; time?: string }) {
  return (
    <div className={cn('flex items-center justify-between px-4 h-11 text-[11px]', dark ? 'text-white' : 'text-nuit')}>
      <span className="font-display font-bold">{time}</span>
      <LangPill lang={lang} dark={dark} />
    </div>
  );
}
