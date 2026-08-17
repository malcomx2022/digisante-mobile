'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ConfirmDialog } from '@/components/ui';
import { useLocale } from '@/i18n/LocaleProvider';
import { dmpApi, type DmpDocument } from '@/lib/api/dmp';
import { fileToBase64, MAX_UPLOAD_BYTES, UPLOAD_MIMES } from '@/lib/file';

const ICON: Record<string, string> = {
  'application/pdf': '📄',
  'image/jpeg': '🖼',
  'image/png': '🖼',
  'image/webp': '🖼',
};

/** Taille lisible (l'utilisateur juge s'il peut la télécharger en 2G). */
function humanSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

/**
 * Pièces jointes d'une entrée du DMP : ajout, téléchargement, suppression.
 *
 * §4 — le fichier n'est jamais accessible par URL publique : il transite par un
 * blob authentifié (`dmpApi.documentBlob`) et est chiffré au repos côté serveur.
 * Le contenu n'est chargé qu'au dépliage (réseaux 2G/rural).
 */
export function RecordDocuments({ recordId, initialCount }: { recordId: string; initialCount: number }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<DmpDocument[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<DmpDocument | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const detail = await dmpApi.getRecord(recordId);
      setDocs(detail.documents ?? []);
    } catch {
      setError(t('auth.error'));
    }
  }, [recordId, t]);

  useEffect(() => {
    if (open && docs === null) void load();
  }, [open, docs, load]);

  async function upload(file: File) {
    setError(null);
    // Contrôles côté client pour un retour immédiat ; le serveur revérifie tout
    // (magic bytes compris) — celui-ci n'est qu'un confort, pas une sécurité.
    if (!UPLOAD_MIMES.includes(file.type)) return setError(t('dmpdoc.bad_format'));
    if (file.size > MAX_UPLOAD_BYTES) return setError(t('dmpdoc.too_big'));

    setBusy(true);
    try {
      const dataBase64 = await fileToBase64(file);
      const created = await dmpApi.addDocument(recordId, file.name, file.type, dataBase64);
      setDocs((d) => [...(d ?? []), created]);
    } catch {
      setError(t('auth.error'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function download(doc: DmpDocument) {
    setError(null);
    try {
      const blob = await dmpApi.documentBlob(doc.id);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError(t('auth.error'));
    }
  }

  async function remove(doc: DmpDocument) {
    setBusy(true);
    try {
      await dmpApi.removeDocument(doc.id);
      setDocs((d) => (d ?? []).filter((x) => x.id !== doc.id));
    } catch {
      setError(t('auth.error'));
    } finally {
      setBusy(false);
      setToDelete(null);
    }
  }

  const count = docs?.length ?? initialCount;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-[0.75rem] font-display font-bold text-sante-700 underline decoration-dotted underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sante-600"
      >
        <span aria-hidden>📎</span> {t('dmpdoc.title')}
        {count > 0 ? ` (${count})` : ''}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {(docs ?? []).map((d) => (
            <div key={d.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => download(d)}
                className="flex-1 min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sante-600"
              >
                <p className="font-display font-bold text-[0.8125rem] text-stone-800 truncate">
                  <span aria-hidden>{ICON[d.mimeType] ?? '📎'}</span> {d.filename}
                </p>
                <p className="text-[0.6875rem] text-stone-400">{humanSize(d.size)}</p>
              </button>
              <button
                type="button"
                onClick={() => setToDelete(d)}
                aria-label={`${t('dmpdoc.delete')} ${d.filename}`}
                className="shrink-0 card-pagne bg-sos-50 text-sos-700 font-display font-extrabold text-[0.6875rem] px-2.5 py-1"
              >
                {t('dmpdoc.delete')}
              </button>
            </div>
          ))}

          {docs !== null && docs.length === 0 && <p className="text-[0.75rem] text-stone-400">{t('dmpdoc.empty')}</p>}

          <label className="block">
            <span className="sr-only">{t('dmpdoc.add')}</span>
            <input
              ref={fileRef}
              type="file"
              accept={UPLOAD_MIMES.join(',')}
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
              className="block w-full text-[0.8125rem] text-stone-600 file:card-pagne file:border-0 file:bg-sante-50 file:px-3 file:py-1.5 file:font-display file:font-bold file:text-[0.75rem] file:text-sante-700"
            />
          </label>
          <p className="text-[0.6875rem] text-stone-400">{t('dmpdoc.hint')}</p>
          {error && <p className="text-sos-600 font-bold text-[0.75rem]">{error}</p>}
        </div>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        danger
        title={t('dmpdoc.delete_title')}
        message={t('dmpdoc.delete_desc')}
        confirmLabel={t('dmpdoc.delete')}
        busy={busy}
        onConfirm={() => toDelete && remove(toDelete)}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
