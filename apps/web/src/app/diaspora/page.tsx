'use client';

import Link from 'next/link';

import { Button, CardPagne } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { useLocale } from '@/i18n/LocaleProvider';
import { get } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';

interface Wallet {
  balance: string | number;
  currency: string;
}

const FAMILY = [
  { name: 'Aïcha', lang: '🗣 Fon' },
  { name: 'Koffi', lang: '🗣 Baatɔnum' },
];

// D-20 — Dashboard diaspora (wallet + famille).
export default function DiasporaDashboard() {
  const { t } = useLocale();
  const { data } = useApi<Wallet>(() => get('/wallet'), []);

  return (
    <>
      <SpaceHeader title={t('diaspora.title')} subtitle="Paris 🇫🇷 · Cotonou 🇧🇯" headerClass="bg-ocre-900" profileHref="/diaspora/profile" />
      <main className="px-6 -mt-10 relative z-20 space-y-4 pb-6">
        <CardPagne stitch className="p-5 bg-ocre-900 bogolan-dark text-white">
          <p className="text-[12px] text-white/70">{t('wallet.balance')}</p>
          <p className="font-display font-extrabold text-3xl">
            {Number(data?.balance ?? 0).toLocaleString('fr-FR')} <span className="text-base">{data?.currency ?? 'XOF'}</span>
          </p>
          <Link href="/diaspora/wallet" className="inline-block mt-3 bg-ocre-400 text-stone-900 font-display font-bold card-pagne px-4 py-2 text-[13px]">
            {t('wallet.topup')}
          </Link>
        </CardPagne>

        <h2 className="font-display font-extrabold text-[14px] text-stone-700">{t('diaspora.family')}</h2>
        <div className="space-y-3">
          {FAMILY.map((f, i) => (
            <CardPagne key={f.name} className={`p-4 flex items-center justify-between ${i % 2 ? '-rotate-1' : 'rotate-1'}`}>
              <div>
                <p className="font-display font-bold text-[14px]">{f.name}</p>
                <p className="text-[12px] text-stone-400">{f.lang}</p>
              </div>
              <Button variant="ocre" className="text-[12px] px-3 py-1.5">
                {t('diaspora.notify')}
              </Button>
            </CardPagne>
          ))}
        </div>
      </main>
    </>
  );
}
