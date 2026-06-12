// Polices du design system (next/font — pas de FOUT, self-hosted).
// Bricolage Grotesque (display) + DM Sans (corps). Jamais Sora (réservé ANaTT).
import { Bricolage_Grotesque, DM_Sans } from 'next/font/google';

export const fontDisplay = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  variable: '--font-display',
  display: 'swap',
});

export const fontBody = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});
