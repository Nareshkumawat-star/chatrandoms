import { useEffect, useMemo, useState } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {  MessageCircle, Settings as SettingsIcon, WifiOff, Search, Users, Globe,
  Volume2, VolumeX, Bell, BellOff, Menu, X,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { useUi } from '../store/ui';
import { getGlobalSocket, getDmSocket } from '../lib/socket';
import { initSoundUnlock, playMessageSound, playGlobalPing, isSoundMuted, setSoundMuted } from '../lib/sound';
import { setDmUnread, setGlobalActivity, setGlobalMentions, resetTitle } from '../lib/tabTitle';
import {
  notificationsSupported, getNotificationPermission, requestNotificationPermission, showMessageNotification,
} from '../lib/notifications';
import Avatar from '../components/common/Avatar';
import AppSidebar from '../components/common/AppSidebar';
import { SkeletonRow } from '../components/uiverse/Spinner';
import type { ConversationSummary, Me, PublicUser } from '../types';

export default function AppLayout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useAuth((s) => s.me);
  const setMe = useAuth((s) => s.setMe);
  const section = useUi((s) => s.section);
  const setSection = useUi((s) => s.setSection);

  const [online, setOnline] = useState(true);
  const [listSearch, setListSearch] = useState('');
  const [soundOff, setSoundOff] = useState(isSoundMuted());
  const [notifyState, setNotifyState] = useState(getNotificationPermission());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mentionCount, setMentionCount] = useState(0);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Unlock WebAudio on first gesture; reset title on mount
  useEffect(() => {
    initSoundUnlock();
    resetTitle();
    return () => resetTitle();
  }, []);

  // Bootstrap session from cookie
  useEffect(() => {
    api.get('/auth/me')
      .then(({ data }) => setMe((data as { me: Me }).me))
      .catch(() => navigate('/auth', { replace: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Connect sockets once authenticated
  useEffect(() => {
    if (!me) return;
    getGlobalSocket().connect();
    getDmSocket().connect();

    const dmSock = getDmSocket();
    const onDmNew = (m: { senderId: string; conversationId: string; text: string }) => {
      if (m.senderId !== me.id) {
        playMessageSound();
        qc.invalidateQueries({ queryKey: ['chats'] });
        const convs = qc.getQueryData<{ items: ConversationSummary[] }>(['chats']);
        const conv = convs?.items.find((c) => c.id === m.conversationId);
        showMessageNotification({
          title: conv?.other?.displayName ?? 'New message',
          body: m.text.slice(0, 120),
          icon: conv?.other?.avatar,
          tag: `dm-${m.conversationId}`,
          onClick: () => {
            navigate('/app/chats');
            useUi.getState().requestOpenConversation(m.conversationId);
          },
        });
      }
    };
    dmSock.on('dm:new', onDmNew);
    return () => {
      dmSock.off('dm:new', onDmNew);
    };
  }, [me, qc, navigate]);

  // Global chat activity → soft ping + title dot
  useEffect(() => {
    const gs = getGlobalSocket();
    const onMsg = (m: { senderId: string }) => {
      if (m.senderId !== me?.id) {
        playGlobalPing();
        setGlobalActivity(true);
      }
    };
    // Someone typed @you in Global Chat → stronger chime + desktop notification + badge.
    const onMention = (p: {
      messageId: string;
      text: string;
      from: { id: string; displayName: string; avatar?: string } | null;
    }) => {
      setMentionCount((c) => c + 1);
      playMessageSound();
      showMessageNotification({
        title: p.from ? `${p.from.displayName} mentioned you` : 'You were mentioned in Global Chat',
        body: p.text.slice(0, 120),
        icon: p.from?.avatar,
        tag: 'global-mention',
        onClick: () => {
          setSection('global');
          navigate('/app/global');
        },
      });
    };
    gs.on('global:message', onMsg);
    gs.on('global:mention', onMention);
    return () => {
      gs.off('global:message', onMsg);
      gs.off('global:mention', onMention);
    };
  }, [me?.id, navigate, setSection]);

  const chatsQuery = useQuery({
    queryKey: ['chats'],
    queryFn: async () => (await api.get('/chats')).data as { items: ConversationSummary[] },
    enabled: Boolean(me),
    refetchInterval: 30_000,
  });

  const items = chatsQuery.data?.items ?? [];
  const totalUnread = items.reduce((acc, c) => acc + (c.unread || 0), 0);

  // Tab title unread counter
  useEffect(() => {
    setDmUnread(totalUnread);
  }, [totalUnread]);

  // Clear global-activity dot when viewing Global Chat
  useEffect(() => {
    if (section === 'global') {
      setGlobalActivity(false);
      setMentionCount(0);
    }
  }, [section]);

  // Mention badge → browser tab title
  useEffect(() => {
    setGlobalMentions(mentionCount);
  }, [mentionCount]);

  const filteredItems = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (c) =>
        c.other?.displayName?.toLowerCase().includes(q) ||
        c.other?.username?.toLowerCase().includes(q)
    );
  }, [items, listSearch]);

  const [userResults, setUserResults] = useState<PublicUser[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);

  useEffect(() => {
    const q = listSearch.trim();
    if (!q) {
      setUserResults([]);
      setSearchingUsers(false);
      return;
    }
    const timer = setTimeout(() => {
      setSearchingUsers(true);
      api.get('/users/search', { params: { q } })
        .then(({ data }) => setUserResults((data as { results: PublicUser[] }).results))
        .catch(() => setUserResults([]))
        .finally(() => setSearchingUsers(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [listSearch]);

  const startDirectChat = async (username: string) => {
    try {
      const { data } = await api.post('/chats/direct', { username });
      qc.invalidateQueries({ queryKey: ['chats'] });
      setListSearch('');
      setSection('chats');
      navigate('/app/chats');
      useUi.getState().requestOpenConversation(data.conversation.id);
    } catch {
      // ignore
    }
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      getGlobalSocket()?.disconnect();
      getDmSocket()?.disconnect();
      setMe(null);
      navigate('/auth');
    }
  };

  const goGlobal = () => {
    setSection('global');
    navigate('/app/global');
  };
  const goChats = () => {
    setSection('chats');
    navigate('/app/chats');
  };

  return (
    <div className="h-screen w-screen flex bg-[var(--wa-bg)] text-[var(--wa-text)] overflow-hidden app-shell-bg">
      {/* ============ LEFT SIDEBAR — desktop/tablet rail ============ */}
      <div className="hidden md:flex shrink-0">
        <AppSidebar onLogout={logout} totalUnread={totalUnread} globalMentions={mentionCount} />
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* ============ TOP NAVBAR ============ */}
        <header className="h-[60px] shrink-0 bg-[var(--wa-panel-2)] border-b border-[var(--wa-border)] px-2 sm:px-3 md:px-4 flex items-center gap-1.5 sm:gap-2 md:gap-4 z-40">
          {/* hamburger (mobile) — opens navigation sidebar drawer */}
          <button
            className="md:hidden p-2 rounded-full text-[var(--wa-text-2)] hover:bg-[var(--wa-hover)] hover:text-[var(--wa-text)] cursor-pointer"
            title="Menu"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu size={21} />
          </button>

          {/* logo */}
          <button className="flex items-center gap-2 shrink-0 cursor-pointer" onClick={goGlobal} title="PulseChat">
            <span className="text-2xl leading-none">🌍</span>
            <span className="hidden sm:inline font-semibold text-[16px] tracking-tight">Pulse<span className="text-[var(--wa-green-hover)]">Chat</span></span>
          </button>

          {/* right controls */}
          <div className="ml-auto flex items-center gap-1 md:gap-2 shrink-0">
            {!online && <span title="Offline" className="inline-flex text-amber-400"><WifiOff size={16} /></span>}
            <button
              className="p-2 rounded-full text-[var(--wa-text-2)] hover:bg-[var(--wa-hover)] hover:text-[var(--wa-text)] transition cursor-pointer"
              title={soundOff ? 'Unmute notification sounds' : 'Mute notification sounds'}
              onClick={() => {
                setSoundMuted(!isSoundMuted());
                setSoundOff(isSoundMuted());
              }}
            >
              {soundOff ? <VolumeX size={19} /> : <Volume2 size={19} />}
            </button>
            {notificationsSupported() && (
              <button
                className={`p-2 rounded-full transition cursor-pointer ${
                  notifyState === 'granted'
                    ? 'text-[var(--wa-green-hover)]'
                    : 'text-[var(--wa-text-2)] hover:bg-[var(--wa-hover)] hover:text-[var(--wa-text)]'
                }`}
                title={
                  notifyState === 'granted'
                    ? 'Desktop notifications enabled'
                    : notifyState === 'denied'
                      ? 'Notifications blocked'
                      : 'Enable desktop notifications'
                }
                onClick={async () => {
                  if (notifyState !== 'default') return;
                  setNotifyState(await requestNotificationPermission());
                }}
              >
                {notifyState === 'granted' ? <Bell size={19} /> : <BellOff size={19} />}
              </button>
            )}
            <button
              className="p-2 rounded-full text-[var(--wa-text-2)] hover:bg-[var(--wa-hover)] hover:text-[var(--wa-text)] transition cursor-pointer"
              title="Profile / Settings"
              onClick={() => {
                setSection('settings');
                navigate('/app/settings');
              }}
            >
              <SettingsIcon size={19} />
            </button>
            <button onClick={() => navigate('/app/settings')} title="Your profile" className="ml-0.5 cursor-pointer">
              <Avatar src={me?.avatar || undefined} name={me?.displayName ?? '?'} size={34} />
            </button>
          </div>
        </header>

        {/* ============ DRAWER (mobile sidebar) ============ */}
        {drawerOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
            <div className="absolute left-0 top-0 bottom-0 w-[260px] max-w-[85vw] flex flex-col shadow-2xl z-10">
              <AppSidebar onLogout={logout} totalUnread={totalUnread} globalMentions={mentionCount} onNavigate={() => setDrawerOpen(false)} />
            </div>
          </div>
        )}

      {/* ============ BODY: chat list + main ============ */}
      <div className="flex-1 min-h-0 flex">
        {/* chat list panel — desktop/tablet only (hidden when in Settings) */}
        {section !== 'settings' && (
          <aside className="hidden lg:flex w-[340px] xl:w-[400px] shrink-0 wa-glass-panel border-r border-[var(--wa-border)] flex-col">
            {/* ===== SECTION 1: GLOBAL ===== */}
            <div className="px-4 pt-3 pb-1 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-sky-400/90 flex items-center gap-1.5">
                <Globe size={11} /> Global
              </span>
              <span className="text-[10px] text-[var(--wa-text-2)]">everyone · public</span>
            </div>
            <div className="px-2">
              <div
                className={`wa-row-item rounded-lg ${section === 'global' ? 'active' : ''} cursor-pointer`}
                onClick={goGlobal}
              >
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <div className="w-[49px] h-[49px] rounded-full bg-gradient-to-br from-sky-400 to-sky-700 flex items-center justify-center text-2xl shrink-0">🌍</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="font-medium text-[15px]">Global Chat</span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {mentionCount > 0 && (
                          <span className="text-[10px] font-bold bg-amber-400/20 text-amber-300 rounded-full px-1.5 py-px">
                            @{mentionCount}
                          </span>
                        )}
                        <OnlineCountInline />
                      </span>
                    </div>
                    <div className="text-[13px] text-[var(--wa-text-2)] truncate">One chat · the whole world · live</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mx-3 my-2 h-px bg-[var(--wa-border)]" />

            {/* ===== SECTION 2: ONE-TO-ONE ===== */}
            <div className="px-4 pb-1 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400/90 flex items-center gap-1.5">
                <MessageCircle size={11} /> One-to-One
              </span>
              <button
                className="text-[11px] font-semibold text-[var(--wa-green-hover)] hover:text-[var(--wa-text)] flex items-center gap-1 cursor-pointer"
                onClick={goChats}
              >
                + New Chat
              </button>
            </div>

            {/* search (inside One-to-One section) */}
            <div className="px-3 py-1.5">
              <div className="flex items-center gap-2 bg-[var(--wa-search)] rounded-lg px-3 py-1.5 border border-white/5">
                <Search size={15} className="text-[var(--wa-text-2)] shrink-0" />
                <input
                  className="bg-transparent outline-none text-[13.5px] w-full placeholder:text-[var(--wa-text-2)]"
                  placeholder="Search username… e.g. @nareshk"
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto wa-scroll px-2 pb-3">
              {chatsQuery.isLoading ? (
                <div className="px-2 pt-2"><SkeletonRow /><SkeletonRow /><SkeletonRow /></div>
              ) : listSearch.trim() ? (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--wa-text-2)] px-2 py-1.5 flex items-center gap-1.5">
                    <Users size={11} /> Search Results
                  </div>
                  {searchingUsers ? (
                    <div className="px-2 pt-2"><SkeletonRow /></div>
                  ) : userResults.length === 0 && filteredItems.length === 0 ? (
                    <div className="text-center text-[13px] text-[var(--wa-text-2)] px-4 py-8">
                      No users or chats found for "{listSearch}"
                    </div>
                  ) : (
                    <>
                      {filteredItems.map((c) => <ChatListItem key={c.id} conv={c} />)}
                      {userResults.map((u) => (
                        <div
                          key={u.id}
                          className="wa-row-item rounded-lg cursor-pointer"
                          onClick={() => startDirectChat(u.username)}
                        >
                          <div className="flex items-center gap-3 px-3 py-2.5">
                            <Avatar src={u.avatar || undefined} name={u.displayName} size={42} online={u.online} />
                            <div className="flex-1 min-w-0">
                              <div className="text-[14.5px] font-medium truncate">{u.displayName}</div>
                              <div className="text-[12.5px] text-[var(--wa-text-2)] truncate">@{u.username}</div>
                            </div>
                            <button className="px-3 py-1 rounded-full bg-[var(--wa-green)] text-[#0b141a] text-[12px] font-semibold hover:bg-[var(--wa-green-hover)] transition cursor-pointer">
                              Chat
                            </button>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="text-center text-[13px] text-[var(--wa-text-2)] px-8 py-10 leading-relaxed">
                  <Users size={26} className="mx-auto mb-3 opacity-40" />
                  No private chats yet.<br />
                  Search a username above (e.g. <span className="text-[var(--wa-text)]">@nareshk</span>).
                </div>
              ) : (
                filteredItems.map((c) => <ChatListItem key={c.id} conv={c} />)
              )}
            </div>
          </aside>
        )}

        {/* main content */}
        <main className="flex-1 min-w-0 flex flex-col relative">
          {!online && (
            <div className="absolute top-0 inset-x-0 z-40 bg-amber-400 text-slate-900 text-xs font-semibold px-4 py-1 flex items-center justify-center gap-2">
              <WifiOff size={13} /> Reconnecting… messages will sync automatically
            </div>
          )}
          <Outlet />
        </main>
      </div>
      </div>
    </div>
  );
}

function DrawerList({ filteredItems, loading, section, onNavigate, goGlobal, onlineCountInline, listSearch, setListSearch }: {
  filteredItems: ConversationSummary[];
  loading: boolean;
  section: string;
  onNavigate: () => void;
  goGlobal: () => void;
  onlineCountInline: React.ReactNode;
  listSearch: string;
  setListSearch: (v: string) => void;
}) {
  const navigate = useNavigate();
  return (
    <>
      <div className="px-4 pt-3 pb-1">
        <span className="text-[11px] font-bold uppercase tracking-wider text-sky-400/90">🌐 Global</span>
      </div>
      <div className="px-2">
        <div className={`wa-row-item rounded-lg ${section === 'global' ? 'active' : ''} cursor-pointer`} onClick={() => { goGlobal(); onNavigate(); }}>
          <div className="flex items-center gap-3 px-3 py-2.5">
            <div className="w-[49px] h-[49px] rounded-full bg-gradient-to-br from-sky-400 to-sky-700 flex items-center justify-center text-2xl shrink-0">🌍</div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-[15px]">Global Chat</div>
              <div className="text-[13px] text-[var(--wa-text-2)] truncate">One chat · the whole world</div>
            </div>
            {onlineCountInline}
          </div>
        </div>
      </div>
      <div className="mx-3 my-2 h-px bg-[var(--wa-border)]" />
      <div className="px-4 pb-1 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400/90">💬 One-to-One</span>
        <button
          className="text-[11px] font-semibold text-[var(--wa-green-hover)]"
          onClick={() => { onNavigate(); navigate('/app/chats'); }}
        >
          + New Chat
        </button>
      </div>
      <div className="px-3 py-1.5">
        <div className="flex items-center gap-2 bg-[var(--wa-search)] rounded-lg px-3 py-1.5 border border-white/5">
          <Search size={15} className="text-[var(--wa-text-2)] shrink-0" />
          <input
            className="bg-transparent outline-none text-[13.5px] w-full placeholder:text-[var(--wa-text-2)]"
            placeholder="Search username… e.g. @nareshk"
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto wa-scroll px-2 pb-3">
        {loading ? (
          <div className="px-2 pt-2"><SkeletonRow /><SkeletonRow /></div>
        ) : filteredItems.length === 0 ? (
          <p className="text-center text-[13px] text-[var(--wa-text-2)] px-8 py-10">
            No private chats yet.<br />Tap + New Chat → search @username.
          </p>
        ) : (
          filteredItems.map((c) => (
            <div key={c.id} className="wa-row-item rounded-lg cursor-pointer" onClick={() => { navigate('/app/chats'); useUi.getState().requestOpenConversation(c.id); onNavigate(); }}>
              <div className="flex items-center gap-3 px-3 py-2.5">
                <Avatar src={c.other?.avatar || undefined} name={c.other?.displayName ?? '?'} size={45} online={c.other?.online} />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline gap-2">
                    <span className="font-medium text-[15px] truncate">{c.other?.displayName ?? 'Unknown'}</span>
                    <span className="text-[11px] text-[var(--wa-text-2)]">{c.lastMessage?.at ? timeAgo(c.lastMessage.at) : ''}</span>
                  </div>
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-[13px] text-[var(--wa-text-2)] truncate">{c.lastMessage?.text ?? 'Say hi 👋'}</span>
                    {c.unread > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--wa-green)] text-[#0b141a] text-[11px] font-bold flex items-center justify-center">{c.unread}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function OnlineCountInline() {
  const { data } = useQuery({
    queryKey: ['global-meta-lite'],
    queryFn: async () => (await api.get('/global/meta')).data as { onlineCount: number },
    refetchInterval: 20_000,
  });
  if (data?.onlineCount == null) return null;
  return <span className="text-[11px] text-[var(--wa-green-hover)] shrink-0">{data.onlineCount} live</span>;
}

function ChatListItem({ conv }: { conv: ConversationSummary }) {
  const navigate = useNavigate();
  const activeId = useUi((s) => s.activeConversationId);
  const active = activeId === conv.id;
  return (
    <div
      className={`wa-row-item rounded-lg ${active ? 'active' : ''} cursor-pointer`}
      onClick={() => {
        navigate('/app/chats');
        useUi.getState().requestOpenConversation(conv.id);
      }}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Avatar src={conv.other?.avatar || undefined} name={conv.other?.displayName ?? '?'} size={49} online={conv.other?.online} />
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-baseline gap-2">
            <span className="font-medium text-[15px] truncate">{conv.other?.displayName ?? 'Unknown'}</span>
            <span className={`text-[11px] shrink-0 ${conv.unread ? 'text-[var(--wa-green-hover)]' : 'text-[var(--wa-text-2)]'}`}>
              {conv.lastMessage?.at ? timeAgo(conv.lastMessage.at) : ''}
            </span>
          </div>
          <div className="flex justify-between items-center gap-2">
            <span className="text-[13px] text-[var(--wa-text-2)] truncate">
              {conv.lastMessage ? `${conv.lastMessage.mine ? 'You: ' : ''}${conv.lastMessage.text}` : 'Say hi 👋'}
            </span>
            {conv.unread > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--wa-green)] text-[#0b141a] text-[11px] font-bold flex items-center justify-center shrink-0">
                {conv.unread > 99 ? '99+' : conv.unread}
              </span>
            )}
          </div>
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
