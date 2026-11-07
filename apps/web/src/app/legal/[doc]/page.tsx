import { notFound } from 'next/navigation';

import { LegalDocument } from '@/components/legal/LegalDocument';
import { LEGAL_DOC_IDS, type LegalDocId } from '@/content/legal';

// Textes légaux publics : générés statiquement (consultables hors-ligne via le shell).
export function generateStaticParams() {
  return LEGAL_DOC_IDS.map((doc) => ({ doc }));
}

export default function LegalPage({ params }: { params: { doc: string } }) {
  if (!LEGAL_DOC_IDS.includes(params.doc as LegalDocId)) notFound();
  return <LegalDocument id={params.doc as LegalDocId} />;
}
