// Mise à plat du contenu d'une entrée DMP pour la version imprimable (export PDF).
// Le contenu reste celui saisi par le soignant ou le patient : rien n'est
// interprété, reformulé ni traduit. Les champs vides sont omis ; une valeur
// composée est rendue telle quelle (liste ou JSON compact) plutôt que perdue.

export type PrintableField = [label: string, value: string];

function render(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(render).filter((v): v is string => v !== null);
    return parts.length ? parts.join(', ') : null;
  }
  try {
    const json = JSON.stringify(value);
    return json === '{}' ? null : json;
  } catch {
    return null;
  }
}

/** Champs affichables d'une entrée, dans l'ordre d'origine. */
export function printableFields(data: unknown): PrintableField[] {
  if (data === null || data === undefined) return [];
  if (typeof data !== 'object' || Array.isArray(data)) {
    const single = render(data);
    return single === null ? [] : [['', single]];
  }
  const out: PrintableField[] = [];
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const v = render(value);
    if (v !== null) out.push([key, v]);
  }
  return out;
}
