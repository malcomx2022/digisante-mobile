import { notFound } from 'next/navigation';

import { LegalDocument } from '@/components/legal/LegalDocument';
import { LEGAL_DOC_IDS, type LegalDocId } from '@/content/legal';

// Textes légaux publics : générés statiquement (consultables hors-ligne via le shell).
export function generateStaticParams() {
  return LEGAL_DOC_IDS.map((doc) => ({ doc }));
}

// Next 15 : `params` est asynchrone.
export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  if (!LEGAL_DOC_IDS.includes(doc as LegalDocId)) notFound();
  return <LegalDocument id={doc as LegalDocId} />;
}
