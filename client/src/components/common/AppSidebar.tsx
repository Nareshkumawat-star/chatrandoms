import { useNavigate } from 'react-router';
import type { LucideIcon } from 'lucide-react';
import { Globe, MessageCircle, Settings as SettingsIcon, LogOut, LogIn, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link000, Link001, Link005 } from '@/components/ui/skiper-ui/skiper40';
import Avatar from './Avatar';
import { api } from '../../lib/api';
import { getDmSocket, getGlobalSocket } from '../../lib/socket';
import { useAuth } from '../../store/auth';
import { useUi } from '../../store/ui';

interface Props {
  /** Only meaningful when signed in. */
  onLogout?: () => void;
  totalUnread?: number;
  /** Unread @mentions in Global Chat. */
  globalMentions?: number;
  onNavigate?: () => void;
}

/**
 * Navigation rail, shown only when the user is signed in (guest or registered)
 * — the public landing page renders without it. Always displays the full
 * labels — Global, One-to-One, Settings and Log out — at every screen size.
 */
export default function AppSidebar({ onLogout, totalUnread = 0, globalMentions = 0, onNavigate }: Props) {
  const navigate = useNavigate();
  const me = useAuth((s) => s.me);
  const section = useUi((s) => s.section);
  const setSection = useUi((s) => s.setSection);
  const signedIn = Boolean(me);

  /** Signed-out visitors go straight to the auth page instead of hitting the route guard. */
  const target = (path: string) => (signedIn ? path : '/auth');
  const pick = (s: 'global' | 'chats' | 'settings') => () => {
    if (signedIn) setSection(s);
    if (onNavigate) onNavigate();
  };

  const go = (s: 'global' | 'chats' | 'settings', path: string) => {
    setSection(s);
    if (onNavigate) onNavigate();
    navigate(target(path));
  };

  /** Falls back to a local logout so the rail works outside the app shell too. */
  const signOut = async () => {
    if (onNavigate) onNavigate();
    if (onLogout) {
      onLogout();
      return;
    }
    try {
      await api.post('/auth/logout');
    } finally {
      getGlobalSocket()?.disconnect();
      getDmSocket()?.disconnect();
      useAuth.getState().setMe(null);
      navigate('/auth');
    }
  };

  return (
    <aside className="flex h-full w-[220px] lg:w-[250px] shrink-0 flex-col wa-glass-panel border-r border-[var(--wa-border)] relative z-20">
      {/* brand */}
      <div className="h-[60px] shrink-0 flex items-center px-4">
        <button
          className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer"
          onClick={() => (signedIn ? go('global', '/app/global') : navigate('/auth'))}
          title="PulseChat"
        >
          <span className="w-9 h-9 shrink-0 rounded-xl bg-gradient-to-br from-teal-300 to-teal-700 grid place-items-center text-lg shadow-lg shadow-teal-950/50">
            🌍
          </span>
          <span className="font-semibold text-[15px] tracking-tight truncate">
            Pulse<span className="text-[var(--wa-green-hover)]">Chat</span>
          </span>
        </button>
      </div>

      <div className="mx-3 h-px bg-[var(--wa-border)]" />

      {/* navigation */}
      <nav className="flex-1 min-h-0 overflow-y-auto wa-scroll px-3 py-3">
        <p className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--wa-text-2)]">
          Chats
        </p>
        <SideNavLink
          icon={Globe}
          label="Global"
          to={target('/app/global')}
          onSelect={pick('global')}
          active={signedIn && section === 'global'}
          tone="sky"
          badge={signedIn ? globalMentions : 0}
        />
        <SideNavLink
          icon={MessageCircle}
          label="One-to-One"
          to={target('/app/chats')}
          onSelect={pick('chats')}
          active={signedIn && section === 'chats'}
          tone="teal"
          badge={signedIn ? totalUnread : 0}
        />

        <p className="px-2 pt-4 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--wa-text-2)]">
          Account
        </p>
        <SideNavLink
          icon={SettingsIcon}
          label="Settings"
          to={target('/app/settings')}
          onSelect={pick('settings')}
          active={signedIn && section === 'settings'}
          tone="slate"
        />

        {!signedIn && (
          <p className="px-2 pt-4 text-[11.5px] leading-relaxed text-[var(--wa-text-2)]">
            Log in to open Global Chat, private 1-to-1 chats and settings.
          </p>
        )}
      </nav>

      {/* account actions — always present, logged in or not */}
      <div className="shrink-0 p-3 border-t border-[var(--wa-border)] space-y-2.5">
        {me ? (
          <>
            <div
              className="flex items-center gap-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] p-2.5"
              title={me.isGuest ? 'Guest — limited mode' : `@${me.username}`}
            >
              <Avatar src={me.avatar || undefined} name={me.displayName} size={34} />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium truncate">{me.displayName}</div>
                <div className="text-[11.5px] text-[var(--wa-text-2)] truncate">
                  {me.isGuest ? 'Guest — limited mode' : `@${me.username}`}
                </div>
              </div>
            </div>

            {/* guests get an upgrade path to a full account */}
            {me.isGuest && (
              <Button
                size="lg"
                className="w-full gap-2 cursor-pointer"
                onClick={() => {
                  if (onNavigate) onNavigate();
                  navigate('/auth');
                }}
              >
                <UserPlus size={16} /> Create account
              </Button>
            )}

            <Button
              variant="outline"
              size="lg"
              className="w-full justify-start gap-2 text-rose-300 hover:text-rose-200 hover:border-rose-400/40 hover:bg-rose-950/30 cursor-pointer"
              onClick={signOut}
            >
              <LogOut size={16} /> Log out
            </Button>
          </>
        ) : (
          <>
            <Button
              size="lg"
              className="w-full gap-2 cursor-pointer"
              onClick={() => {
                if (onNavigate) onNavigate();
                navigate('/auth');
              }}
            >
              <LogIn size={16} /> Log in
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="w-full gap-2 cursor-pointer"
              onClick={() => {
                if (onNavigate) onNavigate();
                navigate('/auth');
              }}
            >
              <UserPlus size={16} /> Create account
            </Button>
          </>
        )}

        {/* Skiper UI animated links (external) */}
        <div className="flex items-center justify-between px-1 pt-0.5 text-[10.5px] text-[var(--wa-text-2)]">
          <Link001 href="mailto:hi@skiper-ui.com" className="hover:text-[var(--wa-green-hover)]">
            Skiper UI
          </Link001>
          <Link005 href="https://skiper-ui.com" className="hover:text-[var(--wa-green-hover)]">
            Docs
          </Link005>
        </div>
      </div>
    </aside>
  );
}

/** Nav row built on Skiper UI's animated underline link. */
function SideNavLink({
  icon: Icon,
  label,
  to,
  onSelect,
  active,
  badge = 0,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  to: string;
  onSelect: () => void;
  active: boolean;
  badge?: number;
  tone: 'sky' | 'teal' | 'slate';
}) {
  const tones: Record<string, string> = {
    sky: 'text-sky-300',
    teal: 'text-[var(--wa-green-hover)]',
    slate: 'text-slate-300',
  };

  return (
    <Link000
      to={to}
      title={label}
      onClick={() => onSelect()}
      className={`relative w-full justify-start gap-2.5 rounded-xl px-2.5 py-2.5 text-[13.5px] font-semibold transition-colors ${
        active
          ? 'bg-[var(--wa-active)] text-[var(--wa-text)] ring-1 ring-white/10'
          : 'text-[var(--wa-text-2)] hover:bg-[var(--wa-hover)] hover:text-[var(--wa-text)]'
      }`}
    >
      <Icon size={17} className={active ? tones[tone] : ''} />
      <span className="flex-1 text-left truncate">{label}</span>
      {badge > 0 && (
        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--wa-green)] text-[#05201b] text-[10.5px] font-bold flex items-center justify-center">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link000>
  );
}
