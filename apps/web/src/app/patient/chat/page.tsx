'use client';

import { useState } from 'react';

import { PatientHeader } from '@/components/patient/PatientHeader';
import { useLocale } from '@/i18n/LocaleProvider';
import { useOnline } from '@/lib/offline/online';
import { cn } from '@/lib/cn';

interface Msg {
  id: number;
  from: 'me' | 'doctor';
  text: string;
  pending?: boolean;
}

// D-10 — Chat faible connexion (bulles patient coin inversé, file d'attente offline).
export default function ChatPage() {
  const { t } = useLocale();
  const online = useOnline();
  const [messages, setMessages] = useState<Msg[]>([{ id: 1, from: 'doctor', text: 'Kú dó gbɛ̀ 👋 Comment allez-vous ?' }]);
  const [text, setText] = useState('');

  function send() {
    if (!text.trim()) return;
    setMessages((m) => [...m, { id: Date.now(), from: 'me', text, pending: !online }]);
    setText('');
  }

  return (
    <>
      <PatientHeader title={t('chat.title')} />
      <main className="px-4 -mt-8 relative z-20 flex-1 flex flex-col pb-4">
        <div className="flex-1 space-y-2 py-2">
          {messages.map((m) => (
            <div key={m.id} className={cn('max-w-[78%]', m.from === 'me' ? 'ml-auto' : 'mr-auto')}>
              <div
                className={cn(
                  'px-3 py-2 text-[14px]',
                  m.from === 'me' ? 'bg-sante-600 text-white clip-inv' : 'bg-white card-pagne border border-stone-200',
                  m.pending && 'border-2 border-dashed border-ocre-400',
                )}
              >
                {m.text}
              </div>
              {m.pending && <p className="text-[11px] text-ocre-600 mt-0.5 text-right">{t('chat.pending')}</p>}
            </div>
          ))}
        </div>

        <div className="flex gap-2 pt-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder={t('chat.placeholder')}
            className="flex-1 bg-white card-pagne border border-stone-300 px-3 py-2 text-[14px] focus:outline-none focus:border-sante-600"
          />
          <button type="button" onClick={send} className="bg-terre-500 text-white font-display font-bold card-pagne px-4">
            {t('chat.send')}
          </button>
        </div>
      </main>
    </>
  );
}
