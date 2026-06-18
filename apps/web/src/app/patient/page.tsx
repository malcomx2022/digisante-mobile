'use client';

import Link from 'next/link';

import { useAuth } from '@/auth/AuthProvider';
import { PatientHeader } from '@/components/patient/PatientHeader';
import { Badge, CardPagne, Nkyinkyim } from '@/components/ui';
import { Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { get } from '@/lib/api/client';
import { useApi } from '@/lib/api/useApi';

interface Appointment {
  id: string;
  type: 'PHYSICAL' | 'TELECONSULTATION';
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';
  scheduledAt: string;
}

// D-03 — Dashboard patient.
export default function PatientDashboard() {
  const { t } = useLocale();
  const { user } = useAuth();
  const { data, loading } = useApi<Appointment[]>(() => get('/appointments?pageSize=5'), []);

  // Prochain RDV : à venir (date future), statut actif, le plus proche d'abord.
  const now = Date.now();
  const next = (data ?? [])
    .filter(
      (a) =>
        (a.status === 'PENDING' || a.status === 'CONFIRMED') &&
        new Date(a.scheduledAt).getTime() > now,
    )
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];

  const quick = [
    { key: 'patient.quick.dmp', href: '/patient/dmp', rotate: 'rotate-1', bg: 'bg-sante-50 text-sante-700' },
    { key: 'patient.quick.doctors', href: '/patient/doctors', rotate: '-rotate-1', bg: 'bg-indigo-50 text-indigo-700' },
    { key: 'appt.title', href: '/patient/appointments', rotate: 'rotate-1', bg: 'bg-indigo-50 text-indigo-700' },
    { key: 'patient.quick.prescriptions', href: '/patient/prescriptions', rotate: 'rotate-2', bg: 'bg-ocre-50 text-ocre-600' },
    { key: 'adherence.title', href: '/patient/adherence', rotate: 'rotate-1', bg: 'bg-sante-50 text-sante-700' },
    { key: 'reminders.title', href: '/patient/reminders', rotate: '-rotate-2', bg: 'bg-sante-50 text-sante-700' },
    { key: 'results.title', href: '/patient/results', rotate: 'rotate-1', bg: 'bg-indigo-50 text-indigo-700' },
    { key: 'insurance.title', href: '/patient/insurance', rotate: '-rotate-1', bg: 'bg-ocre-50 text-ocre-600' },
    { key: 'teleconsult.title', href: '/patient/teleconsult', rotate: '-rotate-1', bg: 'bg-ocre-50 text-ocre-600' },
    { key: 'notifications.title', href: '/patient/notifications', rotate: 'rotate-2', bg: 'bg-sante-50 text-sante-700' },
    { key: 'education.title', href: '/patient/education', rotate: '-rotate-1', bg: 'bg-indigo-50 text-indigo-700' },
  ];

  return (
    <>
      <PatientHeader title={t('home.hello', { name: user?.phone ?? '' })} subtitle={`${t('common.greeting')} 👋`} />

      <main className="px-6 -mt-10 relative z-20 space-y-5 pb-6 lg:max-w-2xl lg:mx-auto lg:w-full">
        <CardPagne stitch className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-extrabold text-[15px] text-sante-800">{t('home.next_appointment')}</h2>
            {next && (
              <Badge variant={next.status === 'CONFIRMED' ? 'normal' : 'priorite'}>
                {t(`appt.status.${next.status}`)}
              </Badge>
            )}
          </div>
          <Nkyinkyim className="my-3" />
          {loading ? (
            <Loading label={t('common.loading')} />
          ) : next ? (
            <>
              <p className="text-[13px] text-stone-500">
                {new Date(next.scheduledAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
                {next.type === 'TELECONSULTATION' ? ` · ${t('booking.type_teleconsult')}` : ` · ${t('booking.type_physical')}`}
              </p>
              <Link
                href="/patient/appointments"
                className="mt-4 block w-full text-center bg-sante-600 text-white font-display font-extrabold card-pagne py-3"
              >
                {t('home.details')}
              </Link>
            </>
          ) : (
            <p className="text-sm text-stone-400">{t('patient.no_appointment')}</p>
          )}
        </CardPagne>

        <div className="grid grid-cols-3 gap-3">
          {quick.map((q) => (
            <Link
              key={q.key}
              href={q.href}
              className={`card-pagne ${q.bg} ${q.rotate} p-3 text-center font-display font-bold text-[12px] shadow-[3px_3px_0_rgba(0,0,0,.08)]`}
            >
              {t(q.key)}
            </Link>
          ))}
        </div>

        {/* SOS — écran dédié (API + repli SMS hors-ligne) */}
        <Link
          href="/patient/sos"
          className="block w-full text-center bg-sos-500 text-white font-display font-extrabold card-pagne py-4 pulse-sos shadow-[0_10px_26px_rgba(214,69,51,.4)]"
        >
          {t('patient.quick.sos')}
        </Link>
      </main>
    </>
  );
}
