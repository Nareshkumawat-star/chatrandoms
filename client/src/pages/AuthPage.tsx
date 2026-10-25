import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Globe2, MessageCircle, Zap, Lock, Eye, EyeOff, AlertCircle, ArrowRight, UserCheck } from 'lucide-react';
import { api, apiError } from '../lib/api';
import { useAuth } from '../store/auth';
import type { Me } from '../types';
import GlowButton from '../components/uiverse/GlowButton';
import NeonInput from '../components/uiverse/NeonInput';
import { Link001 } from '../components/ui/skiper-ui/skiper40';

type Mode = 'login' | 'register';

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

export default function AuthPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const me = useAuth((s) => s.me);
  const initialized = useAuth((s) => s.initialized);
  const initialize = useAuth((s) => s.initialize);
  const setMe = useAuth((s) => s.setMe);

  const initialMode = searchParams.get('mode') === 'register' ? 'register' : 'login';
  const [mode, setMode] = useState<Mode>(initialMode);
  const [form, setForm] = useState({
    identifier: '',
    username: '',
    displayName: '',
    email: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  // Synchronize mode if query parameter changes
  useEffect(() => {
    const qMode = searchParams.get('mode');
    if (qMode === 'register' || qMode === 'login') {
      setMode(qMode);
    }
  }, [searchParams]);

  // Ensure auth state has been checked
  useEffect(() => {
    if (!initialized) {
      initialize();
    }
  }, [initialized, initialize]);

  // If already authenticated as a full registered user, redirect to /app/global
  useEffect(() => {
    if (initialized && me && !me.isGuest) {
      navigate('/app/global', { replace: true });
    }
  }, [initialized, me, navigate]);

  const finish = (newMe: Me, accessToken?: string, refreshToken?: string) => {
    setMe(newMe, accessToken, refreshToken);
    navigate('/app/global');
  };

  const guest = useMutation({
    mutationFn: async () => {
      const res = await api.post('/auth/guest');
      return res.data as { me: Me; accessToken: string; refreshToken: string };
    },
    onSuccess: (data) => finish(data.me, data.accessToken, data.refreshToken),
    onError: (e) => setError(apiError(e)),
  });

  const login = useMutation({
    mutationFn: async () => {
      const res = await api.post('/auth/login', {
        identifier: form.identifier.trim(),
        password: form.password,
      });
      return res.data as { me: Me; accessToken: string; refreshToken: string };
    },
    onSuccess: (data) => finish(data.me, data.accessToken, data.refreshToken),
    onError: (e) => setError(apiError(e)),
  });

  const register = useMutation({
    mutationFn: async () => {
      const res = await api.post('/auth/register', {
        username: form.username.trim(),
        displayName: form.displayName.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      return res.data as { me: Me; accessToken: string; refreshToken: string };
    },
    onSuccess: (data) => finish(data.me, data.accessToken, data.refreshToken),
    onError: (e) => setError(apiError(e)),
  });

  const busy = guest.isPending || login.isPending || register.isPending;

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const ident = form.identifier.trim();
    if (!ident) {
      setError('Please enter your username or email');
      return;
    }
    if (!form.password) {
      setError('Please enter your password');
      return;
    }

    login.mutate();
  };

  const handleRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const u = form.username.trim();
    const d = form.displayName.trim();
    const em = form.email.trim();

    if (!u) {
      setError('Please choose a username');
      return;
    }
    if (u.length < 3 || u.length > 20) {
      setError('Username must be between 3 and 20 characters');
      return;
    }
    if (!USERNAME_REGEX.test(u)) {
      setError('Username can only contain letters, numbers, and underscores');
      return;
    }
    if (!d) {
      setError('Please enter a display name');
      return;
    }
    if (!em || !em.includes('@') || !em.includes('.')) {
      setError('Please enter a valid email address');
      return;
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    register.mutate();
  };

  return (
    <div className="flex-1 min-h-0 text-[var(--wa-text)] relative overflow-hidden">
      <PulseWrapper />

      <div className="absolute inset-0 overflow-y-auto wa-scroll flex items-center justify-center p-4 sm:p-6">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="relative w-full max-w-[420px]">
          <div className="wa-glass-chip border border-[var(--wa-border)] rounded-3xl p-6 sm:p-8 backdrop-blur-xl">
            <div className="text-center mb-6">
              <div className="w-16 h-16 mx-auto mb-3.5 rounded-2xl bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center text-3xl shadow-lg shadow-emerald-950/50">
                🌍
              </div>
              <h1 className="text-2xl font-bold tracking-tight">PulseChat</h1>
              <p className="text-[var(--wa-text-2)] mt-1.5 text-[13.5px]">
                One global world chat. Private 1-to-1 conversations. Real time.
              </p>
            </div>

            {/* Guest notice if already exploring as guest */}
            {me?.isGuest && (
              <div className="mb-5 p-3 rounded-xl bg-teal-500/10 border border-teal-500/25 flex items-start gap-2.5 text-[12.5px] text-teal-200">
                <UserCheck size={18} className="text-teal-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">{me.displayName}</span> (Guest session active).
                  Create an account to save your profile and enable private 1-to-1 messaging!
                </div>
              </div>
            )}

            {/* Toggle login / register */}
            <div className="flex bg-[var(--wa-panel-2)] rounded-xl p-1 mb-5">
              {(['login', 'register'] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`flex-1 py-2 rounded-lg text-[13.5px] font-medium transition cursor-pointer ${
                    mode === m
                      ? 'bg-[var(--wa-green)] text-[#0b141a] shadow-sm'
                      : 'text-[var(--wa-text-2)] hover:text-[var(--wa-text)]'
                  }`}
                  onClick={() => {
                    setError('');
                    setMode(m);
                  }}
                >
                  {m === 'login' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>

            {/* Error banner */}
            {error && (
              <div className="mb-4 p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center gap-2.5 text-[12.5px] text-rose-300">
                <AlertCircle size={16} className="text-rose-400 shrink-0" />
                <span className="flex-1">{error}</span>
              </div>
            )}

            {mode === 'login' ? (
              <form className="space-y-4" onSubmit={handleLoginSubmit}>
                <NeonInput
                  label="Username or email"
                  value={form.identifier}
                  onChange={(e) => setForm({ ...form, identifier: e.target.value })}
                  placeholder="Enter your username or email"
                  autoComplete="username"
                  disabled={busy}
                />
                <NeonInput
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  disabled={busy}
                  rightElement={
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={-1}
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  }
                />
                <GlowButton variant="primary" type="submit" disabled={busy} loading={login.isPending} className="w-full mt-2">
                  {login.isPending ? 'Signing in...' : 'Sign in'}
                </GlowButton>
              </form>
            ) : (
              <form className="space-y-3.5" onSubmit={handleRegisterSubmit}>
                <NeonInput
                  label="Username (unique)"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="Choose a username, e.g. nareshk"
                  autoComplete="off"
                  disabled={busy}
                />
                <NeonInput
                  label="Display name"
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  placeholder="How others will see you"
                  disabled={busy}
                />
                <NeonInput
                  label="Email address"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="you@example.com"
                  autoComplete="email"
                  disabled={busy}
                />
                <NeonInput
                  label="Password (min 8 chars)"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  disabled={busy}
                  rightElement={
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={-1}
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  }
                />
                <GlowButton variant="primary" type="submit" disabled={busy} loading={register.isPending} className="w-full mt-2">
                  {register.isPending ? 'Creating account...' : 'Create account'}
                </GlowButton>
              </form>
            )}

            <div className="flex items-center gap-3 my-5">
              <div className="h-px bg-[var(--wa-border)] flex-1" />
              <span className="text-[11px] uppercase tracking-wider text-[var(--wa-text-2)] font-semibold">or</span>
              <div className="h-px bg-[var(--wa-border)] flex-1" />
            </div>

            {me?.isGuest ? (
              <GlowButton
                className="w-full"
                disabled={busy}
                onClick={() => navigate('/app/global')}
              >
                <ArrowRight size={15} /> Return to Global Chat
              </GlowButton>
            ) : (
              <GlowButton
                className="w-full"
                disabled={busy}
                loading={guest.isPending}
                onClick={() => guest.mutate()}
              >
                <Zap size={15} /> {guest.isPending ? 'Connecting...' : 'Continue as guest'}
              </GlowButton>
            )}

            <p className="text-[11.5px] text-[var(--wa-text-2)] text-center mt-3 flex items-center justify-center gap-1.5">
              <Lock size={12} className="shrink-0" />
              <span>Guests can read & chat in Global Chat. Full account unlocks 1-to-1 DMs.</span>
            </p>
          </div>

          <div className="mt-5 flex items-center justify-center gap-6 text-[12px] text-[var(--wa-text-2)]">
            <span className="flex items-center gap-1.5"><Globe2 size={14} className="text-sky-400" /> 1 Global Chat</span>
            <span className="flex items-center gap-1.5"><MessageCircle size={14} className="text-emerald-400" /> Private 1-to-1</span>
          </div>

          {/* Attribution */}
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
      <div
        className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full blur-3xl opacity-25"
        style={{ background: 'radial-gradient(circle, #14b8a6 0%, transparent 65%)' }}
      />
      <div
        className="absolute -bottom-40 -right-40 w-[500px] h-[500px] rounded-full blur-3xl opacity-20"
        style={{ background: 'radial-gradient(circle, #0d9488 0%, transparent 65%)' }}
      />
    </div>
  );
}
