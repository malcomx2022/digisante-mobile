'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, KenteBar, StatusBar } from '@/components/ui';
import { useAuth } from '@/auth/AuthProvider';
import { spaceFor } from '@/auth/spaces';
import { useLocale } from '@/i18n/LocaleProvider';
import { cn } from '@/lib/cn';

// D-02 — Connexion / inscription par téléphone + OTP.
export default function LoginPage() {
  const { lang, t } = useLocale();
  const { register, requestOtp, verifyOtp } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('+229');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [code, setCode] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const otp =
        mode === 'register'
          ? await register({ phone, firstName, lastName, role: 'PATIENT', lang })
          : await requestOtp(phone);
      setHint(otp.devCode ? `${t('auth.code_sent')} (dev: ${otp.devCode})` : t('auth.code_sent'));
      setStep('code');
    } catch {
      setError(t('auth.error'));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const user = await verifyOtp(phone, code);
      router.replace(spaceFor(user.role));
    } catch {
      setError(t('auth.error'));
    } finally {
      setBusy(false);
    }
  }

  const inputCls = 'w-full bg-white card-pagne border border-stone-300 px-4 py-3 font-body text-[15px] focus:outline-none focus:border-sante-600';

  return (
    <div className="min-h-screen wax-light">
      <div className="mx-auto max-w-[420px] min-h-screen bg-creme flex flex-col shadow-xl">
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
                  <div className="flex gap-2">
                    <input className={inputCls} placeholder={t('auth.firstname')} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                    <input className={inputCls} placeholder={t('auth.lastname')} value={lastName} onChange={(e) => setLastName(e.target.value)} />
                  </div>
                )}
                <input className={inputCls} inputMode="tel" placeholder={t('auth.phone')} value={phone} onChange={(e) => setPhone(e.target.value)} />
                <Button variant="sante" full onClick={sendCode} disabled={busy}>
                  {t('auth.send_code')}
                </Button>
                <button
                  type="button"
                  onClick={() => setMode((m) => (m === 'login' ? 'register' : 'login'))}
                  className="w-full text-center text-[13px] text-sante-700 underline decoration-dotted underline-offset-4"
                >
                  {mode === 'login' ? t('auth.new_account') : t('auth.have_account')}
                </button>
              </>
            ) : (
              <>
                {hint && <p className="text-[12px] text-stone-500">{hint}</p>}
                <input
                  className={cn(inputCls, 'tracking-[0.4em] text-center font-display font-extrabold')}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder={t('auth.code')}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
                <Button variant="sante" full onClick={confirm} disabled={busy || code.length !== 6}>
                  {t('auth.verify')}
                </Button>
                <button type="button" onClick={sendCode} className="w-full text-center text-[13px] text-sante-700 underline decoration-dotted underline-offset-4">
                  {t('auth.resend')}
                </button>
              </>
            )}
            {error && <p className="text-[13px] text-sos-600 font-bold">{error}</p>}
          </div>
        </main>
      </div>
    </div>
  );
}
