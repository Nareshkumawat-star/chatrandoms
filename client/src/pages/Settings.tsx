import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { LogOut, Upload, Check, EyeOff, ShieldCheck } from 'lucide-react';
import { api, apiError } from '../lib/api';
import { useAuth } from '../store/auth';
import type { Me } from '../types';
import Avatar from '../components/common/Avatar';
import GlowButton from '../components/uiverse/GlowButton';
import NeonInput from '../components/uiverse/NeonInput';
import Toggle from '../components/uiverse/Toggle';

export default function Settings() {
  const { me, setMe } = useAuth();
  const [displayName, setDisplayName] = useState(me?.displayName ?? '');
  const [bio, setBio] = useState(me?.bio ?? '');
  const [anonymousMode, setAnonymousMode] = useState(me?.anonymousMode ?? false);
  const [noiseFilterLevel, setNoiseFilterLevel] = useState(me?.noiseFilterLevel ?? 0);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const save = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const { data } = await api.patch('/users/me', patch);
      return data as { user: Me };
    },
    onSuccess: ({ user }) => {
      setMe({ ...me!, ...user });
      setMsg('Saved');
      setTimeout(() => setMsg(''), 1800);
    },
    onError: (e) => setErr(apiError(e)),
  });

  const uploadAvatar = useMutation({
    mutationFn: async (file: File) => {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const { data } = await api.post('/upload/avatar', { dataUrl });
      return data as { url: string };
    },
    onSuccess: ({ url }) => save.mutate({ avatar: url }),
    onError: (e) => setErr(apiError(e)),
  });

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      window.location.href = '/auth';
    }
  };

  if (!me) return null;
  const guest = me.isGuest;

  return (
    <div className="flex-1 min-w-0 h-full overflow-y-auto wa-scroll bg-[var(--wa-panel)] border-l border-[var(--wa-border)]">
      {/* header bar */}
      <div className="h-[59px] shrink-0 px-5 flex items-center bg-[var(--wa-panel-2)] border-b border-[var(--wa-border)] sticky top-0 z-10">
        <h1 className="font-semibold text-[16px]">Profile / Settings</h1>
      </div>

      <div className="max-w-xl mx-auto px-4 sm:px-5 py-6 sm:py-8 pb-24 lg:pb-8">
        {/* profile card */}
        <div className="bg-[var(--wa-panel-2)] border border-[var(--wa-border)] rounded-2xl p-6 mb-5">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-5 mb-6 text-center sm:text-left">
            <div className="relative">
              <Avatar src={me.avatar || undefined} name={me.displayName} size={84} />
              {!guest && (
                <button
                  className="absolute -bottom-1 -right-1 p-2 rounded-full bg-[var(--wa-green)] text-[#0b141a] hover:bg-[var(--wa-green-hover)] transition shadow-lg"
                  title="Upload avatar"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload size={14} />
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadAvatar.mutate(f);
                }}
              />
            </div>
            <div className="min-w-0">
              <div className="text-lg font-semibold truncate">{me.displayName}</div>
              <div className="text-[14px] text-[var(--wa-green-hover)]">@{me.username}</div>
              <div className="text-[12px] text-[var(--wa-text-2)] mt-1 flex items-center gap-2">
                <span>⭐ {me.reputation} reputation</span>
                {guest ? <span className="text-amber-400">· Guest</span> : <span className="text-[var(--wa-green-hover)]">· Registered</span>}
              </div>
            </div>
          </div>

          {guest ? (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-[13.5px] text-amber-200">
              <p className="font-semibold mb-1 flex items-center gap-2"><ShieldCheck size={15} /> Guest session</p>
              <p className="text-[12.5px] text-amber-200/80 mb-3">
                Guests can read & react in Global Chat. Create an account to unlock private Chats, username search,
                persistence and reputation.
              </p>
              <GlowButton variant="primary" onClick={() => (window.location.href = '/auth')}>
                Create an account
              </GlowButton>
            </div>
          ) : (
            <div className="space-y-4">
              <NeonInput label="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={50} />
              <NeonInput label="Bio" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={200} />

              <div className="flex items-center justify-between bg-[var(--wa-panel)] rounded-xl px-4 py-3 border border-[var(--wa-border)]">
                <div>
                  <div className="text-[14px] flex items-center gap-2"><EyeOff size={14} /> Anonymous display mode</div>
                  <p className="text-[12px] text-[var(--wa-text-2)] mt-0.5">Show as "anonymous" on Global Chat messages.</p>
                </div>
                <Toggle on={anonymousMode} onChange={setAnonymousMode} />
              </div>

              <div className="flex items-center justify-between bg-[var(--wa-panel)] rounded-xl px-4 py-3 border border-[var(--wa-border)]">
                <div>
                  <div className="text-[14px]">Global noise filter</div>
                  <p className="text-[12px] text-[var(--wa-text-2)] mt-0.5">
                    Default filter level ({['Off', 'Light', 'Medium', 'Strict'][noiseFilterLevel]}).
                  </p>
                </div>
                <input
                  type="range" min={0} max={3} value={noiseFilterLevel}
                  onChange={(e) => setNoiseFilterLevel(Number(e.target.value))}
                  className="w-28 accent-emerald-400"
                />
              </div>

              <div className="flex items-center gap-3 pt-1">
                <GlowButton
                  variant="primary"
                  disabled={save.isPending}
                  onClick={() => save.mutate({ displayName, bio, anonymousMode, noiseFilterLevel })}
                >
                  <Check size={15} /> {save.isPending ? 'Saving…' : 'Save changes'}
                </GlowButton>
                {msg && <span className="text-[12.5px] text-[var(--wa-green-hover)]">{msg}</span>}
                {err && <span className="text-[12.5px] text-rose-400">{err}</span>}
              </div>
            </div>
          )}
        </div>

        <div className="bg-[var(--wa-panel-2)] border border-[var(--wa-border)] rounded-2xl p-6">
          <h2 className="font-semibold text-[15px] mb-2">Privacy & data</h2>
          <ul className="text-[12.5px] text-[var(--wa-text-2)] space-y-1.5 list-disc pl-4">
            <li>Private messages are stored per-conversation and never appear in Global Chat.</li>
            <li>Only conversation participants can read their messages — enforced on the server.</li>
            <li>You can block, mute or report any user from their profile.</li>
            <li>Expiring messages are auto-deleted by a MongoDB TTL index.</li>
          </ul>
          <div className="mt-5">
            <GlowButton onClick={logout}><LogOut size={15} /> Log out</GlowButton>
          </div>
        </div>
      </div>
    </div>
  );
}
