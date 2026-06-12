import { cn } from '@/lib/cn';

/** Frise kenté — ferme chaque header sombre / ouvre les cartes héro. */
export function KenteBar({ className }: { className?: string }) {
  return <div className={cn('kente-bar', className)} aria-hidden />;
}
