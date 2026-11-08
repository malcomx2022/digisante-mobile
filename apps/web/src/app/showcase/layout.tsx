import { notFound } from 'next/navigation';

// Vitrine du design system : données fictives (« Koffi », RDV factice). En
// production elle n'est pas servie (404) — un patient ne doit pas la prendre
// pour son propre espace. Réactivable explicitement au build (NEXT_PUBLIC_SHOWCASE=1)
// pour une revue de design en préproduction.
export default function ShowcaseLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_SHOWCASE !== '1') notFound();
  return children;
}
