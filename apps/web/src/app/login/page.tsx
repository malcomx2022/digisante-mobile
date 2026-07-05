'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { normalizeBeninPhone, type Role } from '@digisante/shared';

import { Button, KenteBar, StatusBar } from '@/components/ui';
import { useAuth } from '@/auth/AuthProvider';
import { spaceFor } from '@/auth/spaces';
import { type RegisterBody } from '@/lib/api/auth';
import { ApiRequestError } from '@/lib/api/client';
import { useLocale } from '@/i18n/LocaleProvider';
import { cn } from '@/lib/cn';

// Rôles ouverts à l'auto-inscription (ADMIN exclu — seed uniquement, CLAUDE.md §4).
const SELF_REGISTER_ROLES: Role[] = ['PATIENT', 'MEDECIN', 'PHARMACIE', 'LABORATOIRE', 'DIASPORA'];

// D-02 — Connexion / inscription par téléphone + OTP (multi-rôles).
export default function LoginPage() {
  const { lang, t } = useLocale();
  const { register, requestOtp, verifyOtp } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [role, setRole] = useState<Role>('PATIENT');
  const [phone, setPhone] = useState('+229');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  // Champs médecin
  const [speciality, setSpeciality] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [consultFee, setConsultFee] = useState('');
  // Champs pharmacie / laboratoire
  const [establishmentName, setEstablishmentName] = useState('');
  const [address, setAddress] = useState('');

  const [code, setCode] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isDoctor = role === 'MEDECIN';
  const isEstablishment = role === 'PHARMACIE' || role === 'LABORATOIRE';

  /** Construit le corps d'inscription selon le rôle sélectionné. */
  function buildBody(): RegisterBody {
    const body: RegisterBody = { phone: normalizeBeninPhone(phone), role, lang, firstName, lastName };
    if (email.trim()) body.email = email.trim();
    if (isDoctor) {
      body.speciality = speciality.trim();
      body.licenseNumber = licenseNumber.trim();
      const fee = Number(consultFee);
      if (consultFee.trim() && Number.isFinite(fee) && fee >= 0) body.consultFee = fee;
    }
    if (isEstablishment) {
      body.establishmentName = establishmentName.trim();
      if (address.trim()) body.address = address.trim();
    }
    return body;
  }

  /** Validation locale minimale avant l'appel réseau (UX claire). */
  function localError(): string | null {
    if (mode !== 'register') return null;
    if (!firstName.trim() || !lastName.trim()) return t('auth.err_name_required');
    if (isDoctor && (!speciality.trim() || !licenseNumber.trim())) return t('auth.err_doctor_required');
    if (isEstablishment && !establishmentName.trim()) return t('auth.err_establishment_required');
    return null;
  }

  /** Traduit une erreur API (409/422) en message i18n clair. */
  function apiErrorMessage(err: unknown): string {
    if (err instanceof ApiRequestError) {
      if (err.status === 409) return t('auth.err_conflict');
      if (err.status === 422) return t('auth.err_validation');
    }
    return t('auth.error');
  }

  async function sendCode() {
    const le = localError();
    if (le) {
      setError(le);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const otp = mode === 'register' ? await register(buildBody()) : await requestOtp(normalizeBeninPhone(phone));
      setHint(otp.devCode ? `${t('auth.code_sent')} (dev: ${otp.devCode})` : t('auth.code_sent'));
      setStep('code');
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const user = await verifyOtp(normalizeBeninPhone(phone), code);
      router.replace(spaceFor(user.role));
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const inputCls = 'w-full bg-white card-pagne border border-stone-300 px-4 py-3 font-body text-base pagne-focus focus:outline-none focus:border-sante-600';

  return (
    <div className="min-h-dvh-screen wax-light flex flex-col lg:items-center lg:justify-center">
      <div className="mx-auto w-full max-w-[420px] flex-1 lg:flex-none bg-creme flex flex-col shadow-xl lg:my-8">
        <header className="bg-sante-900 bogolan-dark relative pb-14 text-white">
          <StatusBar dark lang={lang} />
          <div className="px-6 pt-4">
            <h1 className="font-display font-extrabold text-2xl">{t('auth.title')}</h1>
          </div>
          <KenteBar className="absolute bottom-0 left-0 right-0" />
        </header>

        <main className="px-6 -mt-8 relative z-20 flex-1 space-y-4 pb-6">
          <div className="bg-white card-pagne stitch border border-stone-200 p-5 space-y-3">
            {step === 'phone' ? (
              <>
                {mode === 'register' && (
                  <>
                    {/* Sélecteur de rôle (pas d'ADMIN) */}
                    <div>
                      <p className="font-display font-extrabold text-[0.75rem] text-stone-600 mb-1.5">{t('auth.role')}</p>
                      <div className="flex flex-wrap gap-2">
                        {SELF_REGISTER_ROLES.map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setRole(r)}
                            className={cn(
                              'card-pagne pagne-focus px-3 py-1.5 text-[0.75rem] font-display font-bold',
                              r === role ? 'bg-sante-600 text-white' : 'bg-creme-deep text-stone-600',
                            )}
                          >
                            {t(`role.${r}`)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <input className={inputCls} placeholder={t('auth.firstname')} aria-label={t('auth.firstname')} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                      <input className={inputCls} placeholder={t('auth.lastname')} aria-label={t('auth.lastname')} value={lastName} onChange={(e) => setLastName(e.target.value)} />
                    </div>
                    <input className={inputCls} inputMode="email" placeholder={t('auth.email_optional')} aria-label={t('auth.email_optional')} value={email} onChange={(e) => setEmail(e.target.value)} />

                    {/* Champs médecin */}
                    {isDoctor && (
                      <>
                        <input className={inputCls} placeholder={t('auth.speciality')} aria-label={t('auth.speciality')} value={speciality} onChange={(e) => setSpeciality(e.target.value)} />
                        <input className={inputCls} placeholder={t('auth.license_number')} aria-label={t('auth.license_number')} value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
                        <input className={inputCls} inputMode="numeric" placeholder={t('auth.consult_fee')} aria-label={t('auth.consult_fee')} value={consultFee} onChange={(e) => setConsultFee(e.target.value.replace(/\D/g, ''))} />
                      </>
                    )}

                    {/* Champs établissement (pharmacie / labo) */}
                    {isEstablishment && (
                      <>
                        <input className={inputCls} placeholder={t('auth.establishment_name')} aria-label={t('auth.establishment_name')} value={establishmentName} onChange={(e) => setEstablishmentName(e.target.value)} />
                        <input className={inputCls} placeholder={t('auth.address_optional')} aria-label={t('auth.address_optional')} value={address} onChange={(e) => setAddress(e.target.value)} />
                      </>
                    )}
                  </>
                )}
                <input className={inputCls} inputMode="tel" placeholder={t('auth.phone')} aria-label={t('auth.phone')} value={phone} onChange={(e) => setPhone(e.target.value)} />
                <Button variant="sante" full onClick={sendCode} disabled={busy}>
                  {t('auth.send_code')}
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setMode((m) => (m === 'login' ? 'register' : 'login'));
                    setError(null);
                  }}
                  className="w-full text-center text-[0.8125rem] text-sante-700 underline decoration-dotted underline-offset-4"
                >
                  {mode === 'login' ? t('auth.new_account') : t('auth.have_account')}
                </button>
              </>
            ) : (
              <>
                {hint && <p className="text-[0.75rem] text-stone-500">{hint}</p>}
                <input
                  className={cn(inputCls, 'tracking-[0.4em] text-center font-display font-extrabold')}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder={t('auth.code')}
                  aria-label={t('auth.code')}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
                <Button variant="sante" full onClick={confirm} disabled={busy || code.length !== 6}>
                  {t('auth.verify')}
                </Button>
                <button type="button" onClick={sendCode} className="w-full text-center text-[0.8125rem] text-sante-700 underline decoration-dotted underline-offset-4">
                  {t('auth.resend')}
                </button>
              </>
            )}
            {error && <p className="text-[0.8125rem] text-sos-600 font-bold">{error}</p>}
          </div>
        </main>
      </div>
    </div>
  );
}
