import React, { useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard, UploadCloud, GitMerge, AtSign, Send, Settings2, Database, Mail,
  Sparkles, CircleDot, ChevronRight, ChevronDown, LifeBuoy, FileSpreadsheet, KeyRound, LogOut, Trash2,
} from 'lucide-react';
import { cls, fmtInt, compactINR, initials, avatarGradient } from '../lib/format';
import { BrandLogo } from './Auth';
import { FlowSteps } from './Flow';

const NAV = [
  { key: 'dashboard', label: 'Overview', short: 'Home', icon: LayoutDashboard },
  { key: 'upload', label: 'Import workbook', short: 'Import', icon: UploadCloud },
  { key: 'matching', label: 'Vendor matching', short: 'Match', icon: GitMerge },
  { key: 'mapping', label: 'Mail ID mapping', short: 'Mail IDs', icon: AtSign },
  { key: 'campaign', label: 'Preview & send', short: 'Send', icon: Send },
];

function transportStatus(settings) {
  const smtp = settings?.smtp || {};
  const gmail = settings?.gmail || {};
  const mode = settings?.deliveryMode === 'gmail' ? 'gmail' : 'smtp';
  const ready = mode === 'gmail' ? Boolean(gmail.clientId && gmail.clientSecret && gmail.refreshToken) : Boolean(smtp.configured);
  return {
    label: mode === 'gmail' ? 'Gmail API' : 'SMTP',
    ready,
    title: mode === 'gmail'
      ? (ready ? `Gmail API: ${gmail.accountEmail || 'connected'}` : 'Gmail API not connected')
      : (ready ? `SMTP: ${smtp.username}` : 'SMTP not configured'),
  };
}

