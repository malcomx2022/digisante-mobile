'use client';

import { useState } from 'react';

import { Badge, Button, CardPagne } from '@/components/ui';
import { SpaceHeader } from '@/components/ui/SpaceHeader';
import { Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get, post } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';

interface User {
  id: string;
  phone: string;
  role: string;
  status: string;
  profile: { firstName: string; lastName: string } | null;
}
interface Paginated {
  data: User[];
  total: number;
}

// D-25 (part 1) — Gestion des utilisateurs (sans contenu médical).
export default function AdminUsers() {
  const { t } = useLocale();
  const [tick, setTick] = useState(0);
  const { data, loading } = useApi<Paginated>(() => get('/admin/users?pageSize=30'), [tick]);

  async function toggle(u: User) {
    const action = u.status === 'SUSPENDED' ? 'activate' : 'suspend';
    await post(`/admin/users/${u.id}/${action}`).catch(() => {});
    setTick((x) => x + 1);
  }

  return (
    <>
      <SpaceHeader title={t('admin.users')} headerClass="bg-indigo-950" />
      <main className="px-6 -mt-10 relative z-20 space-y-3 pb-6">
        <p className="text-[12px] text-stone-400">{t('admin.no_medical')}</p>
        {loading && <Loading label={t('common.loading')} />}
        {(data?.data ?? []).map((u) => (
          <CardPagne key={u.id} stitch={u.status === 'SUSPENDED' ? 'sos' : false} className="p-4 flex items-center justify-between">
            <div>
              <p className="font-display font-bold text-[14px]">{u.profile ? `${u.profile.firstName} ${u.profile.lastName}` : u.phone}</p>
              <p className="text-[12px] text-stone-400">
                {u.role} · {u.phone}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={u.status === 'SUSPENDED' ? 'eleve' : 'normal'}>{u.status}</Badge>
              <Button variant={u.status === 'SUSPENDED' ? 'sante' : 'sos'} className="text-[11px] px-2.5 py-1" onClick={() => toggle(u)}>
                {u.status === 'SUSPENDED' ? t('admin.activate') : t('admin.suspend')}
              </Button>
            </div>
          </CardPagne>
        ))}
      </main>
    </>
  );
}
