import { LangPill } from '@digisante/web';

// Sur fond clair — présente sur chaque écran.
export const Clair = () => (
  <div className="flex gap-2 p-5 bg-creme">
    <LangPill lang="FR" />
    <LangPill lang="FON" />
    <LangPill lang="YOR" />
  </div>
);

// Variante sur header sombre.
export const Sombre = () => (
  <div className="flex gap-2 p-5 bg-nuit">
    <LangPill lang="FR" dark />
    <LangPill lang="FON" dark />
  </div>
);
