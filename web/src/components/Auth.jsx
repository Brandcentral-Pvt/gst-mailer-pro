import React, { useState } from 'react';
import { LockKeyhole, LogIn, KeyRound, ShieldCheck, AlertTriangle } from 'lucide-react';
import api from '../lib/api';
import { Spinner } from './ui';

// Logo supplied by the user; bundled locally so the login screen works offline too.
export const LOGO_SOURCE = 'https://brandcentral.in/wp-content/uploads/2024/09/logo.png';

export function BrandLogo({ className = 'h-10 w-10' }) {
  return (
    <img
      src="/logo.png"
      alt="Brand Central"
      className={className}
      onError={(e) => {
        if (!e.currentTarget.src.endsWith(LOGO_SOURCE)) e.currentTarget.src = LOGO_SOURCE;
      }}
    />
  );
}

function PasswordChange({ mustChange, onDone, onCancel }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (next.length < 8) return setError('New password must be at least 8 characters.');
    if (next !== confirm) return setError('The two new passwords do not match.');
    setBusy(true);
    try {
      await api.post('/api/auth/password', { currentPassword: current, newPassword: next });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {mustChange && (
        <div className="flex items-start gap-2 rounded-xl border border-amberish-500/30 bg-amberish-100/70 px-3 py-2.5 text-[12px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>You are using a generated password. Set your own before continuing.</span>
        </div>
      )}
      <label className="block">
        <span className="label">Current password</span>
        <input className="input" type="password" autoComplete="current-password" value={current}
          onChange={(e) => setCurrent(e.target.value)} required />
      </label>
      <label className="block">
        <span className="label">New password</span>
        <input className="input" type="password" autoComplete="new-password" value={next}
          onChange={(e) => setNext(e.target.value)} placeholder="At least 8 characters" required />
      </label>
      <label className="block">
        <span className="label">Confirm new password</span>
        <input className="input" type="password" autoComplete="new-password" value={confirm}
          onChange={(e) => setConfirm(e.target.value)} required />
      </label>
      {error && <p className="rounded-lg bg-rose-100 px-3 py-2 text-[12px] font-semibold text-rose-500">{error}</p>}
      <div className="flex gap-2 pt-1">
        {onCancel && <button type="button" className="btn flex-1" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn btn-primary flex-1" disabled={busy}>
          {busy ? <Spinner /> : <ShieldCheck className="h-4 w-4" />} Update password
        </button>
      </div>
    </form>
  );
}

export function LoginScreen({ onLoggedIn }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api.post('/api/auth/login', { username, password });
      if (res.mustChangePassword) setPending(res);
      else onLoggedIn(res);
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 bg-grid-fade px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="grid h-20 w-20 place-items-center rounded-2xl bg-white p-2 shadow-glow">
            <BrandLogo className="h-full w-full object-contain" />
          </div>
          <h1 className="mt-4 font-display text-2xl font-extrabold tracking-tight text-white">GST Ledger</h1>
          <p className="mt-0.5 text-[12px] font-semibold uppercase tracking-[.14em] text-brand-300">Vendor Mailer Pro</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[.06] p-6 shadow-2xl backdrop-blur-xl">
          {pending ? (
            <>
              <h2 className="mb-4 flex items-center gap-2 font-display text-[15px] font-bold text-white">
                <KeyRound className="h-4 w-4 text-brand-300" /> Choose a new password
              </h2>
              <PasswordChange mustChange onDone={() => onLoggedIn({ ...pending, mustChangePassword: false })} />
            </>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <h2 className="flex items-center gap-2 font-display text-[15px] font-bold text-white">
                <LockKeyhole className="h-4 w-4 text-brand-300" /> Sign in to your workspace
              </h2>
              <label className="block">
                <span className="block mb-1.5 text-[11px] font-semibold uppercase tracking-[.08em] text-brand-200/80">Username</span>
                <input className="input" value={username} onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username" required />
              </label>
              <label className="block">
                <span className="block mb-1.5 text-[11px] font-semibold uppercase tracking-[.08em] text-brand-200/80">Password</span>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password" required />
              </label>
              {error && <p className="rounded-lg bg-rose-100 px-3 py-2 text-[12px] font-semibold text-rose-500">{error}</p>}
              <button type="submit" className="btn btn-primary w-full" disabled={busy}>
                {busy ? <Spinner /> : <LogIn className="h-4 w-4" />} Sign in
              </button>
            </form>
          )}
        </div>
        <p className="mt-5 text-center text-[11px] text-brand-200/60">Private workspace · session expires after 7 days</p>
      </div>
    </div>
  );
}

export function ChangePasswordDialog({ open, onClose }) {
  const [done, setDone] = useState(false);
  React.useEffect(() => { if (open) setDone(false); }, [open]);
  if (!open) return null;
  return (
    <div className="drawer-backdrop z-50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lift" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-[15px] font-bold text-ink-900">
            <KeyRound className="h-4 w-4 text-brand-500" /> Change password
          </h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
        {done ? (
          <div className="flex items-center gap-2 rounded-xl bg-mint-100 px-3 py-3 text-[12.5px] font-semibold text-emerald-700">
            <ShieldCheck className="h-4 w-4" /> Password updated. Other sessions were signed out.
          </div>
        ) : (
          <PasswordChange onDone={() => setDone(true)} />
        )}
      </div>
    </div>
  );
}

export async function logout() {
  try { await api.post('/api/auth/logout'); } catch { /* nothing else to do */ }
  window.dispatchEvent(new CustomEvent('gst:unauthorized'));
}
