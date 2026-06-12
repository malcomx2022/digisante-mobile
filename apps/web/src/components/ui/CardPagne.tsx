import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

type Stitch = boolean | 'terre' | 'indigo' | 'sos' | 'light';

const STITCH_CLASS: Record<Exclude<Stitch, boolean>, string> = {
  terre: 'stitch',
  indigo: 'stitch-indigo',
  sos: 'stitch-sos',
  light: 'stitch-light',
};

interface CardPagneProps extends HTMLAttributes<HTMLDivElement> {
  /** Couture « fait main » — 1 seule par groupe visuel. */
  stitch?: Stitch;
}

/** Carte « pagne » : coin coupé + bordure. Conteneur principal par défaut. */
export function CardPagne({ stitch = false, className, children, ...props }: CardPagneProps) {
  const stitchClass = stitch === true ? 'stitch' : stitch ? STITCH_CLASS[stitch] : '';
  return (
    <div className={cn('bg-white card-pagne border border-stone-200', stitchClass, className)} {...props}>
      {children}
    </div>
  );
}
