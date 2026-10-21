'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useLocale } from '@/i18n/LocaleProvider';
import { Button } from './Button';
import { CardPagne } from './CardPagne';

/**
 * Dialogue de confirmation stylé « Wax & Terre » — remplace `window.confirm()`
 * (natif, non traduit, non thématisé). Contrôlé : la page gère l'ouverture.
 * A11y : `role=dialog`, fermeture Échap + clic backdrop, focus initial sur l'action.
 *
 * Rendu dans un PORTAIL sous `document.body` (recette L10, 20/10/2026) : posé dans
 * une `card-pagne`, le fond `fixed` restait piégé dans la carte — `clip-path`
 * rogne tous les descendants, et un ancêtre `transform` (rotations « fait main »)
 * ou `overflow` redéfinit le repère de `position: fixed`. Le panneau n'apparaissait
 * jamais (diffusion de campagne impossible). Ne pas revenir à un rendu en place.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Action destructive → accent SOS (rouge) + couture sos. */
  danger?: boolean;
  /** Désactive les boutons pendant la requête. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Contenu optionnel (ex. champ de saisie) inséré sous le message. */
  children?: React.ReactNode;
}) {
  const { t } = useLocale();
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Le portail exige le DOM : rien au rendu serveur ni avant l'hydratation.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel, mounted]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-nuit/60 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => !busy && onCancel()}
    >
      <CardPagne stitch={danger ? 'sos' : 'indigo'} className="w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display font-extrabold text-lg text-nuit">{title}</h2>
        {message && <p className="mt-1.5 text-[0.875rem] text-stone-500">{message}</p>}
        {children && <div className="mt-3">{children}</div>}
        <div className="mt-5 flex gap-2">
          <Button variant="outline" full onClick={onCancel} disabled={busy}>
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={[
              'flex-1 font-display font-extrabold text-[0.9375rem] card-pagne px-5 py-3 text-white transition active:translate-y-px disabled:opacity-50',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-offset-0',
              danger ? 'bg-sos-500 focus-visible:ring-white' : 'bg-indigo-600 focus-visible:ring-white',
            ].join(' ')}
          >
            {confirmLabel}
          </button>
        </div>
      </CardPagne>
    </div>,
    document.body,
  );
}
