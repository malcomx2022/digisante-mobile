import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

type Variant = 'terre' | 'indigo' | 'sante' | 'ocre' | 'outline' | 'sos';

const VARIANTS: Record<Variant, string> = {
  terre: 'bg-terre-500 text-white shadow-[0_10px_26px_rgba(194,84,43,.4)]',
  indigo: 'bg-indigo-600 text-white shadow-[0_8px_20px_rgba(43,58,103,.35)]',
  sante: 'bg-sante-600 text-white',
  ocre: 'bg-ocre-400 text-stone-900',
  outline: 'bg-white border-2 border-indigo-600 text-indigo-600',
  sos: 'bg-sos-500 text-white',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  full?: boolean;
}

/** Bouton « card-pagne » — display extrabold, coin coupé, ombre sérigraphie. */
export function Button({ variant = 'terre', full = false, className, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'font-display font-extrabold text-[15px] card-pagne px-5 py-3 transition active:translate-y-px disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-sante-600',
        VARIANTS[variant],
        full && 'w-full',
        className,
      )}
      {...props}
    />
  );
}
