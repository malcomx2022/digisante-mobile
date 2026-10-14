'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { PhrasebookPanel } from '@/components/chat/PhrasebookPanel';
import { Empty, ErrorState, Loading } from '@/components/ui/States';
import { useLocale } from '@/i18n/LocaleProvider';
import { cn } from '@/lib/cn';
import { chatApi, type ChatMessage, type ChatThread } from '@/lib/api/chat';
import { openChatSocket } from '@/lib/realtime/chatSocket';

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
  failed?: boolean;
}

// Le temps réel passe par WebSocket ; ce polling n'est qu'un filet de sécurité lent
// (réseaux/proxies bloquant le WS, reconnexion en cours).
const POLL_MS = 25000;

/**
 * Salle de messagerie réutilisable (patient et médecin).
 * `counterpartParam` = nom du paramètre d'URL portant l'id du correspondant à
 * ouvrir automatiquement (`doctor` côté patient, `patient` côté médecin).
 */
interface ChatRoomProps { theme: Theme; counterpartParam: 'doctor' | 'patient' }

function ChatRoomInner({ theme, counterpartParam }: ChatRoomProps) {
  const { t, lang } = useLocale();
  const params = useSearchParams();
  const ui = THEME[theme];

  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [text, setText] = useState('');
  const [showPhrasebook, setShowPhrasebook] = useState(false);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  const conversationEpoch = useRef(0);
  useEffect(() => () => { conversationEpoch.current += 1; selectedIdRef.current = null; }, []);

  function selectThread(threadId: string | null) {
    conversationEpoch.current += 1;
    selectedIdRef.current = threadId;
    setSelectedId(threadId);
    setMessages([]);
    setText('');
    setError(null);
    setShowPhrasebook(false);
  }

  const refreshThreads = useCallback(async () => {
    try {
      setThreads(await chatApi.listThreads());
    } catch {
      /* le rafraîchissement silencieux ne doit pas casser la conversation */
    }
  }, []);

  /** Charge les messages d'un fil (garde anti-course : ignore si le fil a changé). */
  const loadMessages = useCallback(
    async (threadId: string, markRead: boolean) => {
      const epoch = conversationEpoch.current;
      try {
        const msgs = await chatApi.listMessages(threadId);
        if (selectedIdRef.current !== threadId || conversationEpoch.current !== epoch) return;
        setMessages(msgs);
        if (markRead) chatApi.markRead(threadId).then(refreshThreads).catch(() => {});
      } catch (e) {
        if (selectedIdRef.current === threadId && conversationEpoch.current === epoch) {
          setError(e instanceof Error ? e.message : t('auth.error'));
        }
      }
    },
    [refreshThreads, t],
  );

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
          selectThread(threadParam);
        } else if (counterpartId) {
          const opened = await chatApi.openThread(counterpartId);
          if (!active) return;
          selectThread(opened.id);
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

  // Sélection d'un fil : chargement initial + filet de sécurité lent.
  useEffect(() => {
    selectedIdRef.current = selectedId;
    if (!selectedId) return;
    void loadMessages(selectedId, true);
    const iv = setInterval(() => {
      void loadMessages(selectedId, false);
      void refreshThreads();
    }, POLL_MS);
    return () => clearInterval(iv);
  }, [selectedId, loadMessages, refreshThreads]);

  // Temps réel : un push WS déclenche un re-fetch ciblé (contenu déchiffré via REST).
  useEffect(() => {
    const stop = openChatSocket((event) => {
      void refreshThreads();
      if (event.threadId === selectedIdRef.current) void loadMessages(event.threadId, true);
    });
    return stop;
  }, [loadMessages, refreshThreads]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Envoi (ou renvoi) d'un message optimiste identifié par une clé stable et unique.
  async function deliver(threadId: string, value: string, optimisticId: string) {
    const epoch = conversationEpoch.current;
    try {
      const res = await chatApi.sendMessage(threadId, value);
      if (selectedIdRef.current !== threadId || conversationEpoch.current !== epoch) return;
      if (res && typeof res === 'object' && 'queued' in res) return; // hors-ligne : reste « en attente »
      void loadMessages(threadId, false);
      void refreshThreads();
    } catch (e) {
      if (selectedIdRef.current !== threadId || conversationEpoch.current !== epoch) return;
      // Échec d'envoi : on marque le message optimiste comme ÉCHOUÉ (renvoi possible).
      setMessages((m) => m.map((msg) => (msg.id === optimisticId ? { ...msg, pending: false, failed: true } : msg)));
      setError(e instanceof Error ? e.message : t('auth.error'));
    }
  }

  async function send() {
    const value = text.trim();
    if (!value || !selectedId || selectedIdRef.current !== selectedId) return;
    setText('');
    const optimisticId = crypto.randomUUID();
    const optimistic: LocalMessage = {
      id: optimisticId,
      body: value,
      mine: true,
      readAt: null,
      createdAt: new Date(0).toISOString(),
      pending: true,
    };
    setMessages((m) => [...m, optimistic]);
    await deliver(selectedId, value, optimisticId);
  }

  // Renvoi d'un message en échec : on le repasse « en attente » puis on retente.
  async function resend(m: LocalMessage) {
    if (!selectedId) return;
    setMessages((cur) => cur.map((msg) => (msg.id === m.id ? { ...msg, failed: false, pending: true } : msg)));
    await deliver(selectedId, m.body, m.id);
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
            onClick={() => selectThread(th.id)}
            className="w-full text-left bg-white card-pagne border border-stone-200 px-4 py-3 flex items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              <p className="font-display font-bold text-[0.875rem] text-stone-800 truncate">{th.counterpart.name}</p>
              {th.counterpart.speciality && (
                <p className="text-[0.75rem] text-stone-500 truncate">{th.counterpart.speciality}</p>
              )}
            </div>
            {th.unreadCount > 0 && (
              <span className={cn('text-white text-[0.6875rem] font-bold rounded-full px-2 py-0.5', ui.unread)}>
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
        onClick={() => selectThread(null)}
        aria-label={t('common.back')}
        className="self-start text-[0.8125rem] text-stone-500 mb-2"
      >
        ← {current?.counterpart.name ?? t('chat.title')}
      </button>

      <div className="flex-1 space-y-2 py-2 overflow-y-auto">
        {messages.length === 0 && <Empty label={t('chat.empty')} />}
        {messages.map((m) => (
          <div key={m.id} className={cn('max-w-[78%]', m.mine ? 'ml-auto' : 'mr-auto')}>
            <div
              className={cn(
                'px-3 py-2 text-[0.875rem]',
                m.mine ? ui.mine : 'bg-white card-pagne border border-stone-200',
                m.pending && 'border-2 border-dashed border-ocre-400',
                m.failed && 'border-2 border-dashed border-sos-500 opacity-80',
              )}
            >
              {m.body}
            </div>
            {m.pending && <p className="text-[0.6875rem] text-ocre-600 mt-0.5 text-right">{t('chat.pending')}</p>}
            {m.failed && (
              <p className="text-[0.6875rem] mt-0.5 text-right">
                <span className="text-sos-600">⚠ {t('chat.failed')}</span>{' '}
                <button type="button" onClick={() => void resend(m)} className="text-sos-700 underline font-bold">
                  {t('common.retry')}
                </button>
              </p>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {showPhrasebook && (
        <PhrasebookPanel
          ownLang={lang}
          accent={theme === 'patient' ? 'bg-sante-600' : 'bg-indigo-600'}
          onPick={(phrase) => setText((cur) => (cur ? `${cur} ${phrase}` : phrase))}
          onClose={() => setShowPhrasebook(false)}
        />
      )}

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={() => setShowPhrasebook((v) => !v)}
          aria-label={t('phrasebook.title')}
          aria-pressed={showPhrasebook}
          className={cn(
            'card-pagne border px-3 font-display font-bold text-[0.8125rem]',
            showPhrasebook ? `${ui.send} text-white border-transparent` : 'bg-white text-stone-600 border-stone-300',
          )}
        >
          🗣
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Ne pas envoyer pendant une composition IME (Fɔ̀ngbè/Yorùbá, accents).
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send();
          }}
          placeholder={t('chat.placeholder')}
          className={cn('flex-1 bg-white card-pagne border border-stone-300 px-3 py-2 text-[0.875rem] focus:outline-none', ui.focus)}
        />
        <button type="button" onClick={send} className={cn('text-white font-display font-bold card-pagne px-4 pagne-focus', ui.send)}>
          {t('chat.send')}
        </button>
      </div>
    </div>
  );
}

export function ChatRoom(props: ChatRoomProps) {
  const params = useSearchParams();
  // L'URL change sans rechargement : le nouveau destinataire repart sans
  // brouillon, messages ou réponse asynchrone appartenant au fil précédent.
  const key = JSON.stringify([props.theme, props.counterpartParam, params.get('thread'), params.get(props.counterpartParam)]);
  return <ChatRoomInner key={key} {...props} />;
}