export default function Shell({ route, setRoute, state, children, onSettings, user, onChangePassword, onLogout, onRemoveWorkbook, flowDone }) {
  const { stats, loaded } = state;
  const mapped = (state.vendors || []).filter((v) => v.recipients?.length).length;
  const tx = transportStatus(state.settings);

  return (
    <div className="flex min-h-screen bg-ink-50">
      {/* ---------------- sidebar ---------------- */}
      <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col bg-ink-950 bg-brand-sheen lg:flex">
        <div className="flex items-center gap-3 px-5 pb-5 pt-6">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white p-1.5 ring-1 ring-white/15 backdrop-blur">
            <BrandLogo className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0">
            <p className="font-display text-[15px] font-extrabold tracking-tight text-white">GST Ledger</p>
            <p className="truncate text-[11px] text-brand-200/80">Vendor Mailer Pro</p>
          </div>
        </div>

        <nav className="space-y-1 px-3">
          {NAV.map(({ key, label, icon: Icon }) => {
            const active = route === key;
            return (
              <button key={key} onClick={() => setRoute(key)} aria-current={active ? 'page' : undefined}
                className={cls('nav-item w-full', active && 'nav-item-active')}>
                <span className={cls('grid h-7 w-7 place-items-center rounded-lg bg-white/5', active && 'bg-white/15')}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="flex-1 text-left">{label}</span>
                <span className={cls('nav-dot h-1.5 w-1.5 rounded-full bg-white/20', active && 'bg-brand-300')} />
              </button>
            );
          })}
        </nav>

        <div className="mx-3 mt-5 rounded-2xl border border-white/10 bg-white/5 p-3.5 backdrop-blur">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.08em] text-brand-200/80">
            <Database className="h-3.5 w-3.5" /> Dataset
          </div>
          {loaded ? (
            <>
              <p className="mt-2 truncate text-[12.5px] font-semibold text-white" title={stats?.filename}>{stats?.filename}</p>
              <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px] text-brand-100/80">
                <div className="rounded-lg bg-white/5 px-2 py-1.5">
                  <span className="block text-[10px] uppercase tracking-wide text-brand-200/70">Vendors</span>
                  <span className="text-[13px] font-bold text-white">{fmtInt(stats?.vendorCount)}</span>
                </div>
                <div className="rounded-lg bg-white/5 px-2 py-1.5">
                  <span className="block text-[10px] uppercase tracking-wide text-brand-200/70">Rows</span>
                  <span className="text-[13px] font-bold text-white">{fmtInt(stats?.totalRows)}</span>
                </div>
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-1.5">
                <button onClick={() => setRoute('upload')} className="flex items-center justify-center gap-1.5 rounded-lg bg-white/10 px-2 py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/15">
                  <FileSpreadsheet className="h-3.5 w-3.5" /> Replace
                </button>
                <button onClick={onRemoveWorkbook} className="flex items-center justify-center gap-1.5 rounded-lg border border-rose-300/25 bg-rose-400/10 px-2 py-1.5 text-[11px] font-semibold text-rose-100 transition hover:bg-rose-400/20">
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              </div>
            </>
          ) : (
            <button onClick={() => setRoute('upload')} className="mt-2 w-full rounded-lg bg-brand-400/20 px-2 py-2 text-[11.5px] font-semibold text-brand-100 transition hover:bg-brand-400/30">
              Import your first workbook
            </button>
          )}
        </div>

        <div className="mt-auto space-y-1 px-3 pb-4">
          <div className="mx-1 mb-2 rounded-xl border border-white/10 bg-white/[.03] p-3">
            <div className="flex items-center justify-between text-[11px] text-brand-100/80">
              <span className="inline-flex items-center gap-1.5"><AtSign className="h-3.5 w-3.5" /> Mail IDs</span>
              <span className="font-bold text-white">{fmtInt(mapped)}/{fmtInt(state.vendors?.length || 0)}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-brand-300 to-mint-500"
                style={{ width: `${state.vendors?.length ? (mapped / state.vendors.length) * 100 : 0}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-brand-100/80">
              <span className="inline-flex items-center gap-1.5"><CircleDot className={cls('h-3.5 w-3.5', tx.ready ? 'text-mint-500' : 'text-amberish-500')} /> {tx.label}</span>
              <span className={cls('font-semibold', tx.ready ? 'text-mint-500' : 'text-amberish-500')}>{tx.ready ? 'Connected' : 'Not set'}</span>
            </div>
          </div>
          <button onClick={onSettings} className="nav-item w-full">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/5"><Settings2 className="h-4 w-4" /></span>
            <span className="flex-1 text-left">Settings</span>
            <ChevronRight className="h-3.5 w-3.5 text-white/30" />
          </button>
          <button onClick={onChangePassword} className="nav-item w-full">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/5"><KeyRound className="h-4 w-4" /></span>
            <span className="flex-1 text-left">Change password</span>
          </button>
          <button onClick={onLogout} className="nav-item w-full">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/5"><LogOut className="h-4 w-4" /></span>
            <span className="flex-1 text-left">Sign out</span>
          </button>
          <div className="flex items-center gap-2 px-3 py-2 text-[10.5px] text-brand-200/60">
            <LifeBuoy className="h-3.5 w-3.5" />
            <span>All rows from both tabs, always</span>
          </div>
        </div>
      </aside>

      {/* ---------------- main ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar route={route} state={state} onSettings={onSettings} setRoute={setRoute}
          user={user} onChangePassword={onChangePassword} onLogout={onLogout}
          onRemoveWorkbook={onRemoveWorkbook} />
        <div className="border-b border-ink-100/80 bg-white/70">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-2 sm:px-6">
            <FlowSteps state={state} route={route} setRoute={setRoute} done={flowDone} />
          </div>
        </div>
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-28 pt-5 sm:px-6 lg:pb-16">{children}</main>
        <MobileNav route={route} setRoute={setRoute} />
      </div>
    </div>
  );
}

function TopBar({ route, state, onSettings, setRoute, user, onChangePassword, onLogout, onRemoveWorkbook }) {
  const titles = {
    dashboard: ['Overview', 'Reconciliation health at a glance'],
    upload: ['Import workbook', 'Drop a 2-tab GST workbook — vendors are extracted automatically'],
    matching: ['Vendor matching', 'Review merged names, resolve fuzzy pairs, split mistakes'],
    mapping: ['Mail ID mapping', 'Vendor Name ↔ Mail ID, exactly one relation per vendor'],
    campaign: ['Preview & send', 'Summary email + full data attachment, per vendor'],
  };
  const [title, sub] = titles[route] || titles.dashboard;
  const tx = transportStatus(state.settings);
  const mapped = (state.vendors || []).filter((v) => v.recipients?.length).length;

  return (
    <header className="sticky top-0 z-30 border-b border-ink-100/80 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-ink-300">
            <span>Workspace</span><ChevronRight className="h-3 w-3" /><span className="text-ink-500">{title}</span>
          </div>
          <h1 className="truncate font-display text-lg font-extrabold tracking-tight text-ink-900">{title}</h1>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <div className="flex items-center gap-2 rounded-xl border border-ink-100 bg-white px-3 py-1.5 text-[11.5px] font-semibold text-ink-600 shadow-sm">
            <Sparkles className="h-3.5 w-3.5 text-brand-500" />
            {state.loaded ? `${fmtInt(state.stats?.vendorCount)} vendors · ${compactINR((state.vendors || []).reduce((a, v) => a + Math.abs(v.gst || 0), 0))} GST` : 'No dataset'}
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-ink-100 bg-white px-3 py-1.5 text-[11.5px] font-semibold text-ink-600 shadow-sm">
            <Mail className="h-3.5 w-3.5 text-brand-500" />
            {fmtInt(mapped)} email-ready
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className={cls('pill', tx.ready ? 'pill-green' : 'pill-amber')} title={tx.title}>
            <span className={cls('h-1.5 w-1.5 rounded-full', tx.ready ? 'bg-emerald-500' : 'bg-amber-500')} />
            {tx.ready ? `${tx.label} ready` : `${tx.label} setup`}
          </span>
          <AccountMenu
            user={user}
            state={state}
            onSettings={onSettings}
            onChangePassword={onChangePassword}
            onLogout={onLogout}
            onRemoveWorkbook={onRemoveWorkbook}
          />
          <button className="btn btn-primary btn-sm" onClick={() => setRoute('campaign')}>
            <Send className="h-3.5 w-3.5" /> Send
          </button>
        </div>
      </div>
      <div className={cls('h-[2px] bg-brand-line transition-all', state.loaded ? 'opacity-100' : 'opacity-30')} />
    </header>
  );
}

function AccountMenu({ user, state, onSettings, onChangePassword, onLogout, onRemoveWorkbook }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const name = user?.username || 'admin';

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const run = (fn) => () => { setOpen(false); fn?.(); };

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-2 py-1.5 text-[12px] font-semibold text-ink-600 shadow-sm transition hover:bg-ink-50">
        <span className={cls('grid h-6 w-6 place-items-center rounded-lg bg-gradient-to-br text-[10px] font-extrabold text-white', avatarGradient(name))}>
          {initials(name) || 'A'}
        </span>
        <span className="hidden sm:inline">{name}</span>
        <ChevronDown className={cls('h-3.5 w-3.5 text-ink-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-56 rounded-xl border border-ink-100 bg-white p-1.5 shadow-lift">
          <div className="border-b border-ink-100 px-2.5 py-2">
            <p className="text-[12px] font-bold text-ink-900">{name}</p>
            <p className="text-[10.5px] text-ink-400">Signed in · session lasts 7 days</p>
          </div>
          <button role="menuitem" onClick={run(onSettings)} className="menu-item mt-1">
            <Settings2 className="h-3.5 w-3.5 text-ink-400" /> Settings
          </button>
          <button role="menuitem" onClick={run(onChangePassword)} className="menu-item">
            <KeyRound className="h-3.5 w-3.5 text-ink-400" /> Change password
          </button>
          {state?.loaded && (
            <button role="menuitem" onClick={run(onRemoveWorkbook)} className="menu-item !text-rose-600">
              <Trash2 className="h-3.5 w-3.5" /> Remove workbook
            </button>
          )}
          <div className="my-1 h-px bg-ink-100" />
          <button role="menuitem" onClick={run(onLogout)} className="menu-item !text-rose-600">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function MobileNav({ route, setRoute }) {
  return (
    <nav aria-label="Main navigation"
      className="fixed bottom-0 left-0 right-0 z-30 border-t border-ink-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      <div className="grid grid-cols-5">
        {NAV.map(({ key, label, short, icon: Icon }) => {
          const active = route === key;
          return (
            <button key={key} onClick={() => setRoute(key)} aria-current={active ? 'page' : undefined}
              aria-label={label}
              className={cls(
                'flex min-h-[58px] flex-col items-center justify-center gap-1 px-1 text-[10px] font-semibold transition',
                active ? 'text-brand-700' : 'text-ink-400',
              )}>
              <span className={cls('grid h-7 w-7 place-items-center rounded-lg', active && 'bg-brand-50')}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="max-w-full truncate">{short || label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
