'use client';

import { usePathname } from 'next/navigation';

import { BottomNav, type NavItem } from '@/components/ui/BottomNav';
import { TopNav } from '@/components/ui/TopNav';
import { useLocale } from '@/i18n/LocaleProvider';
import { cn } from '@/lib/cn';

// Aligné sur les accents de BottomNav (par espace).
type Accent = 'sante' | 'indigo' | 'ocre';

/**
 * Coquille applicative adaptative (refonte UX) :
 * - mobile (<lg) : conteneur étroit centré + BottomNav + FAB (inchangé) ;
 * - desktop (≥lg) : TopNav horizontale + conteneur élargi centré.
 *
 * Présentation only : les pages conservent leur contenu et leur en-tête.
 * Réutilisable par chaque espace via ses props (accent + items + fond).
 */
export function AppShell({
  accent = 'sante',
  items,
  fabHref,
  fabLabelKey,
  profileHref,
  bgWrap = 'wax-light',
  bgInner = 'bg-creme',
  children,
}: {
  accent?: Accent;
  items: NavItem[];
  fabHref: string;
  fabLabelKey?: string;
  profileHref?: string;
  /** Fond texturé de la zone hors conteneur (ex. wax-light, wax-ocre, bg-nuit). */
  bgWrap?: string;
  /** Fond du conteneur de contenu (ex. bg-creme, transparent pour les espaces sombres). */
  bgInner?: string;
  children: React.ReactNode;
}) {
  const { t } = useLocale();
  // Salle de téléconsultation : la barre de navigation est masquée. Sur un petit
  // écran elle mange la hauteur utile de la vidéo, et proposer « Agenda » ou
  // « Accueil » pendant une consultation invite à quitter l'appel d'un geste.
  // Détection par SUFFIXE plutôt que par liste de routes : `/patient/teleconsult`
  // et `/pro/teleconsult` sont couverts, et tout futur espace le sera aussi sans
  // qu'on ait à penser à mettre une liste à jour.
  const inConsultationRoom = (usePathname() ?? '').endsWith('/teleconsult');
  return (
    // Colonne flex pleine hauteur (100dvh) : la TopNav (desktop) prend sa hauteur
    // propre et le conteneur de contenu remplit le reste via `flex-1` — évite le
    // double `min-h-screen` qui débordait d'une hauteur de barre sur desktop, et
    // le débordement de `100vh` sous la barre d'URL mobile.
    <div className={cn('min-h-dvh-screen flex flex-col', bgWrap)}>
      {/* Lien d'évitement (a11y clavier) : visible uniquement au focus. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:bg-white focus:text-nuit focus:card-pagne focus:shadow-lg focus:font-display focus:font-bold"
      >
        {t('a11y.skip')}
      </a>
      <TopNav items={items} accent={accent} fabHref={fabHref} fabLabelKey={fabLabelKey} profileHref={profileHref} />
      <div
        className={cn(
          // Desktop : conteneur élargi pour les grilles multi-colonnes ;
          // les contenus « lecture/formulaire » se recentrent eux-mêmes (max-w-2xl).
          'mx-auto w-full max-w-[420px] lg:max-w-5xl flex-1 flex flex-col shadow-xl lg:shadow-none',
          bgInner,
        )}
      >
        <div id="main-content" tabIndex={-1} className="flex-1 flex flex-col outline-none">{children}</div>
        {!inConsultationRoom && (
          <div className="lg:hidden">
            <BottomNav items={items} accent={accent} fabHref={fabHref} fabLabelKey={fabLabelKey} />
          </div>
        )}
      </div>
    </div>
  );
}
