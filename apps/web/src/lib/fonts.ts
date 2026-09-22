// Polices du design system (next/font — pas de FOUT, self-hosted).
// Bricolage Grotesque (display) + DM Sans (corps). Jamais Sora (réservé ANaTT).
//
// Fichiers EMBARQUÉS (`src/fonts/`) via `next/font/local` : le build ne télécharge
// plus rien depuis fonts.googleapis.com (build hermétique, VPS/CI sans accès Google).
// Provenance et licence (SIL OFL 1.1) : `src/fonts/README.md`.
// Ce sont des polices VARIABLES : un seul fichier couvre toutes les graisses —
// d'où une plage `weight` et non une liste. Sous-ensemble `latin`, identique à
// l'ancienne configuration `next/font/google` (`subsets: ['latin']`).
import localFont from 'next/font/local';

export const fontDisplay = localFont({
  src: '../fonts/BricolageGrotesque-latin.woff2',
  weight: '400 800',
  style: 'normal',
  variable: '--font-display',
  display: 'swap',
  adjustFontFallback: 'Arial',
});

export const fontBody = localFont({
  src: '../fonts/DMSans-latin.woff2',
  weight: '400 700',
  style: 'normal',
  variable: '--font-body',
  display: 'swap',
  adjustFontFallback: 'Arial',
});
