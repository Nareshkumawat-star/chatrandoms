import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Search, MessageCircle, Lock, ArrowLeft, ShieldBan, VolumeX, X, UserSearch, ChevronLeft, Send, Smile, MoreVertical, Check, Plus, ShieldOff, Pencil, Trash2, Flag, Paperclip, Mic, Square, Play, Pause,
} from 'lucide-react';
import { api, apiError } from '../lib/api';
import { getDmSocket } from '../lib/socket';
import { useAuth } from '../store/auth';
import { useUi } from '../store/ui';
import type { ChatMessage, ConversationSummary, PublicUser } from '../types';
import Avatar from '../components/common/Avatar';
import DateChip, { dayLabel } from '../components/common/DateChip';
import { Ticks } from '../components/common/Ticks';
import { Spinner } from '../components/uiverse/Spinner';
import UserProfileModal from '../components/common/UserProfileModal';
import { playSentTick } from '../lib/sound';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];

type PendingImage = { dataUrl: string; name: string };
type PendingVoice = { dataUrl: string; name: string; durationMs: number };

// Photo messages ride the dm:send socket payload, so images are downscaled and
// re-encoded until they fit comfortably under the server's cap.
const IMAGE_BYTE_CAP = 680_000;
// Voice notes are opus-encoded at 32kbps: 3 minutes ≈ 960KB base64.
const VOICE_BYTE_CAP = 1_150_000;
const MAX_RECORD_MS = 180_000;
const VOICE_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

function pickVoiceMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return VOICE_MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read the recording'));
    reader.readAsDataURL(blob);
  });
}

function fmtClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function compressImage(file: File): Promise<PendingImage> {
  if (!file.type.startsWith('image/')) throw new Error('That file is not an image');
  if (file.size > 15_000_000) throw new Error('Image is too large (max 15MB)');

  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not load that image'));
    el.src = raw;
  });

  const render = (max: number, quality: number): string | null => {
    try {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL('image/jpeg', quality);
    } catch {
      return null; // exotic formats can taint the canvas — handled by the fallback below
    }
  };

  for (const max of [1600, 1280, 1024]) {
    for (const quality of [0.82, 0.65, 0.5]) {
      const out = render(max, quality);
      if (out && out.length <= IMAGE_BYTE_CAP) return { dataUrl: out, name: file.name || 'photo' };
    }
  }
  if (raw.length <= IMAGE_BYTE_CAP) return { dataUrl: raw, name: file.name || 'photo' };
  throw new Error('Could not compress that photo enough — try a smaller image');
}

function messagePreview(m: ChatMessage): string {
  if (m.text) return m.text;
  if (m.attachments?.some((a) => a.kind === 'audio')) return '🎤 Voice message';
  if (m.attachments?.length) return '📷 Photo';
  return '';
}

