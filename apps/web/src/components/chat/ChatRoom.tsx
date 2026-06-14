'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { Empty, ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { cn } from '@/lib/cn';
import { chatApi, type ChatMessage, type ChatThread } from '@/lib/api/chat';
import { useOnline } from '@/lib/offline/online';

type Theme = 'patient' | 'pro';

const THEME: Record<Theme, { mine: string; send: string; focus: string; unread: string }> = {
  patient: {
    mine: 'bg-sante-600 text-white clip-inv',
    send: 'bg-terre-500',
    focus: 'focus:border-sante-600',
    unread: 'bg-sante-600',
  },
  pro: {
    mine: 'bg-indigo-600 text-white clip-inv',
    send: 'bg-indigo-600',
    focus: 'focus:border-indigo-600',
    unread: 'bg-terre-500',
  },
};

interface LocalMessage extends ChatMessage {
  pending?: boolean;
}

const POLL_MS = 5000;

/**
 * Salle de messagerie réutilisable (patient et médecin).
 * `counterpartParam` = nom du paramètre d'URL portant l'id du correspondant à
 * ouvrir automatiquement (`doctor` côté patient, `patient` côté médecin).
 */
export function ChatRoom({ theme, counterpartParam }: { theme: Theme; counterpartParam: 'doctor' | 'patient' }) {
  const { t } = useLocale();
  const online = useOnline();
  const params = useSearchParams();
  const ui = THEME[theme];

  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [text, setText] = useState('');
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const refreshThreads = useCallback(async () => {
    try {
      setThreads(await chatApi.listThreads());
    } catch {
      /* le rafraîchissement silencieux ne doit pas casser la conversation */
    }
  }, []);

  // Chargement initial + ouverture automatique d'un fil depuis l'URL.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await chatApi.listThreads();
        if (!active) return;
        setThreads(list);
        const threadParam = params.get('thread');
        const counterpartId = params.get(counterpartParam);
        if (threadParam) {
          setSelectedId(threadParam);
        } else if (counterpartId) {
          const opened = await chatApi.openThread(counterpartId);
          if (!active) return;
          setSelectedId(opened.id);
          setThreads((cur) => (cur.some((c) => c.id === opened.id) ? cur : [opened, ...cur]));
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : t('auth.error'));
      } finally {
        if (active) setBooting(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Chargement + polling des messages du fil sélectionné.
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    const load = async (markRead: boolean) => {
      try {
        const msgs = await chatApi.listMessages(selectedId);
        if (!active) return;
        setMessages(msgs);
        if (markRead) {
          chatApi.markRead(selectedId).then(refreshThreads).catch(() => {});
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : t('auth.error'));
      }
    };
    void load(true);
    const iv = setInterval(() => {
      void load(false);
      void refreshThreads();
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const value = text.trim();
    if (!value || !selectedId) return;
    setText('');
    const optimistic: LocalMessage = {
      id: `tmp-${value.length}-${messages.length}`,
      body: value,
      mine: true,
      readAt: null,
      createdAt: new Date(0).toISOString(),
      pending: !online,
    };
    setMessages((m) => [...m, optimistic]);
    try {
      const res = await chatApi.sendMessage(selectedId, value);
      if (res && typeof res === 'object' && 'queued' in res) return; // hors-ligne : reste « en attente »
      const msgs = await chatApi.listMessages(selectedId);
      setMessages(msgs);
      void refreshThreads();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.error'));
    }
  }

  if (booting) return <Loading label={t('common.loading')} />;
  if (error && messages.length === 0 && threads.length === 0) return <ErrorState label={error} />;

  // ── Vue liste des conversations ──
  if (!selectedId) {
    if (threads.length === 0) return <Empty label={t('chat.no_threads')} />;
    return (
      <div className="space-y-2">
        {threads.map((th) => (
          <button
            key={th.id}
            type="button"
            onClick={() => setSelectedId(th.id)}
            className="w-full text-left bg-white card-pagne border border-stone-200 px-4 py-3 flex items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              <p className="font-display font-bold text-[14px] text-stone-800 truncate">{th.counterpart.name}</p>
              {th.counterpart.speciality && (
                <p className="text-[12px] text-stone-500 truncate">{th.counterpart.speciality}</p>
              )}
            </div>
            {th.unreadCount > 0 && (
              <span className={cn('text-white text-[11px] font-bold rounded-full px-2 py-0.5', ui.unread)}>
                {th.unreadCount}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }

  // ── Vue conversation ──
  const current = threads.find((th) => th.id === selectedId);
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <button
        type="button"
        onClick={() => setSelectedId(null)}
        className="self-start text-[13px] text-stone-500 mb-2"
      >
        ← {current?.counterpart.name ?? t('chat.title')}
      </button>

      <div className="flex-1 space-y-2 py-2 overflow-y-auto">
        {messages.length === 0 && <Empty label={t('chat.empty')} />}
        {messages.map((m) => (
          <div key={m.id} className={cn('max-w-[78%]', m.mine ? 'ml-auto' : 'mr-auto')}>
            <div
              className={cn(
                'px-3 py-2 text-[14px]',
                m.mine ? ui.mine : 'bg-white card-pagne border border-stone-200',
                m.pending && 'border-2 border-dashed border-ocre-400',
              )}
            >
              {m.body}
            </div>
            {m.pending && <p className="text-[11px] text-ocre-600 mt-0.5 text-right">{t('chat.pending')}</p>}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="flex gap-2 pt-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={t('chat.placeholder')}
          className={cn('flex-1 bg-white card-pagne border border-stone-300 px-3 py-2 text-[14px] focus:outline-none', ui.focus)}
        />
        <button type="button" onClick={send} className={cn('text-white font-display font-bold card-pagne px-4', ui.send)}>
          {t('chat.send')}
        </button>
      </div>
    </div>
  );
}
