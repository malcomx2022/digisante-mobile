/** Concatène des classes en ignorant les valeurs falsy (sans dépendance externe). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
