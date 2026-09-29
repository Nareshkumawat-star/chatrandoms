import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Globe2, MessageCircle, Zap, Lock } from 'lucide-react';
import { api, apiError } from '../lib/api';
import { useAuth } from '../store/auth';
import type { Me } from '../types';
import GlowButton from '../components/uiverse/GlowButton';
import NeonInput from '../components/uiverse/NeonInput';
import { Link001 } from '../components/ui/skiper-ui/skiper40';

type Mode = 'login' | 'register';

export default function AuthPage() {
  const navigate = useNavigate();
  const setMe = useAuth((s) => s.setMe);
  const [mode, setMode] = useState<Mode>('login');
  const [form, setForm] = useState({ identifier: '', username: '', displayName: '', email: '', password: '' });
  const [error, setError] = useState('');

  const finish = (me: Me) => {
    setMe(me);
    navigate('/app/global');
  };

  const guest = useMutation({
    mutationFn: async () => (await api.post('/auth/guest')).data as { me: Me },
    onSuccess: ({ me }) => finish(me),
    onError: (e) => setError(apiError(e)),
  });

  const login = useMutation({
    mutationFn: async () =>
      (await api.post('/auth/login', { identifier: form.identifier, password: form.password })).data as { me: Me },
    onSuccess: ({ me }) => finish(me),
    onError: (e) => setError(apiError(e)),
  });

  const register = useMutation({
    mutationFn: async () =>
      (
        await api.post('/auth/register', {
          username: form.username,
          displayName: form.displayName,
          email: form.email,
          password: form.password,
        })
      ).data as { me: Me },
    onSuccess: ({ me }) => finish(me),
    onError: (e) => setError(apiError(e)),
  });

  const busy = guest.isPending || login.isPending || register.isPending;

  return (
    <div className="flex-1 min-h-0 text-[var(--wa-text)] relative overflow-hidden">
      <PulseWrapper />

      <div className="absolute inset-0 overflow-y-auto wa-scroll flex items-center justify-center p-4 sm:p-6">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="relative w-full max-w-[400px]">
        <div className="wa-glass-chip border border-[var(--wa-border)] rounded-3xl p-6 sm:p-8">
          <div className="text-center mb-7">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[var(--wa-green)] flex items-center justify-center text-3xl shadow-lg shadow-emerald-900/40">
              🌍
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">PulseChat</h1>
            <p className="text-[var(--wa-text-2)] mt-1.5 text-[13.5px]">
              One world chat. Private 1-to-1 chats. Real time.
            </p>
          </div>

          <div className="flex bg-[var(--wa-panel-2)] rounded-xl p-1 mb-6">
            {(['login', 'register'] as Mode[]).map((m) => (
              <button
                key={m}
                className={`flex-1 py-2 rounded-lg text-[13.5px] font-medium transition ${
                  mode === m ? 'bg-[var(--wa-green)] text-[#0b141a]' : 'text-[var(--wa-text-2)] hover:text-[var(--wa-text)]'
                }`}
                onClick={() => setMode(m)}
              >
                {m === 'login' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          {mode === 'login' ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                setError('');
                login.mutate();
              }}
            >
              <NeonInput
                label="Username or email"
                value={form.identifier}
                onChange={(e) => setForm({ ...form, identifier: e.target.value })}
                placeholder="nareshk or you@mail.com"
                autoComplete="username"
              />
              <NeonInput
                label="Password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="••••••••"
                autoComplete="current-password"
              />
              {error && <p className="text-[13px] text-rose-400">{error}</p>}
              <GlowButton variant="primary" type="submit" disabled={busy} className="w-full">
                Sign in
              </GlowButton>
            </form>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                setError('');
                register.mutate();
              }}
            >
              <NeonInput
                label="Username (unique)"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="nareshk"
                autoComplete="off"
              />
              <NeonInput
                label="Display name"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                placeholder="Naresh Kumawat"
              />
              <NeonInput
                label="Email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="you@mail.com"
                autoComplete="email"
              />
              <NeonInput
                label="Password (min 8 chars)"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="••••••••"
                autoComplete="new-password"
              />
              {error && <p className="text-[13px] text-rose-400">{error}</p>}
              <GlowButton variant="primary" type="submit" disabled={busy} className="w-full">
                Create account
              </GlowButton>
            </form>
          )}

          <div className="flex items-center gap-3 my-6">
            <div className="h-px bg-[var(--wa-border)] flex-1" />
            <span className="text-[11px] text-[var(--wa-text-2)]">or</span>
            <div className="h-px bg-[var(--wa-border)] flex-1" />
          </div>

          <GlowButton className="w-full" disabled={busy} onClick={() => guest.mutate()}>
            <Zap size={15} /> Continue as guest
          </GlowButton>
          <p className="text-[11.5px] text-[var(--wa-text-2)] text-center mt-3 flex items-center justify-center gap-1">
            <Lock size={11} /> Guests can read Global Chat — register for private chats
          </p>
        </div>

        <div className="mt-6 flex items-center justify-center gap-6 text-[11.5px] text-[var(--wa-text-2)]">
          <span className="flex items-center gap-1.5"><Globe2 size={13} className="text-sky-400" /> 1 Global Chat</span>
          <span className="flex items-center gap-1.5"><MessageCircle size={13} className="text-emerald-400" /> Private 1-to-1</span>
        </div>

        {/* Skiper UI animated link (attribution, opens in a new tab) */}
        <div className="mt-4 flex items-center justify-center text-[11.5px] text-[var(--wa-text-2)]">
          <Link001 href="https://skiper-ui.com" className="hover:text-[var(--wa-green-hover)]">
            Animated links by Skiper UI
          </Link001>
        </div>
      </motion.div>
      </div>
    </div>
  );
}

function PulseWrapper() {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full blur-3xl opacity-25" style={{ background: 'radial-gradient(circle, #14b8a6 0%, transparent 65%)' }} />
      <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] rounded-full blur-3xl opacity-20" style={{ background: 'radial-gradient(circle, #0d9488 0%, transparent 65%)' }} />
    </div>
  );
}
