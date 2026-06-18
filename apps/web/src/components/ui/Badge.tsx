import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

type Variant = 'normal' | 'eleve' | 'priorite' | 'pro' | 'indigo';

const VARIANTS: Record<Variant, string> = {
  normal: 'bg-sante-50 text-sante-700',
  eleve: 'bg-ocre-50 text-ocre-600',
  priorite: 'bg-ocre-400 text-stone-900',
  pro: 'bg-terre-500 text-white',
  indigo: 'bg-indigo-50 text-indigo-700',
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

/** Badge « card-pagne » (statuts, niveaux, PRO…). */
export function Badge({ variant = 'normal', className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn('inline-block card-pagne font-display font-extrabold text-[0.59375rem] px-2 py-0.5 leading-tight', VARIANTS[variant], className)}
      {...props}
    >
      {children}
    </span>
  );
}