export default function Chats() {
  const qc = useQueryClient();
  const { me } = useAuth();
  const dm = getDmSocket();

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeConv, setActiveConv] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [otherTyping, setOtherTyping] = useState(false);
  const [error, setError] = useState('');
  const [profileId, setProfileId] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [emojiFor, setEmojiFor] = useState<string | null>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [pendingVoice, setPendingVoice] = useState<PendingVoice | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordMs, setRecordMs] = useState(0);
  const [sendingMedia, setSendingMedia] = useState(false);
  const [blockedState, setBlockedState] = useState<{ blockedMe: boolean; iBlocked: boolean }>({ blockedMe: false, iBlocked: false });

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const typingGuard = useRef<number>(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number | null>(null);
  const recStartRef = useRef(0);
  const recCancelledRef = useRef(false);

  // ---------- debounced username search (Chats section ONLY) ----------
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setDebounced('');
      setResults([]);
      return;
    }
    const t = setTimeout(() => setDebounced(q), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!debounced) return;
    let cancelled = false;
    setSearching(true);
    api.get('/users/search', { params: { q: debounced } })
      .then(({ data }) => {
        if (!cancelled) setResults((data as { results: PublicUser[] }).results);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setSearching(false));
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  // ---------- conversation list ----------
  const chatsQuery = useQuery({
    queryKey: ['chats'],
    queryFn: async () => (await api.get('/chats')).data as { items: ConversationSummary[] },
    refetchInterval: 30_000,
  });

  const openConversation = useCallback(
    async (conv: { id: string; other?: ConversationSummary['other'] } | null) => {
      setError('');
      setReplyTo(null);
      setEditing(null);
      if (!conv) {
        setActiveConv(null);
        return;
      }
      const summary =
        ('other' in conv && conv.other ? (conv as ConversationSummary) : null) ??
        chatsQuery.data?.items.find((c) => c.id === conv.id) ??
        null;
      const otherInfo = summary?.other ?? conv.other ?? null;
      setActiveConv(
        summary ??
          ({
            id: conv.id,
            other: otherInfo,
            lastMessage: null,
            lastMessageAt: null,
            unread: 0,
          } as ConversationSummary)
      );
      setMessages([]);
      setNextBefore(null);
      qc.invalidateQueries({ queryKey: ['chats'] }); // refreshes unread → title count
      try {
        const { data } = await api.get(`/chats/${conv.id}/messages?limit=50`);
        setMessages((data as { messages: ChatMessage[] }).messages);
        setNextBefore((data as { nextBefore: string | null }).nextBefore);
        dm.emit('dm:read', { conversationId: conv.id });
        qc.invalidateQueries({ queryKey: ['chats'] });
      } catch {
        setError('Could not load messages');
      }
      // fetch relationship for blocked-state banner
      const targetId = otherInfo?.id;
      if (targetId) {
        api
          .get(`/users/${targetId}`)
          .then(({ data }) => setBlockedState(data.viewerRelationship ?? { blockedMe: false, iBlocked: false }))
          .catch(() => undefined);
      } else {
        setBlockedState({ blockedMe: false, iBlocked: false });
      }
    },
    [chatsQuery.data, dm, qc]
  );

  // external "open conversation" requests (sidebar / profile modal)
  const openRequest = useUi((s) => s.openRequest);
  useEffect(() => {
    if (!openRequest) return;
    openConversation({ id: openRequest.id, other: openRequest.other });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.nonce]);

  // ---------- realtime DM events ----------
  useEffect(() => {
    const onNew = (m: ChatMessage) => {
      const isActive = activeConv && m.conversationId === activeConv.id;
      if (isActive) {
        setMessages((prev) => (prev.some((p) => p._id === m._id) ? prev : [...prev, m]));
        if (m.senderId !== me?.id) dm.emit('dm:read', { conversationId: m.conversationId });
        qc.invalidateQueries({ queryKey: ['chats'] });
      } else {
        qc.invalidateQueries({ queryKey: ['chats'] });
      }
    };
    const onTyping = (p: { conversationId: string }) => {
      if (activeConv && p.conversationId === activeConv.id) {
        setOtherTyping(true);
        setTimeout(() => setOtherTyping(false), 2500);
      }
    };
    const onStop = () => setOtherTyping(false);
    const onEdit = (m: ChatMessage) => {
      setMessages((prev) => prev.map((x) => (x._id === m._id ? { ...x, text: m.text, isEdited: true } : x)));
    };
    const onDelete = (p: { messageId: string }) => {
      setMessages((prev) => prev.map((x) => (x._id === p.messageId ? { ...x, isDeleted: true, text: '' } : x)));
    };
    const onReaction = (m: ChatMessage) => {
      setMessages((prev) => prev.map((x) => (x._id === m._id ? { ...x, reactions: m.reactions } : x)));
    };
    const onRead = (p: { conversationId: string; by: string; at: string }) => {
      setMessages((prev) =>
        prev.map((x) =>
          x.conversationId === p.conversationId && x.senderId === me?.id && !x.readAt ? { ...x, readAt: p.at } : x
        )
      );
    };

    dm.on('dm:new', onNew);
    dm.on('dm:typing', onTyping);
    dm.on('dm:stopTyping', onStop);
    dm.on('dm:edit', onEdit);
    dm.on('dm:delete', onDelete);
    dm.on('dm:reaction', onReaction);
    dm.on('dm:read', onRead);

    return () => {
      dm.off('dm:new', onNew);
      dm.off('dm:typing', onTyping);
      dm.off('dm:stopTyping', onStop);
      dm.off('dm:edit', onEdit);
      dm.off('dm:delete', onDelete);
      dm.off('dm:reaction', onReaction);
      dm.off('dm:read', onRead);
    };
  }, [dm, activeConv, me?.id, qc]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, otherTyping]);

  // ---------- start chat with a searched user (directKey flow) ----------
  const startChat = useMutation({
    mutationFn: async (username: string) =>
      (await api.post('/chats/direct', { username })).data as {
        conversation: { id: string; other: ConversationSummary['other'] };
      },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['chats'] });
      setSearch('');
      setDebounced('');
      setResults([]);
      openConversation({ id: data.conversation.id, other: data.conversation.other } as ConversationSummary);
    },
    onError: (e) => setError(apiError(e)),
  });

  const selfAccount = (u: PublicUser) => me?.id === u.id;

  const send = () => {
    const text = input.trim();
    if (!activeConv || sendingMedia) return;
    if (editing) {
      if (!text) return;
      dm.emit('dm:edit', { messageId: editing._id, text }, (res: { error?: string }) => {
        if (res?.error) setError(res.error);
        setEditing(null);
        setInput('');
      });
      return;
    }

    const media = pendingImage
      ? { image: { dataUrl: pendingImage.dataUrl, name: pendingImage.name } }
      : pendingVoice
        ? {
            voice: {
              dataUrl: pendingVoice.dataUrl,
              name: pendingVoice.name,
              durationMs: pendingVoice.durationMs,
            },
          }
        : null;
    if (!text && !media) return;

    if (media) {
      // Media sends wait on the ack so a failed upload keeps it in the composer.
      setSendingMedia(true);
      dm.emit(
        'dm:send',
        { conversationId: activeConv.id, text, replyTo: replyTo?._id, ...media },
        (res: { error?: string }) => {
          setSendingMedia(false);
          if (res?.error) {
            setError(res.error);
            return;
          }
          playSentTick();
          setInput('');
          setReplyTo(null);
          setPendingImage(null);
          setPendingVoice(null);
        }
      );
      return;
    }

    dm.emit('dm:send', { conversationId: activeConv.id, text, replyTo: replyTo?._id }, (res: { error?: string }) => {
      if (res?.error) setError(res.error);
    });
    playSentTick();
    setInput('');
    setReplyTo(null);
  };

  const composerDisabled =
    !activeConv?.other ||
    activeConv.other.isGuest ||
    blockedState.iBlocked ||
    blockedState.blockedMe;

  // WhatsApp-style: the trailing button is the mic whenever there's nothing to send yet.
  const showMic = !recording && !input.trim() && !pendingImage && !pendingVoice && !sendingMedia;

  const pickImage = (file?: File) => {
    if (!file) return;
    setError('');
    compressImage(file)
      .then((img) => {
        setPendingVoice(null);
        setPendingImage(img);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not attach that image'));
  };

  // ---------- voice recording ----------
  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const clearRecTimer = () => {
    if (recTimerRef.current !== null) {
      window.clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
  };

  const stopRecording = () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.stop(); // onstop does the saving
      return;
    }
    clearRecTimer();
    stopTracks();
    setRecording(false);
  };

  const cancelRecording = () => {
    recCancelledRef.current = true;
    stopRecording();
  };

  const startRecording = async () => {
    if (composerDisabled || recording || sendingMedia) return;
    setError('');
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Voice messages are not supported in this browser');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickVoiceMime();
      const rec = new MediaRecorder(
        stream,
        mime ? { mimeType: mime, audioBitsPerSecond: 32_000 } : { audioBitsPerSecond: 32_000 }
      );
      chunksRef.current = [];
      recCancelledRef.current = false;

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const cancelled = recCancelledRef.current;
        const durationMs = Date.now() - recStartRef.current;
        const chunks = chunksRef.current;
        chunksRef.current = [];
        clearRecTimer();
        stopTracks();
        recorderRef.current = null;
        setRecording(false);
        setRecordMs(0);
        if (cancelled) return;
        try {
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          if (!blob.size) {
            setError('Nothing was recorded — please try again');
            return;
          }
          const dataUrl = await blobToDataUrl(blob);
          if (dataUrl.length > VOICE_BYTE_CAP) {
            setError('Voice message is too long — record a shorter clip');
            return;
          }
          setPendingImage(null);
          setPendingVoice({ dataUrl, name: 'Voice message', durationMs: Math.max(600, durationMs) });
        } catch {
          setError('Could not process that recording');
        }
      };

      streamRef.current = stream;
      recorderRef.current = rec;
      setPendingImage(null);
      setRecording(true);
      setRecordMs(0);
      recStartRef.current = Date.now();
      rec.start();
      recTimerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - recStartRef.current;
        if (elapsed >= MAX_RECORD_MS) {
          stopRecording(); // auto-stop at the 3 minute cap, then it's ready to send
          return;
        }
        setRecordMs(elapsed);
      }, 250);
    } catch (e) {
      clearRecTimer();
      stopTracks();
      recorderRef.current = null;
      setRecording(false);
      setError(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Microphone access denied — allow the mic for this site'
          : 'Could not access the microphone'
      );
    }
  };

  // Never leave a microphone stream open: unmount, or jump to another chat.
  useEffect(() => {
    return () => {
      recCancelledRef.current = true;
      if (recTimerRef.current !== null) window.clearInterval(recTimerRef.current);
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') rec.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // A pending attachment or live recording shouldn't outlive a conversation switch.
  useEffect(() => {
    cancelRecording();
    setPendingImage(null);
    setPendingVoice(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConv?.id]);

  const loadOlder = async () => {
    if (!activeConv || !nextBefore || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const { data } = await api.get(`/chats/${activeConv.id}/messages?limit=50&before=${nextBefore}`);
      const older = (data as { messages: ChatMessage[] }).messages;
      setMessages((prev) => [...older, ...prev]);
      setNextBefore((data as { nextBefore: string | null }).nextBefore);
    } finally {
      setLoadingOlder(false);
    }
  };

  const convItems = chatsQuery.data?.items ?? [];

  // group messages by day for date chips
  const grouped = useMemo(() => {
    const out: { day: string; items: ChatMessage[] }[] = [];
    for (const m of messages) {
      const day = dayLabel(m.createdAt);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(m);
      else out.push({ day, items: [m] });
    }
    return out;
  }, [messages]);

  // ---------------- LIST PANE ----------------
  const listPane = (
    <div className="relative w-full lg:w-[400px] shrink-0 wa-glass-panel border-r border-[var(--wa-border)] flex flex-col h-full">
      <div className="h-[59px] shrink-0 px-3 sm:px-4 flex items-center justify-between wa-glass-header">
        <h2 className="font-semibold text-[16px]">💬 Chats</h2>
        <button
          className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--wa-green-hover)] hover:text-[var(--wa-text)] transition"
          onClick={() => setNewChatOpen(true)}
        >
          <Plus size={16} /> New Chat
        </button>
      </div>

      {/* ---- NEW CHAT overlay ---- */}
      {newChatOpen && (
        <div className="absolute inset-0 z-30 wa-glass-panel flex flex-col">
          <div className="h-[59px] shrink-0 px-4 flex items-center gap-3 wa-glass-header">
            <button className="p-1.5 rounded-full hover:bg-[var(--wa-active)]" onClick={() => setNewChatOpen(false)}>
              <ArrowLeft size={20} />
            </button>
            <h3 className="font-semibold text-[16px]">New Chat</h3>
          </div>
          <div className="p-3">
            <div className="flex items-center gap-2 wa-glass-input rounded-lg px-3 py-2">
              <Search size={15} className="text-[var(--wa-text-2)] shrink-0" />
              <input
                autoFocus
                className="bg-transparent outline-none text-[14px] w-full placeholder:text-[var(--wa-text-2)]"
                placeholder="Search @username…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {searching && <Spinner size={13} />}
            </div>
            <p className="text-[11.5px] text-[var(--wa-text-2)] mt-2 px-1">
              Find people by their unique username. Display names can repeat — usernames can't.
            </p>
          </div>
          <div className="flex-1 overflow-y-auto wa-scroll p-2">
            {debounced && results.length === 0 && !searching && (
              <p className="text-[13px] text-[var(--wa-text-2)] px-3 py-4">No users found for "{debounced}"</p>
            )}
            {results.map((u) =>
              selfAccount(u) ? (
                <div key={u.id} className="px-3 py-4 text-center text-[13px] text-[var(--wa-text-2)]">
                  This is your own account.
                </div>
              ) : (
                <div key={u.id} className="wa-row-item rounded-lg">
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <Avatar src={u.avatar || undefined} name={u.displayName} size={44} online={u.online} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[14.5px] font-medium truncate">{u.displayName}</div>
                      <div className="text-[12.5px] text-[var(--wa-text-2)] truncate">@{u.username}</div>
                    </div>
                    <button
                      className="px-3.5 h-9 rounded-full bg-[var(--wa-green)] text-[#0b141a] text-[13px] font-semibold hover:bg-[var(--wa-green-hover)] transition disabled:opacity-40"
                      disabled={u.isGuest}
                      onClick={() =>
                        startChat.mutate(u.username, {
                          onSuccess: () => setNewChatOpen(false),
                        })
                      }
                    >
                      Start Chat
                    </button>
                  </div>
                </div>
              )
            )}
            {me?.isGuest && debounced && (
              <p className="text-[12px] text-amber-400/90 mt-2 px-3">Create an account to start private chats.</p>
            )}
          </div>
        </div>
      )}

      <div className="px-3 py-2">
        <div className="flex items-center gap-2 wa-glass-input rounded-lg px-3 py-1.5">
          <Search size={15} className="text-[var(--wa-text-2)] shrink-0" />
          <input
            className="bg-transparent outline-none text-[14px] w-full placeholder:text-[var(--wa-text-2)]"
            placeholder="Search username… e.g. @nareshk"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {searching && <Spinner size={13} />}
        </div>
      </div>

      {/* search results */}
      {debounced && (
        <div className="border-y border-[var(--wa-border)] bg-[#182229] p-2 max-h-[45%] overflow-y-auto wa-scroll">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--wa-text-2)] px-2 py-1.5 flex items-center gap-1.5">
            <UserSearch size={11} /> Search results
          </div>
          {results.length === 0 && !searching && (
            <p className="text-[13px] text-[var(--wa-text-2)] px-2 py-3">No users found for "{debounced}"</p>
          )}
          {results.map((u) => (
            <div key={u.id} className="wa-row-item rounded-lg cursor-default">
              <div className="flex items-center gap-3 px-3 py-2">
                <Avatar src={u.avatar || undefined} name={u.displayName} size={42} online={u.online} />
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium truncate">{u.displayName}</div>
                  <div className="text-[12px] text-[var(--wa-text-2)] truncate">@{u.username}</div>
                </div>
                <button
                  className="w-9 h-9 rounded-full bg-[var(--wa-green)] text-[#0b141a] flex items-center justify-center hover:bg-[var(--wa-green-hover)] transition shrink-0"
                  title={u.isGuest ? 'Guests cannot chat' : `Message @${u.username}`}
                  disabled={u.isGuest}
                  onClick={() => startChat.mutate(u.username)}
                >
                  <MessageCircle size={16} />
                </button>
              </div>
            </div>
          ))}
          {me?.isGuest && (
            <p className="text-[12px] text-amber-400/90 mt-1 px-2">Create an account to start private chats.</p>
          )}
        </div>
      )}

      {/* conversation list */}
      <div className="flex-1 overflow-y-auto wa-scroll p-2">
        {chatsQuery.isLoading ? (
          <div className="p-2"><Spinner size={20} /></div>
        ) : convItems.length === 0 ? (
          <div className="text-center text-[13px] text-[var(--wa-text-2)] px-8 py-12 leading-relaxed">
            <MessageCircle size={28} className="mx-auto mb-3 opacity-40" />
            No conversations yet.<br />Search a username above to begin.
          </div>
        ) : (
          convItems.map((c) => (
            <div
              key={c.id}
              className={`wa-row-item rounded-lg ${activeConv?.id === c.id ? 'active' : ''} cursor-pointer`}
              onClick={() => openConversation(c)}
            >
              <div className="flex items-center gap-3 px-3 py-2.5">
                <Avatar src={c.other?.avatar || undefined} name={c.other?.displayName ?? '?'} size={49} online={c.other?.online} />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline gap-2">
                    <span className="font-medium text-[15px] truncate">{c.other?.displayName ?? 'Unknown'}</span>
                    <span className={`text-[11px] shrink-0 ${c.unread ? 'text-[var(--wa-green-hover)]' : 'text-[var(--wa-text-2)]'}`}>
                      {c.lastMessage?.at ? timeAgo(c.lastMessage.at) : ''}
                    </span>
                  </div>
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-[13px] text-[var(--wa-text-2)] truncate flex items-center gap-1">
                      {c.lastMessage?.mine && <Check size={14} className="shrink-0 text-[var(--wa-text-2)]" />}
                      {c.lastMessage ? c.lastMessage.text : 'New chat'}
                    </span>
                    {c.unread > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--wa-green)] text-[#0b141a] text-[11px] font-bold flex items-center justify-center shrink-0">
                        {c.unread > 99 ? '99+' : c.unread}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  // ---------------- CHAT PANE ----------------
  const chatPane = activeConv ? (
    <div className="flex-1 min-w-0 flex flex-col h-full wa-canvas">
      {/* header */}
      <header className="h-[59px] shrink-0 wa-glass-header px-4 flex items-center gap-3 border-l border-[var(--wa-border)]">
        <button className="md:hidden p-1.5 rounded-full hover:bg-[var(--wa-active)]" onClick={() => setActiveConv(null)}>
          <ArrowLeft size={20} />
        </button>
        <button className="flex items-center gap-3 min-w-0" onClick={() => setProfileId(activeConv.other?.id ?? null)}>
          <Avatar src={activeConv.other?.avatar || undefined} name={activeConv.other?.displayName ?? '?'} size={40} online={activeConv.other?.online} />
          <div className="min-w-0 text-left">
            <div className="font-medium text-[15px] truncate">{activeConv.other?.displayName ?? 'Private chat'}</div>
            <div className="text-[12px] text-[var(--wa-text-2)] truncate">
              {activeConv.other?.online ? (
                <span className="text-[var(--wa-green-hover)]">online</span>
              ) : (
                <>@{activeConv.other?.username ?? '…'} · offline</>
              )}
              {otherTyping && <span className="text-[var(--wa-green-hover)]"> · typing…</span>}
            </div>
          </div>
        </button>
        <div className="ml-auto flex items-center gap-1 text-[var(--wa-text-2)]">
          <span title="Private area: only you two" className="mr-1 inline-flex"><Lock size={15} /></span>
          <button
            className="p-2 rounded-full hover:bg-[var(--wa-active)] hover:text-rose-300"
            title={blockedState.iBlocked ? 'Unblock user' : 'Block user'}
            onClick={async () => {
              if (!activeConv.other) return;
              const { data } = await api.post(`/users/${activeConv.other.id}/block`);
              setBlockedState((s) => ({ ...s, iBlocked: Boolean(data.blocked) }));
            }}
          >
            {blockedState.iBlocked ? <ShieldOff size={18} /> : <ShieldBan size={18} />}
          </button>
          <button
            className="p-2 rounded-full hover:bg-[var(--wa-active)] hover:text-amber-300"
            title="Mute user"
            onClick={async () => {
              if (!activeConv.other) return;
              await api.post(`/users/${activeConv.other.id}/mute`);
            }}
          >
            <VolumeX size={18} />
          </button>
          <button className="p-2 rounded-full hover:bg-[var(--wa-active)]" title="More" onClick={() => setProfileId(activeConv.other?.id ?? null)}>
            <MoreVertical size={18} />
          </button>
        </div>
      </header>

      {/* messages */}
      <div className="flex-1 overflow-y-auto wa-scroll py-3">
        {nextBefore && (
        <div className="flex justify-center mb-2">
            <button
              className="text-[12px] text-[var(--wa-text-2)] bg-[var(--wa-panel-2)] hover:bg-[var(--wa-active)] rounded-full px-3 py-1.5 flex items-center gap-1.5"
              onClick={loadOlder}
            >
              {loadingOlder ? <Spinner size={12} /> : <ChevronLeft size={13} />} Older messages
            </button>
          </div>
        )}

        {/* blocked-state banner */}
        {activeConv.other && blockedState.iBlocked && (
          <div className="mx-auto mb-2 w-fit flex items-center gap-3 bg-rose-500/10 border border-rose-500/30 text-rose-200 text-[12.5px] rounded-full px-4 py-1.5">
            You blocked this user.
            <button
              className="font-semibold underline hover:text-rose-100"
              onClick={async () => {
                await api.post(`/users/${activeConv.other!.id}/block`); // toggle off
                setBlockedState((s) => ({ ...s, iBlocked: false }));
              }}
            >
              Unblock
            </button>
          </div>
        )}
        {activeConv.other && blockedState.blockedMe && !blockedState.iBlocked && (
          <div className="mx-auto mb-2 w-fit bg-amber-500/10 border border-amber-500/30 text-amber-200 text-[12.5px] rounded-full px-4 py-1.5">
            You can't message this user.
          </div>
        )}

        <div className="wa-enc">
          <Lock size={12} />
          Messages in this chat are private between you and {activeConv.other?.displayName ?? 'them'} — never shown in Global Chat.
        </div>

        {messages.length === 0 && (
          <div className="h-[60%] flex flex-col items-center justify-center text-center text-[var(--wa-text-2)] gap-2 px-10">
            <span className="text-4xl mb-2">👋</span>
            <p className="text-[15px] text-[var(--wa-text)]">Say hello to {activeConv.other?.displayName ?? 'your new contact'}</p>
            <p className="text-[13px]">This is a private 1-to-1 conversation.</p>
          </div>
        )}

        {grouped.map((g) => (
          <div key={g.day}>
            <DateChip iso={g.items[0].createdAt} />
            {g.items.map((m) => {
              const mine = m.senderId === me?.id;
              const parent = m.replyTo ? messages.find((x) => x._id === m.replyTo) : null;
              const reactionCounts = Object.entries(
                m.reactions.reduce<Record<string, number>>((acc, r) => {
                  acc[r.emoji] = (acc[r.emoji] ?? 0) + 1;
                  return acc;
                }, {})
              );
              return (
                <div key={m._id} className={`wa-row ${mine ? 'out' : 'in'} group`}>
                  <div className={`wa-bubble ${mine ? 'out' : 'in'} msg-in`}>
                    {parent && (
                      <div className="text-[12.5px] rounded-md px-2 py-1 mb-1 border-l-[3px] border-[var(--wa-green)] bg-black/20">
                        <div className="text-[var(--wa-green-hover)] font-medium text-[12px]">
                          {parent.senderId === me?.id ? 'You' : activeConv.other?.displayName}
                        </div>
                        <div className="text-[var(--wa-text-2)] truncate text-[12px]">{messagePreview(parent)}</div>
                      </div>
                    )}
                    {!m.isDeleted && m.attachments && m.attachments.length > 0 && (
                      <div className="mb-1 space-y-1">
                        {m.attachments.map((a) =>
                          a.kind === 'audio' ? (
                            <VoicePlayer key={a.url} src={a.url} durationMs={a.durationMs} />
                          ) : (
                            <a
                              key={a.url}
                              href={a.url}
                              target="_blank"
                              rel="noreferrer"
                              className="block"
                              title={a.name || 'Open photo'}
                            >
                              <img
                                src={a.url}
                                alt={a.name || 'Photo'}
                                loading="lazy"
                                className="block w-[min(300px,55vw)] max-w-full rounded-lg border border-white/10 bg-black/20 object-cover"
                              />
                            </a>
                          )
                        )}
                      </div>
                    )}
                    <span>{m.isDeleted ? <i className="opacity-60">🚫 This message was deleted</i> : m.text}</span>
                    {m.isEdited && !m.isDeleted && <span className="text-[11px] opacity-50 ml-1">edited</span>}
                    <span className="wa-meta">
                      {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {mine && <Ticks read={Boolean(m.readAt)} />}
                    </span>
                    {reactionCounts.length > 0 && (
                      <div className="flex gap-1 mt-1">
                        {reactionCounts.map(([emoji, count]) => (
                          <button
                            key={emoji}
                            className="text-[11px] bg-black/25 rounded-full px-1.5 leading-5"
                            onClick={() => dm.emit('dm:reaction', { messageId: m._id, emoji })}
                          >
                            {emoji}{count > 1 ? ` ${count}` : ''}
                          </button>
                        ))}
                      </div>
                    )}
                    {!m.isDeleted && (
                      <div className="absolute -top-3 right-2 hidden group-hover:flex items-center gap-0.5 wa-glass-chip border border-[var(--wa-border)] rounded-full px-1 z-10">
                        {QUICK_EMOJIS.map((e) => (
                          <button
                            key={e}
                            className="text-[13px] hover:scale-125 transition-transform px-0.5"
                            onClick={() => dm.emit('dm:reaction', { messageId: m._id, emoji: e })}
                          >
                            {e}
                          </button>
                        ))}
                        <span className="w-px h-4 bg-[var(--wa-border)] mx-0.5" />
                        <button
                          className="p-1 text-[var(--wa-text-2)] hover:text-sky-300"
                          title="Reply"
                          onClick={() => {
                            setReplyTo(m);
                            inputRef.current?.focus();
                          }}
                        >
                          <ArrowLeft size={12} className="rotate-180" />
                        </button>
                        {mine && (
                          <>
                            {!!m.text && (
                              <button
                                className="p-1 text-[var(--wa-text-2)] hover:text-amber-300"
                                title="Edit"
                                onClick={() => {
                                  setEditing(m);
                                  setInput(m.text);
                                  inputRef.current?.focus();
                                }}
                              >
                                <Pencil size={12} />
                              </button>
                            )}
                            <button
                              className="p-1 text-[var(--wa-text-2)] hover:text-rose-400"
                              title="Delete"
                              onClick={() => dm.emit('dm:delete', { messageId: m._id })}
                            >
                              <Trash2 size={12} />
                            </button>
                          </>
                        )}
                        {!mine && (
                          <button className="p-1 text-[var(--wa-text-2)] hover:text-rose-400" title="Report user" onClick={() => setProfileId(m.senderId)}>
                            <Flag size={12} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {otherTyping && (
          <div className="wa-row in">
            <div className="wa-bubble in flex items-center gap-1 py-3">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* composer */}
      <div className="shrink-0 wa-glass-composer px-3 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] lg:pb-2.5">
        {replyTo && (
          <div className="mb-2 flex items-center gap-2 text-[12.5px] bg-[var(--wa-panel-2)] border-l-[3px] border-[var(--wa-green)] rounded-lg px-3 py-2">
            <div className="flex-1 min-w-0">
              <div className="text-[var(--wa-green-hover)] font-medium text-[12px]">
                {replyTo.senderId === me?.id ? 'You' : activeConv.other?.displayName}
              </div>
              <div className="text-[var(--wa-text-2)] truncate">{messagePreview(replyTo)}</div>
            </div>
            <button className="text-[var(--wa-text-2)] hover:text-[var(--wa-text)]" onClick={() => setReplyTo(null)}>
              <X size={16} />
            </button>
          </div>
        )}
        {editing && (
          <div className="mb-2 flex items-center gap-2 text-[12.5px] bg-[var(--wa-panel-2)] border-l-[3px] border-amber-400 rounded-lg px-3 py-2">
            <div className="flex-1">Editing message</div>
            <button className="text-[var(--wa-text-2)]" onClick={() => { setEditing(null); setInput(''); }}>
              <X size={16} />
            </button>
          </div>
        )}
        {error && <p className="text-[12px] text-rose-400 mb-1.5">{error}</p>}
        {pendingImage && (
          <div className="mb-2 flex items-center gap-2 text-[12.5px] bg-[var(--wa-panel-2)] border-l-[3px] border-sky-400 rounded-lg px-3 py-2">
            <img
              src={pendingImage.dataUrl}
              alt="Attachment preview"
              className="w-10 h-10 rounded-md object-cover shrink-0 border border-[var(--wa-border)]"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sky-300 font-medium text-[12px]">
                {sendingMedia ? 'Sending photo…' : 'Photo attached'}
              </div>
              <div className="text-[var(--wa-text-2)] truncate">{pendingImage.name}</div>
            </div>
            <button
              className="text-[var(--wa-text-2)] hover:text-[var(--wa-text)] disabled:opacity-40"
              title="Remove photo"
              disabled={sendingMedia}
              onClick={() => setPendingImage(null)}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {pendingVoice && (
          <div className="mb-2 flex items-center gap-2 text-[12.5px] bg-[var(--wa-panel-2)] border-l-[3px] border-emerald-400 rounded-lg px-3 py-2">
            <div className="flex-1 min-w-0">
              <div className="text-emerald-300 font-medium text-[12px] mb-1.5">
                {sendingMedia ? 'Sending voice message…' : 'Voice message ready'}
              </div>
              <VoicePlayer src={pendingVoice.dataUrl} durationMs={pendingVoice.durationMs} />
            </div>
            <button
              className="text-[var(--wa-text-2)] hover:text-[var(--wa-text)] disabled:opacity-40"
              title="Discard voice message"
              disabled={sendingMedia}
              onClick={() => setPendingVoice(null)}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          {recording ? (
            <>
              <button
                className="w-10 h-10 rounded-full flex items-center justify-center text-rose-300 hover:bg-rose-500/15 transition"
                title="Discard recording"
                onClick={cancelRecording}
              >
                <X size={22} />
              </button>
              <div className="flex-1 min-w-0 flex items-center gap-2.5 wa-glass-input rounded-xl px-3 py-2.5">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
                <span className="text-[13.5px] font-medium text-rose-300 tabular-nums shrink-0">
                  {fmtClock(recordMs)}
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-black/25 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-rose-400 transition-[width] duration-200"
                    style={{ width: `${Math.min(100, (recordMs / MAX_RECORD_MS) * 100)}%` }}
                  />
                </div>
                <span className="text-[11px] text-[var(--wa-text-2)] shrink-0 hidden sm:inline">recording</span>
              </div>
              <button
                className="w-10 h-10 rounded-full bg-[var(--wa-green)] text-[#0b141a] flex items-center justify-center hover:bg-[var(--wa-green-hover)] transition"
                title="Stop — ready to send"
                onClick={stopRecording}
              >
                <Square size={15} fill="currentColor" />
              </button>
            </>
          ) : (
            <>
          <button
            className="w-10 h-10 rounded-full flex items-center justify-center text-[var(--wa-text-2)] hover:bg-[var(--wa-active)] hover:text-[var(--wa-text)] transition disabled:opacity-40"
            title="Attach photo"
            onClick={() => imageRef.current?.click()}
            disabled={composerDisabled || sendingMedia}
          >
            <Paperclip size={22} />
          </button>
          <input
            ref={imageRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              pickImage(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button
            className="w-10 h-10 rounded-full flex items-center justify-center text-[var(--wa-text-2)] hover:bg-[var(--wa-active)] hover:text-[var(--wa-text)] transition"
            title="Emoji"
            onClick={() => setEmojiFor(emojiFor ? null : 'picker')}
          >
            <Smile size={24} />
          </button>
          {emojiFor && (
            <div className="absolute bottom-16 left-14 wa-glass-chip border border-[var(--wa-border)] rounded-2xl p-3 grid grid-cols-6 gap-1 z-20">
              {['😀', '😂', '🥲', '😍', '🤔', '👍', '🙏', '🔥', '🎉', '❤️', '😭', '😮', '🤝', '💯', '😎', '🥳', '😴', '🤗', '👏', '💪', '✨', '🌍', '🚀', '☕'].map((e) => (
                <button
                  key={e}
                  className="w-9 h-9 rounded-full hover:bg-[var(--wa-active)] text-xl flex items-center justify-center"
                  onClick={() => {
                    setInput((v) => v + e);
                    setEmojiFor(null);
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
            className="flex-1 min-w-0 wa-glass-input rounded-xl px-3 sm:px-4 py-2.5 text-[14.5px] outline-none placeholder:text-[var(--wa-text-2)]"
            placeholder={
              blockedState.iBlocked
                ? 'You blocked this user — unblock to send messages'
                : blockedState.blockedMe
                  ? "You can't message this user"
                  : activeConv.other?.isGuest
                    ? 'Guests cannot reply — invite them to register'
                    : 'Type a message'
            }
            value={input}
            maxLength={4000}
            disabled={!activeConv.other || activeConv.other.isGuest || blockedState.iBlocked || blockedState.blockedMe}
            onChange={(e) => {
              setInput(e.target.value);
              if (Date.now() - typingGuard.current > 1200) {
                typingGuard.current = Date.now();
                dm.emit('dm:typing', { conversationId: activeConv.id });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          {showMic ? (
            <button
              className="w-10 h-10 rounded-full bg-gradient-to-b from-[#06d6a0] to-[var(--wa-green)] text-[#0b141a] flex items-center justify-center shadow-[0_0_16px_rgba(0,168,132,0.35)] hover:shadow-[0_0_22px_rgba(6,207,156,0.5)] hover:scale-105 active:scale-95 transition disabled:opacity-40"
              onClick={startRecording}
              disabled={composerDisabled || sendingMedia}
              title="Record voice message"
            >
              <Mic size={20} />
            </button>
          ) : (
            <button
              className="w-10 h-10 rounded-full bg-gradient-to-b from-[#06d6a0] to-[var(--wa-green)] text-[#0b141a] flex items-center justify-center shadow-[0_0_16px_rgba(0,168,132,0.35)] hover:shadow-[0_0_22px_rgba(6,207,156,0.5)] hover:scale-105 active:scale-95 transition disabled:opacity-40"
              onClick={send}
              disabled={composerDisabled || sendingMedia || (!input.trim() && !pendingImage && !pendingVoice)}
              title="Send"
            >
              <Send size={18} />
            </button>
          )}
            </>
          )}
        </div>
      </div>
    </div>
  ) : (
    <div className="flex-1 min-w-0 hidden md:flex flex-col items-center justify-center text-center bg-[var(--wa-panel)] border-l border-[var(--wa-border)] relative">
      <div className="absolute top-[59px] inset-x-0 h-px bg-[var(--wa-border)]" />
      <div className="max-w-sm px-8">
        <div className="mx-auto w-fit mb-6 relative">
          <span className="text-7xl">💬</span>
        </div>
        <h3 className="text-[26px] font-light text-[var(--wa-text)] mb-3">Start a private chat</h3>
        <p className="text-[13.5px] text-[var(--wa-text-2)] leading-relaxed">
          Search a username on the left (try <span className="text-[var(--wa-text)]">@nareshk</span> or
          <span className="text-[var(--wa-text)]"> @rahulsharma</span>), then press
          <span className="text-[var(--wa-green-hover)]"> Start Chat</span>.
          Private messages never appear in Global Chat.
        </p>
        <div className="mt-6 text-[12px] text-[var(--wa-text-2)] flex items-center justify-center gap-1.5">
          <Lock size={12} /> Your private conversations stay private
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
      {chatPane}
      <UserProfileModal userId={profileId} onClose={() => setProfileId(null)} />
    </div>
  );
}

function VoicePlayer({ src, durationMs }: { src: string; durationMs?: number }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(durationMs ?? 0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const totalRef = useRef(durationMs ?? 0);

  useEffect(() => {
    totalRef.current = durationMs ?? 0;
    setTotal(durationMs ?? 0);
  }, [durationMs]);

  // A playing clip must stop when the row unmounts.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const ensureAudio = () => {
    if (audioRef.current) return audioRef.current;
    const a = new Audio(src);
    a.preload = 'metadata';
    a.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(a.duration) && a.duration > 0 && !totalRef.current) {
        const ms = Math.round(a.duration * 1000);
        totalRef.current = ms;
        setTotal(ms);
      }
    });
    a.addEventListener('timeupdate', () => {
      const durSec =
        a.duration && Number.isFinite(a.duration) && a.duration > 0
          ? a.duration
          : totalRef.current / 1000;
      setProgress(durSec ? Math.min(1, a.currentTime / durSec) : 0);
    });
    a.addEventListener('ended', () => {
      setPlaying(false);
      setProgress(0);
    });
    audioRef.current = a;
    return a;
  };

  const toggle = () => {
    const a = ensureAudio();
    if (playing) {
      a.pause();
      setPlaying(false);
      return;
    }
    a.play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  };

  return (
    <div className="flex items-center gap-2.5 min-w-[190px] py-0.5">
      <button
        type="button"
        className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center shrink-0 transition"
        title={playing ? 'Pause' : 'Play voice message'}
        onClick={toggle}
      >
        {playing ? (
          <Pause size={14} fill="currentColor" />
        ) : (
          <Play size={14} fill="currentColor" className="ml-0.5" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div className="h-1.5 rounded-full bg-white/15 overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--wa-green-hover)] transition-[width] duration-150"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <div className="mt-1 text-[10.5px] tabular-nums opacity-70 flex items-center gap-1">
          <Mic size={10} className="opacity-70" />
          {fmtClock(progress * total)} / {fmtClock(total)}
        </div>
      </div>
    </div>
  );
}

function timeAgo(date: string): string {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
