import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Timer, EyeOff, Flag, CornerUpLeft,
  Pencil, Trash2, Send, X, Smile, Search,
} from 'lucide-react';
import { api, apiError } from '../lib/api';
import { getGlobalSocket } from '../lib/socket';
import { useAuth } from '../store/auth';
import type { GlobalMessage as GMsg, GlobalMeta } from '../types';
import Avatar, { colorFor } from '../components/common/Avatar';
import DateChip, { dayLabel } from '../components/common/DateChip';
import GlowButton from '../components/uiverse/GlowButton';
import { Spinner } from '../components/uiverse/Spinner';
import UserProfileModal from '../components/common/UserProfileModal';

const QUICK_EMOJIS = ['❤️', '🔥', '😂', '😮', '👍', '🎉'];

export default function GlobalChat() {
  const qc = useQueryClient();
  const { me } = useAuth();
  const socket = getGlobalSocket();

  const [messages, setMessages] = useState<GMsg[]>([]);
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState<GMsg | null>(null);
  const [editing, setEditing] = useState<GMsg | null>(null);
  const [ttl, setTtl] = useState(0);
  const [anonymous, setAnonymous] = useState(false);
  const [storm, setStorm] = useState<{ id: number; emoji: string; x: number }[]>([]);
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [profileId, setProfileId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<GMsg[]>([]);
  const [searchingMsgs, setSearchingMsgs] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<number | null>(null);

  const metaQuery = useQuery({
    queryKey: ['global-meta'],
    queryFn: async () => (await api.get('/global/meta')).data as GlobalMeta,
    refetchInterval: 30_000,
  });
  const [searchMode, setSearchMode] = useState<'latest' | 'trending' | 'questions'>('latest');
  const onlineCount = metaQuery.data?.onlineCount ?? 0;

  // ---------- history + socket wiring ----------
  useEffect(() => {
    let cancelled = false;
    api.get(`/global/messages?limit=60&mode=${searchMode}`)
      .then(({ data }) => {
        if (!cancelled) {
          const d = data as { messages: GMsg[]; nextBefore: string | null };
          setMessages(d.messages);
          setNextBefore(d.nextBefore);
        }
      })
      .catch(() => setError('Could not load global messages'));

    const onMessage = (m: GMsg) => {
      setMessages((prev) => (prev.some((p) => p._id === m._id) ? prev : [...prev, m]));
      qc.invalidateQueries({ queryKey: ['global-meta'] });
    };
    // Server is the single source of truth for reactions: it emits the full
    // reactions + reactors arrays, so we replace the row. `removed` is true
    // when THIS user just un-reacted — don't treat that as a new emoji drop.
    const onReaction = (p: {
      messageId: string; reactions: GMsg['reactions']; reactors: GMsg['reactors']; by: string; emoji: string; removed: boolean;
    }) => {
      setMessages((prev) => prev.map((m) => (m._id === p.messageId ? { ...m, reactions: p.reactions, reactors: p.reactors } : m)));
      if (p.by !== me?.id && !p.removed) {
        const id = Date.now() + Math.random();
        setStorm((s) => [...s, { id, emoji: p.emoji, x: Math.random() * 80 + 10 }]);
        setTimeout(() => setStorm((s) => s.filter((e) => e.id !== id)), 1500);
      }
    };
    const onUpdated = (p: { messageId: string; text: string; mentions?: GMsg['mentions'] }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m._id === p.messageId
            ? { ...m, text: p.text, mentions: p.mentions ?? m.mentions, isEdited: true }
            : m
        )
      );
    };
    const onDeleted = (p: { messageId: string }) => {
      setMessages((prev) => prev.map((m) => (m._id === p.messageId ? { ...m, isDeleted: true, text: '' } : m)));
    };
    const onTyping = (p: { userId: string; username: string }) => {
      if (p.userId === me?.id) return;
      setTyping((t) => ({ ...t, [p.userId]: p.username }));
      setTimeout(() => {
        setTyping((t) => {
          const n = { ...t };
          delete n[p.userId];
          return n;
        });
      }, 2600);
    };
    const onStop = (p: { userId: string }) => {
      setTyping((t) => {
        const n = { ...t };
        delete n[p.userId];
        return n;
      });
    };

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('global:message', onMessage);
    socket.on('global:reaction', onReaction);
    socket.on('global:messageUpdated', onUpdated);
    socket.on('global:messageDeleted', onDeleted);
    socket.on('global:typing', onTyping);
    socket.on('global:stopTyping', onStop);
    socket.on('global:report', (p: { messageId: string; reportCount: number; moderationStatus: 'none' | 'open' | 'resolved' }) => {
      setMessages((prev) => prev.map((m) =>
        m._id === p.messageId ? { ...m, reportCount: p.reportCount, moderationStatus: p.moderationStatus } : m
      ));
    });
    socket.connect();

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('global:message', onMessage);
      socket.off('global:reaction', onReaction);
      socket.off('global:messageUpdated', onUpdated);
      socket.off('global:messageDeleted', onDeleted);
      socket.off('global:typing', onTyping);
      socket.off('global:stopTyping', onStop);
    };
  }, [socket, me?.id, qc]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // ---------- message search (debounced) ----------
  useEffect(() => {
    const q = searchQ.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      setSearchingMsgs(true);
      api.get('/global/search', { params: { q } })
        .then(({ data }) => {
          if (!cancelled) setSearchResults((data as { messages: GMsg[] }).messages);
        })
        .catch(() => {
          if (!cancelled) setSearchResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearchingMsgs(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [searchQ]);

  const scrollToMessage = (id: string) => {
    window.setTimeout(() => {
      const el = document.querySelector(`[data-mid="${id}"]`);
      el?.scrollIntoView({ block: 'center' });
      setHighlightId(id);
      window.setTimeout(() => setHighlightId((h) => (h === id ? null : h)), 1800);
    }, 120);
  };

  // Jump: scroll if already loaded, otherwise page through older history until found.
  const jumpToMessage = async (target: GMsg) => {
    if (messages.some((m) => m._id === target._id)) {
      scrollToMessage(target._id);
      return;
    }
    let cursor = nextBefore;
    for (let i = 0; i < 15 && cursor; i++) {
      const { data } = await api.get(`/global/messages?limit=100&before=${cursor}`);
      const d = data as { messages: GMsg[]; nextBefore: string | null };
      if (!d.messages.length) break;
      setMessages((prev) => {
        const seen = new Set(prev.map((p) => p._id));
        return [...d.messages.filter((c) => !seen.has(c._id)), ...prev];
      });
      cursor = d.nextBefore;
      setNextBefore(cursor);
      if (d.messages.some((c) => c._id === target._id)) break;
    }
    scrollToMessage(target._id);
  };

  const visible = useMemo(() => messages.filter((m) => !m.isDeleted), [messages]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setError('');
    if (editing) {
      socket.emit('global:edit', { messageId: editing._id, text }, (res: { error?: string }) => {
        if (res?.error) setError(res.error);
        setEditing(null);
        setInput('');
      });
      return;
    }
    socket.emit(
      'global:send',
      { text, kind: text.endsWith('?') ? 'question' : 'message', replyToId: replyTo?._id, ttlMinutes: ttl, anonymous },
      (res: { error?: string }) => {
        if (res?.error) {
          setError(res.error);
          setCooldownUntil(Date.now() + 1200);
        }
      }
    );
    setInput('');
    setReplyTo(null);
    setTtl(0);
  }, [input, editing, replyTo, ttl, anonymous, socket]);

  // Optimistic update is owned entirely by the socket: the server emits the
  // full `global:reaction` payload (reactions + reactors), and this handler
  // replaces the row wholesale, so no client-local arithmetic here.
  const react = (m: GMsg, emoji: string) => {
    socket.emit('global:reaction', { messageId: m._id, emoji });
  };

  const onInputChange = (v: string) => {
    setInput(v);
    if (typingTimer.current && Date.now() - typingTimer.current < 1200) return;
    typingTimer.current = Date.now();
    socket.emit('global:typing');
  };

  const meta = metaQuery.data;

  // group by day
  const grouped = useMemo(() => {
    const out: { day: string; items: GMsg[] }[] = [];
    for (const m of visible) {
      const day = dayLabel(m.createdAt);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(m);
      else out.push({ day, items: [m] });
    }
    return out;
  }, [visible]);

  return (
    <div className="flex-1 min-w-0 flex flex-col h-full wa-canvas relative">
      {/* header — global identity kept distinct */}
      <header className="h-[59px] shrink-0 bg-[var(--wa-panel-2)] px-3 sm:px-4 flex items-center gap-2 sm:gap-3 border-l border-[var(--wa-border)]">
        <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-sky-400 to-sky-700 flex items-center justify-center text-lg sm:text-xl shrink-0">🌍</div>
        <div className="min-w-0">
          <h1 className="font-medium text-[14.5px] sm:text-[15px] leading-tight flex items-center gap-2">
            Global Chat
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${connected ? 'bg-[var(--wa-green)]/20 text-[var(--wa-green-hover)]' : 'bg-rose-500/20 text-rose-300'}`}>
              {connected ? 'LIVE' : '…'}
            </span>
          </h1>
          <div className="text-[11.5px] sm:text-[12px] text-[var(--wa-text-2)] flex items-center gap-1.5 truncate">
            <span className="hidden min-[420px]:flex items-center gap-1 shrink-0">
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              {onlineCount ?? '—'} online
            </span>
            <span className="text-[var(--wa-text-2)] hidden min-[420px]:inline">·</span>
            <div className="flex items-center gap-1.5">
              {(['latest', 'trending', 'questions'] as const).map((m) => (
                <button
                  key={m}
                  className={`text-[11px] px-1.5 py-0.5 rounded-full transition cursor-pointer ${
                    searchMode === m
                      ? 'bg-[var(--wa-active)] text-[var(--wa-text)]'
                      : 'text-[var(--wa-text-2)] hover:bg-[var(--wa-hover)] hover:text-[var(--wa-text)]'
                  }`}
                  title={m === 'trending' ? 'Trending now' : m === 'latest' ? 'Latest first' : 'Question mode'}
                  onClick={() => setSearchMode(m)}
                >
                  {m === 'latest' ? 'Latest' : m === 'trending' ? '🔥 Trending' : 'Questions'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <button
            className={`p-2 rounded-full transition cursor-pointer ${
              searchOpen ? 'bg-[var(--wa-active)] text-[var(--wa-text)]' : 'text-[var(--wa-text-2)] hover:bg-[var(--wa-hover)] hover:text-[var(--wa-text)]'
            }`}
            title="Search messages"
            onClick={() => setSearchOpen((o) => !o)}
          >
            <Search size={17} />
          </button>
        </div>
      </header>

      {/* message search */}
      {searchOpen && (
        <div className="shrink-0 border-b border-[var(--wa-border)] bg-[var(--wa-panel-2)] px-3 py-2 z-30">
          <div className="flex items-center gap-2 bg-[var(--wa-search)] rounded-lg px-3 py-1.5 border border-white/5">
            <Search size={14} className="text-[var(--wa-text-2)] shrink-0" />
            <input
              autoFocus
              className="bg-transparent outline-none text-[13.5px] w-full placeholder:text-[var(--wa-text-2)]"
              placeholder="Search global messages"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
            />
            {searchingMsgs && <Spinner size={12} />}
            <button
              className="text-[var(--wa-text-2)] hover:text-[var(--wa-text)] shrink-0"
              title="Close search"
              onClick={() => {
                setSearchOpen(false);
                setSearchQ('');
              }}
            >
              <X size={14} />
            </button>
          </div>
          {searchQ.trim() && (
            <div className="mt-2 max-h-52 overflow-y-auto wa-scroll space-y-1">
              {searchResults.length === 0 && !searchingMsgs && (
                <p className="text-[13px] text-[var(--wa-text-2)] px-1 py-1">No messages found for "{searchQ}"</p>
              )}
              {searchResults.map((r) => (
                <button
                  key={r._id}
                  onClick={() => jumpToMessage(r)}
                  className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[var(--wa-active)] flex items-start gap-2 cursor-pointer"
                >
                  <Avatar
                    src={!r.isAnonymous ? r.senderAvatar || undefined : undefined}
                    name={r.isAnonymous ? '?' : r.senderDisplayName}
                    size={24}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="flex justify-between gap-2 text-[11px] text-[var(--wa-text-2)]">
                      <span className="truncate font-medium">{r.isAnonymous ? 'anonymous' : r.senderDisplayName}</span>
                      <span className="shrink-0">{new Date(r.createdAt).toLocaleString()}</span>
                    </span>
                    <span className="block text-[13px] text-[var(--wa-text)] truncate">{r.text}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* messages */}
      <div className="flex-1 overflow-y-auto wa-scroll py-3">
        {messages.length === 0 && (
          <div className="h-[70%] flex flex-col items-center justify-center text-center text-[var(--wa-text-2)] gap-2 px-10">
            <span className="text-5xl mb-2">🌍</span>
            <p className="text-[16px] text-[var(--wa-text)]">Be the first to say hello to the world</p>
            <p className="text-[13px]">This is the ONE global chat — no rooms, no servers. Be kind.</p>
          </div>
        )}

        {grouped.map((g) => (
          <div key={g.day}>
            <DateChip iso={g.items[0].createdAt} />
            <AnimatePresence initial={false}>
              {g.items.map((m) => (
                <GlobalMessageRow
                  key={m._id}
                  m={m}
                  mine={m.senderId === me?.id}
                  flash={highlightId === m._id}
                  onMention={(userId) => setProfileId(userId)}
                  onReply={(userId) => {
                    setReplyTo({ ...m, replyToId: m._id, senderId: userId });
                    inputRef.current?.focus();
                  }}
                  onSearch={(q) => setSearchQ(q)}
                  onReact={(e) => react(m, e)}
                  onEdit={() => {
                    setEditing(m);
                    setInput(m.text);
                    inputRef.current?.focus();
                  }}
                  onDelete={() => socket.emit('global:delete', { messageId: m._id })}
                  onReport={() => socket.emit('global:report', { messageId: m._id, reason: 'inappropriate' })}
                  onProfile={() => setProfileId(m.senderId)}
                />
              ))}
            </AnimatePresence>
          </div>
        ))}

        {Object.keys(typing).length > 0 && (
          <div className="wa-row in">
            <div className="wa-bubble in flex items-center gap-1 py-3">
              <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
              <span className="text-[11px] text-[var(--wa-text-2)] ml-1">
                {Object.values(typing).slice(0, 2).join(', ')} {Object.keys(typing).length > 1 ? 'are' : 'is'} typing
              </span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* reaction storm */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {storm.map((s) => (
          <span key={s.id} className="storm-emoji" style={{ left: `${s.x}%`, bottom: '90px' }}>{s.emoji}</span>
        ))}
      </div>

      {/* composer */}
      <div className="shrink-0 bg-[var(--wa-panel)] px-2 sm:px-3 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] sm:pb-2.5 relative">
        {replyTo && (
          <div className="mb-2 flex items-center gap-2 text-[12.5px] bg-[var(--wa-panel-2)] border-l-[3px] border-sky-400 rounded-lg px-3 py-2">
            <div className="flex-1 min-w-0">
              <div className="text-sky-300 font-medium text-[12px]">{replyTo.isAnonymous ? 'anonymous' : replyTo.senderDisplayName}</div>
              <div className="text-[var(--wa-text-2)] truncate">{replyTo.text}</div>
            </div>
            <button className="text-[var(--wa-text-2)]" onClick={() => setReplyTo(null)}><X size={16} /></button>
          </div>
        )}
        {editing && (
          <div className="mb-2 flex items-center gap-2 text-[12.5px] bg-[var(--wa-panel-2)] border-l-[3px] border-amber-400 rounded-lg px-3 py-2">
            <div className="flex-1">Editing message</div>
            <button className="text-[var(--wa-text-2)]" onClick={() => { setEditing(null); setInput(''); }}><X size={16} /></button>
          </div>
        )}
        {error && <p className="text-[12px] text-rose-400 mb-1.5">{error}</p>}
        <div className="flex items-center gap-2">
          <button
            className={`w-10 h-10 rounded-full flex items-center justify-center transition ${ttl > 0 ? 'bg-amber-500/20 text-amber-300' : 'text-[var(--wa-text-2)] hover:bg-[var(--wa-active)]'}`}
            title="Expiring message (10 min)"
            onClick={() => setTtl((t) => (t > 0 ? 0 : 10))}
          >
            <Timer size={20} />
          </button>
          {me && !me.isGuest && (
            <button
              className={`w-10 h-10 rounded-full flex items-center justify-center transition ${anonymous ? 'bg-violet-500/20 text-violet-300' : 'text-[var(--wa-text-2)] hover:bg-[var(--wa-active)]'}`}
              title="Anonymous mode (enable in Settings first)"
              onClick={() => setAnonymous((a) => !a)}
            >
              <EyeOff size={20} />
            </button>
          )}
          <button
            className="w-10 h-10 rounded-full flex items-center justify-center text-[var(--wa-text-2)] hover:bg-[var(--wa-active)] hover:text-[var(--wa-text)] transition"
            title="Emoji"
            onClick={() => setEmojiOpen((o) => !o)}
          >
            <Smile size={22} />
          </button>
          {emojiOpen && (
            <div className="absolute bottom-16 left-3 bg-[var(--wa-panel-2)] border border-[var(--wa-border)] rounded-2xl shadow-2xl p-3 grid grid-cols-6 gap-1 z-20">
              {['😀', '😂', '🥲', '😍', '🤔', '👍', '🙏', '🔥', '🎉', '❤️', '😭', '😮', '🤝', '💯', '😎', '🥳', '🌍', '✨'].map((e) => (
                <button
                  key={e}
                  className="w-9 h-9 rounded-full hover:bg-[var(--wa-active)] text-xl flex items-center justify-center"
                  onClick={() => {
                    setInput((v) => v + e);
                    setEmojiOpen(false);
                    inputRef.current?.focus();
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
          <input
            ref={inputRef}
            className="flex-1 min-w-0 bg-[var(--wa-panel-2)] rounded-lg px-3 sm:px-4 py-2.5 text-[14.5px] outline-none placeholder:text-[var(--wa-text-2)]"
            placeholder={me?.isGuest ? 'Say hi to the world…' : 'Message the whole world…'}
            value={input}
            maxLength={1000}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            className="w-10 h-10 rounded-full bg-[var(--wa-green)] text-[#0b141a] flex items-center justify-center hover:bg-[var(--wa-green-hover)] transition disabled:opacity-40"
            onClick={send}
            disabled={!input.trim() || cooldownUntil > Date.now()}
            title="Send"
          >
            <Send size={18} />
          </button>
        </div>
      </div>

      <UserProfileModal userId={profileId} onClose={() => setProfileId(null)} />
    </div>
  );
}

// ---------------- message row ----------------
function GlobalMessageRow({
  m, mine, flash, onMention, onReply, onSearch, onReact, onEdit, onDelete, onReport, onProfile,
}: {
  m: GMsg; mine: boolean; flash?: boolean;
  onMention: (userId: string) => void;
  onReply: (userId: string) => void; onSearch: (q: string) => void;
  onReact: (emoji: string) => void; onEdit: () => void;
  onDelete: () => void; onReport: () => void; onProfile: () => void;
}) {
  return (
    <div data-mid={m._id} className={`wa-row ${mine ? 'out' : 'in'} group ${flash ? 'msg-flash' : ''}`}>
      {!mine && (
        <button onClick={onProfile} className="self-end mr-2 mb-1 shrink-0" title="View profile">
          <Avatar
            src={!m.isAnonymous ? m.senderAvatar || undefined : undefined}
            name={m.isAnonymous ? '?' : m.senderDisplayName}
            size={28}
          />
        </button>
      )}
      <div className="wa-bubble in">
        {m.replySnapshot && (
          <div className="text-[12.5px] rounded-md px-2 py-1 mb-1 border-l-[3px] border-sky-400 bg-black/20">
            <div className="text-sky-300 font-medium text-[12px]">{m.replySnapshot.username}</div>
            <div className="text-[var(--wa-text-2)] truncate text-[12px]">{m.replySnapshot.text}</div>
          </div>
        )}
        {/* sender name (like WhatsApp groups) */}
        {!mine && (
          <button onClick={onProfile} className="block text-[12.5px] font-semibold hover:underline" style={{ color: m.isAnonymous ? '#8696a0' : colorFor(m.senderId) }}>
            {m.isAnonymous ? 'anonymous' : m.senderDisplayName}
          </button>
        )}
        {m.kind === 'question' && (
          <span className="inline-block text-[10px] bg-violet-500/20 text-violet-300 px-1.5 py-0.5 rounded-full font-semibold mb-0.5">Question</span>
        )}
        <span className="text-[14.2px]">
          {m.isDeleted ? <i className="opacity-60">🚫 This message was deleted</i> : renderMentions(m.text, m.mentions, onMention, onReply, onSearch)}
          {m.isEdited && !m.isDeleted && <span className="text-[11px] opacity-50 ml-1">edited</span>}
        </span>
        <span className="wa-meta">
          {m.expiresAt && <Timer size={10} className="text-amber-400" />}
          {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
        {m.reactions.length > 0 && (
          <div className="text-[11px] text-[var(--wa-text-2)] mt-1 flex items-center gap-2">
            <span className="text-[var(--wa-text-3)]">{m.reactions.reduce((acc, r) => acc + r.count, 0)}</span>
            <span className="text-[var(--wa-text-2)]">reacted</span>
          </div>
        )}
        {m.reactions.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {m.reactions.map((r) => (
              <button
                key={r.emoji}
                className="text-[11px] bg-black/25 hover:bg-black/40 rounded-full px-1.5 leading-5"
                title={`${r.emoji} ${r.count}`}
                onClick={() => onReact(r.emoji)}
              >
                {r.emoji}{r.count > 1 ? ` ${r.count}` : ''}
              </button>
            ))}
          </div>
        )}
        {/* hover actions */}
        <div className="absolute -top-3 right-2 hidden group-hover:flex items-center gap-0.5 bg-[var(--wa-panel-2)] border border-[var(--wa-border)] rounded-full px-1 shadow-lg z-10">
          {QUICK_EMOJIS.map((e) => (
            <button key={e} className="text-[13px] hover:scale-125 transition-transform px-0.5" onClick={() => onReact(e)}>{e}</button>
          ))}
          <button className="text-[13px] text-[var(--wa-text-2)] hover:text-[var(--wa-green-hover)] hover:scale-125 transition-transform px-0.5" title="Search this message" onClick={() => onSearch(m.text.slice(0, 60))}>
            <Search size={13} />
          </button>
          <span className="w-px h-4 bg-[var(--wa-border)] mx-0.5" />
          <button className="p-1 text-[var(--wa-text-2)] hover:text-sky-300" title="Reply" onClick={() => onReply(m.senderId)}>
            <CornerUpLeft size={12} />
          </button>
          {mine && (
            <>
              <button className="p-1 text-[var(--wa-text-2)] hover:text-amber-300" title="Edit" onClick={onEdit}><Pencil size={12} /></button>
              <button className="p-1 text-[var(--wa-text-2)] hover:text-rose-400" title="Delete" onClick={onDelete}><Trash2 size={12} /></button>
            </>
          )}
          {!mine && (
            <button className="p-1 text-[var(--wa-text-2)] hover:text-rose-400" title="Report" onClick={onReport}><Flag size={12} /></button>
          )}
        </div>
      </div>
      {mine && (
        <div className="w-7 shrink-0" />
      )}
    </div>
  );
}

/** Highlight @handles that resolve to real users; click opens their profile. */
function renderMentions(
  text: string,
  mentions: GMsg['mentions'],
  onMention: (userId: string) => void,
  onReply: (userId: string) => void,
  onSearch: (q: string) => void,
) {
  const byHandle = new Map((mentions ?? []).map((x) => [x.username.toLowerCase(), x.userId]));
  return text.split(/(@[A-Za-z0-9_.]{2,30})/g).map((part, i) => {
    const handle = part.startsWith('@') ? part.slice(1).toLowerCase() : '';
    const uid = handle ? byHandle.get(handle) : undefined;
    if (!uid) return <span key={i}>{part}</span>;
    return (
      <span key={i} className="flex items-center gap-1">
        <button
          className="mention cursor-pointer text-[var(--wa-text)] hover:text-[var(--wa-green-hover)]"
          title={`View @${handle}`}
          onClick={() => onMention(uid)}
        >
          {part}
        </button>
        <button
          className="text-[10px] text-[var(--wa-text-2)] hover:text-[var(--wa-green-hover)] cursor-pointer"
          title="Reply to @handle"
          onClick={() => onReply(uid)}
        >
          <CornerUpLeft size={11} />
        </button>
        <button
          className="text-[10px] text-[var(--wa-text-2)] hover:text-[var(--wa-green-hover)] cursor-pointer"
          title="Search this message"
          onClick={() => onSearch(part.slice(1))}
        >
          <Search size={10} />
        </button>
      </span>
    );
  });
}


