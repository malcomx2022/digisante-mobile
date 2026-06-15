// Lecture à voix haute (Web Speech API) — accessibilité pour les utilisateurs peu
// alphabétisés. Lit dans la langue affichée ; repli FR pour les langues sans voix
// (le contenu retombe alors sur le FR de toute façon).
const LANG_MAP: Record<string, string> = {
  FR: 'fr-FR',
  EN: 'en-US',
  FON: 'fr-FR',
  BARIBA: 'fr-FR',
  DENDI: 'fr-FR',
};

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Lit `text` à voix haute (interrompt toute lecture en cours). */
export function speak(text: string, lang: string, onEnd?: () => void): void {
  if (!speechSupported()) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = LANG_MAP[lang] ?? 'fr-FR';
  utterance.rate = 0.95;
  if (onEnd) utterance.onend = onEnd;
  window.speechSynthesis.speak(utterance);
}

/** Arrête toute lecture en cours. */
export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
}
