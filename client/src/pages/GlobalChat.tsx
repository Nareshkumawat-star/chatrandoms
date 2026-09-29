import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Flame, Timer, EyeOff, SlidersHorizontal, TrendingUp, Flag, CornerUpLeft,
  Pencil, Trash2, Sparkles, Activity, Globe, Send, X, Smile,
} from 'lucide-react';
import { api, apiError } from '../lib/api';
import { getGlobalSocket } from '../lib/socket';
import { useAuth } from '../store/auth';
import type { GlobalMessage as GMsg, GlobalMeta } from '../types';
import Avatar, { colorFor } from '../components/common/Avatar';
import DateChip, { dayLabel } from '../components/common/DateChip';
import Modal from '../components/common/Modal';
import GlowButton from '../components/uiverse/GlowButton';
import Toggle from '../components/uiverse/Toggle';
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [noiseLevel, setNoiseLevel] = useState(me?.noiseFilterLevel ?? 0);
  const [hideQuestions, setHideQuestions] = useState(false);
  const [storm, setStorm] = useState<{ id: number; emoji: string; x: number }[]>([]);
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [profileId, setProfileId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<number | null>(null);

  const metaQuery = useQuery({
    queryKey: ['global-meta'],
    queryFn: async () => (await api.get('/global/meta')).data as GlobalMeta,
    refetchInterval: 30_000,
  });

  // ---------- history + socket wiring ----------
  useEffect(() => {
    let cancelled = false;
    api.get('/global/messages?limit=60')
      .then(({ data }) => {
        if (!cancelled) setMessages((data as { messages: GMsg[] }).messages);
      })
      .catch(() => setError('Could not load global messages'));

    const onMessage = (m: GMsg) => {
      setMessages((prev) => (prev.some((p) => p._id === m._id) ? prev : [...prev, m]));
      qc.invalidateQueries({ queryKey: ['global-meta'] });
    };
    const onReaction = (p: {
      messageId: string; reactions: GMsg['reactions']; reactors: GMsg['reactors']; by: string; emoji: string; removed: boolean;
    }) => {
      setMessages((prev) =>
        prev.map((m) => (m._id === p.messageId ? { ...m, reactions: p.reactions, reactors: p.reactors } : m))
      );
      if (p.by !== me?.id && !p.removed) {
        const id = Date.now() + Math.random();
        setStorm((s) => [...s, { id, emoji: p.emoji, x: Math.random() * 80 + 10 }]);
        setTimeout(() => setStorm((s) => s.filter((e) => e.id !== id)), 1500);
      }
    };
    const onUpdated = (p: { messageId: string; text: string }) => {
      setMessages((prev) => prev.map((m) => (m._id === p.messageId ? { ...m, text: p.text, isEdited: true } : m)));
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

  useEffect(() => {
    if (noiseLevel !== (me?.noiseFilterLevel ?? 0)) {
      api.patch('/users/me', { noiseFilterLevel: noiseLevel }).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noiseLevel]);

  const visible = useMemo(() => {
    let list = messages.filter((m) => !m.isDeleted);
    if (hideQuestions) list = list.filter((m) => m.kind !== 'question');
    if (noiseLevel >= 1) list = list.filter((m) => m.score > 0 || m.senderId === me?.id);
    if (noiseLevel >= 3) list = list.filter((m) => m.kind === 'question' || m.score >= 6);
    return list;
  }, [messages, hideQuestions, noiseLevel, me?.id]);

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

  const react = (m: GMsg, emoji: string) => {
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg._id !== m._id) return msg;
        const mine = msg.reactors.find((r) => r.userId === me?.id);
        let reactors = msg.reactors.filter((r) => r.userId !== me?.id);
        let reactions = [...msg.reactions];
        const bump = (e: string, d: number) => {
          const idx = reactions.findIndex((r) => r.emoji === e);
          if (idx >= 0) {
            reactions[idx] = { emoji: e, count: reactions[idx].count + d };
            if (reactions[idx].count <= 0) reactions = reactions.filter((r) => r.emoji !== e);
          } else if (d > 0) {
            reactions.push({ emoji: e, count: 1 });
          }
        };
        if (mine?.emoji === emoji) {
          bump(emoji, -1);
        } else {
          if (mine) bump(mine.emoji, -1);
          bump(emoji, +1);
          reactors.push({ userId: me!.id, emoji });
        }
        return { ...msg, reactions, reactors };
      })
    );
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
          <p className="text-[11.5px] sm:text-[12px] text-[var(--wa-text-2)] flex items-center gap-1.5 truncate">
            <span className="hidden min-[420px]:inline">{meta?.onlineCount ?? '—'} online · </span>one chat for the whole world
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1 text-[var(--wa-text-2)]">
          <button className="p-2 rounded-full hover:bg-[var(--wa-active)] hover:text-[var(--wa-text)]" title="Trending Now" onClick={() => document.getElementById('trending-toggle')?.click()}>
            <TrendingUp size={18} />
          </button>
          <button className="p-2 rounded-full hover:bg-[var(--wa-active)] hover:text-[var(--wa-text)]" title="Personal noise filters" onClick={() => setFilterOpen(true)}>
            <SlidersHorizontal size={18} />
          </button>
        </div>
      </header>

      {/* feature strip — scrollable on mobile */}
      <div className="shrink-0 bg-[var(--wa-panel)] border-b border-[var(--wa-border)] px-3 py-1.5 flex gap-2 overflow-x-auto wa-scroll text-[11px] sm:text-[11.5px]">
        <FeatureChip icon={<Sparkles size={11} />} label={meta?.challenge.text ?? 'Daily Challenge…'} tone="amber" />
        <FeatureChip icon={<Flame size={11} />} label={`Milestone ${meta?.nextMilestone.progress ?? 0}% → ${meta?.nextMilestone.target ?? '—'}`} tone="green" />
        <FeatureChip icon={<Activity size={11} />} label={`${meta?.totals.messages ?? 0} msgs all-time`} tone="sky" />
      </div>

      {/* messages */}
      <div className="flex-1 overflow-y-auto wa-scroll py-3">
        <div className="px-[6%] mb-3" id="trending-wrap">
          <TrendingBanner items={meta?.trending ?? []} onJump={(id) => document.getElementById(`gm-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} />
        </div>

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
                  onReply={() => {
                    setReplyTo(m);
                    inputRef.current?.focus();
                  }}
                  onReact={(e) => react(m, e)}
                  onEdit={() => {
                    setEditing(m);
                    setInput(m.text);
                    inputRef.current?.focus();
                  }}
                  onDelete={() => socket.emit('global:delete', { messageId: m._id })}
                  onReport={() => api.post(`/global/messages/${m._id}/report`, { reason: 'inappropriate' }).catch((e) => setError(apiError(e)))}
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
            placeholder={me?.isGuest ? 'Message the world…' : 'Message the whole world…'}
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

      {/* noise filter modal */}
      <Modal open={filterOpen} onClose={() => setFilterOpen(false)} title="Personal noise filter">
        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-[var(--wa-text)]">Filter level</span>
              <span className="text-xs text-[var(--wa-green-hover)] font-semibold">{['Off', 'Light', 'Medium', 'Strict'][noiseLevel]}</span>
            </div>
            <input type="range" min={0} max={3} value={noiseLevel} onChange={(e) => setNoiseLevel(Number(e.target.value))} className="w-full accent-emerald-400" />
            <p className="text-xs text-[var(--wa-text-2)] mt-2">Higher levels surface messages with more reactions and questions.</p>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--wa-text)]">Show Question Mode messages</span>
            <Toggle on={!hideQuestions} onChange={(v) => setHideQuestions(!v)} />
          </div>
          <p className="text-xs text-[var(--wa-text-2)]">Filters apply to your view only — nothing is deleted for others.</p>
        </div>
      </Modal>

      <UserProfileModal userId={profileId} onClose={() => setProfileId(null)} />
    </div>
  );
}

// ---------------- message row ----------------
function GlobalMessageRow({
  m, mine, onReply, onReact, onEdit, onDelete, onReport, onProfile,
}: {
  m: GMsg; mine: boolean;
  onReply: () => void; onReact: (emoji: string) => void; onEdit: () => void;
  onDelete: () => void; onReport: () => void; onProfile: () => void;
}) {
  return (
    <div className={`wa-row ${mine ? 'out' : 'in'} group`}>
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
          {m.isDeleted ? <i className="opacity-60">🚫 This message was deleted</i> : m.text}
          {m.isEdited && !m.isDeleted && <span className="text-[11px] opacity-50 ml-1">edited</span>}
        </span>
        <span className="wa-meta">
          {m.expiresAt && <Timer size={10} className="text-amber-400" />}
          {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
        {m.reactions.length > 0 && (
          <div className="flex gap-1 mt-1">
            {m.reactions.map((r) => (
              <button
                key={r.emoji}
                className="text-[11px] bg-black/25 hover:bg-black/40 rounded-full px-1.5 leading-5"
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
          <span className="w-px h-4 bg-[var(--wa-border)] mx-0.5" />
          <button className="p-1 text-[var(--wa-text-2)] hover:text-sky-300" title="Reply" onClick={onReply}>
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

function TrendingBanner({ items, onJump }: { items: GlobalMeta['trending']; onJump: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div id="trending-toggle" className="mb-1">
      <button
        className="text-[12px] flex items-center gap-1.5 text-amber-300/90 hover:text-amber-200 transition"
        onClick={() => setOpen((o) => !o)}
      >
        <TrendingUp size={13} /> Trending Now ({items.length}) {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 bg-[var(--wa-panel-2)] border border-[var(--wa-border)] rounded-xl p-3">
          {items.map((t, i) => (
            <button key={t.id} className="block w-full text-left text-[12.5px] text-[var(--wa-text)] hover:text-amber-200 truncate" onClick={() => onJump(t.id)}>
              <span className="text-amber-400 font-bold mr-1.5">#{i + 1}</span>
              {t.text} <span className="text-[var(--wa-text-2)]">· {t.score} pts</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FeatureChip({ icon, label, tone }: { icon: React.ReactNode; label: string; tone: 'amber' | 'green' | 'sky' }) {
  const tones: Record<string, string> = {
    amber: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    green: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    sky: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
  };
  return (
    <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${tones[tone]}`}>
      {icon} {label}
    </span>
  );
}
