'use client';

import Link from 'next/link';
import { TERMS_VERSION } from '@digisante/shared';

import { CardPagne, KenteBar, LangSwitcher, StatusBar } from '@/components/ui';
import { legalDoc, LEGAL_DOC_IDS, type LegalDocId } from '@/content/legal';
import { useLocale } from '@/i18n/LocaleProvider';

const LINK_KEY: Record<LegalDocId, string> = { cgu: 'legal.cgu', confidentialite: 'legal.privacy', mentions: 'legal.mentions' };

/** Page publique d'un texte légal (accessible sans compte, avant inscription). */
export function LegalDocument({ id }: { id: LegalDocId }) {
  const { t, lang } = useLocale();
  const doc = legalDoc(id, lang);
  return (
    <div className="min-h-dvh-screen bg-creme flex flex-col">
      <header className="bg-sante-900 bogolan-dark relative pb-10 text-white">
        <StatusBar dark right={<LangSwitcher dark />} />
        <div className="px-6 pt-2 lg:max-w-2xl lg:mx-auto lg:w-full">
          <h1 className="font-display font-extrabold text-2xl">{doc.title}</h1>
          <p className="text-[0.75rem] text-white/80">{t('legal.version', { version: TERMS_VERSION })}</p>
        </div>
        <KenteBar className="absolute -bottom-1 left-0 right-0" />
      </header>
      <main className="px-6 py-6 space-y-4 lg:max-w-2xl lg:mx-auto lg:w-full">
        {/* Bandeau obligatoire tant que les textes ne sont pas validés juridiquement. */}
        <p role="note" className="card-pagne bg-ocre-50 border border-ocre-300 px-4 py-3 text-[0.8125rem] font-bold text-stone-800">
          {t('legal.draft_banner')}
        </p>
        <CardPagne className="p-5 space-y-4">
          {doc.sections.map((s) => (
            <section key={s.title}>
              <h2 className="font-display font-extrabold text-[0.9375rem] text-stone-800">{s.title}</h2>
              {s.paragraphs.map((p) => (
                <p key={p} className="mt-1.5 text-[0.875rem] text-stone-600 leading-relaxed">{p}</p>
              ))}
            </section>
          ))}
        </CardPagne>
        <nav className="flex flex-wrap gap-3 text-[0.8125rem]">
          {LEGAL_DOC_IDS.filter((d) => d !== id).map((d) => (
            <Link key={d} href={`/legal/${d}`} className="text-sante-700 underline decoration-dotted underline-offset-4">{t(LINK_KEY[d])}</Link>
          ))}
          <Link href="/login" className="text-sante-700 underline decoration-dotted underline-offset-4">{t('legal.back')}</Link>
        </nav>
      </main>
    </div>
  );
}

/** Liens vers les textes légaux (inscription, profil, consentement). */
export function LegalLinks({ className = '' }: { className?: string }) {
  const { t } = useLocale();
  return (
    <span className={`inline-flex flex-wrap gap-x-3 gap-y-1 ${className}`}>
      {LEGAL_DOC_IDS.map((d) => (
        <Link key={d} href={`/legal/${d}`} target="_blank" rel="noopener" className="underline decoration-dotted underline-offset-4">{t(LINK_KEY[d])}</Link>
      ))}
    </span>
  );
}
