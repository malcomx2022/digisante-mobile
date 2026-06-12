import { cn } from '@/lib/cn';

/** Séparateur nkyinkyim (zigzag adinkra) — remplace tout <hr>/divider plat. */
export function Nkyinkyim({ className }: { className?: string }) {
  return <div className={cn('nkyinkyim w-full opacity-30', className)} aria-hidden />;
}
