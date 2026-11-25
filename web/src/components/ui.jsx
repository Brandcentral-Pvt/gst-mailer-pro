import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, CheckCircle2, AlertTriangle, Info, Loader2 } from 'lucide-react';
import { cls } from '../lib/format';
import { avatarGradient, initials } from '../lib/format';

export function Card({ className, children, ...rest }) {
  return <div className={cls('card', className)} {...rest}>{children}</div>;
}

export function Badge({ tone = 'gray', children, className, dot }) {
  const map = {
    green: 'pill-green', amber: 'pill-amber', red: 'pill-red', blue: 'pill-blue',
    teal: 'pill-teal', gray: 'pill-gray',
  };
  return (
    <span className={cls('pill', map[tone] || map.gray, className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}

export function Avatar({ name = '', size = 'md', className }) {
  const sizes = { sm: 'h-7 w-7 text-[10px]', md: 'h-9 w-9 text-[11px]', lg: 'h-11 w-11 text-[13px]' };
  return (
    <div className={cls('grid shrink-0 place-items-center rounded-xl bg-gradient-to-br font-bold text-white shadow-sm',
      avatarGradient(name), sizes[size], className)}>
      {initials(name) || '?'}
    </div>
  );
}

export function Spinner({ className }) {
  return <Loader2 className={cls('h-4 w-4 animate-spin', className)} />;
}

export function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {Icon && (
        <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-ink-100 text-ink-400">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <p className="text-sm font-semibold text-ink-700">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-ink-400">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Drawer({ open, onClose, title, subtitle, children, footer, width = 'max-w-xl' }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    if (open) {
      document.addEventListener('keydown', onKey);
      document.body.style.overflow = 'hidden';
    }
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="drawer-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className={cls('fixed right-0 top-0 z-50 flex h-full w-full flex-col bg-white shadow-lift', width)}
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          >
            <div className="flex items-start gap-3 border-b border-ink-100 px-5 py-4">
              <div className="min-w-0">
                <h2 className="font-display text-[15px] font-bold text-ink-900">{title}</h2>
                {subtitle && <p className="mt-0.5 text-xs text-ink-400">{subtitle}</p>}
              </div>
              <button className="btn btn-ghost btn-sm ml-auto !p-2" onClick={onClose} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex items-center justify-end gap-2 border-t border-ink-100 bg-ink-50/60 px-5 py-3">{footer}</div>}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'max-w-lg' }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4">
          <motion.div className="absolute inset-0 bg-ink-950/50 backdrop-blur-[2px]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className={cls('relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-lift', size)}
            initial={{ opacity: 0, y: 14, scale: .98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: .98 }}
            transition={{ duration: .18 }}
          >
            <div className="flex items-start gap-3 border-b border-ink-100 px-5 py-4">
              <div className="min-w-0">
                <h2 className="font-display text-[15px] font-bold text-ink-900">{title}</h2>
                {subtitle && <p className="mt-0.5 text-xs text-ink-400">{subtitle}</p>}
              </div>
              <button className="btn btn-ghost btn-sm ml-auto !p-2" onClick={onClose} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex items-center justify-end gap-2 border-t border-ink-100 bg-ink-50/60 px-5 py-3">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

const TOAST_ICONS = { ok: CheckCircle2, err: AlertTriangle, info: Info };
const TOAST_TONES = {
  ok: 'border-mint-500/40 text-emerald-700 bg-mint-100/60',
  err: 'border-rose-500/40 text-rose-600 bg-rose-100/60',
  info: 'border-brand-400/40 text-brand-700 bg-brand-100/60',
};

export function Toasts({ items, dismiss }) {
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-full max-w-sm flex-col gap-2">
      <AnimatePresence>
        {items.map((t) => {
          const Icon = TOAST_ICONS[t.tone] || Info;
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 12, scale: .97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24 }}
              className="pointer-events-auto flex items-start gap-3 rounded-xl border border-ink-100 bg-white p-3 shadow-lift"
            >
              <span className={cls('grid h-8 w-8 shrink-0 place-items-center rounded-lg border', TOAST_TONES[t.tone] || TOAST_TONES.info)}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold text-ink-900">{t.title}</p>
                {t.body && <p className="mt-0.5 line-clamp-3 text-[11.5px] leading-relaxed text-ink-500">{t.body}</p>}
              </div>
              <button onClick={() => dismiss(t.id)} className="text-ink-300 transition hover:text-ink-600">
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function Progress({ value = 0, tone = 'brand', size = 'md' }) {
  const tones = {
    brand: 'from-brand-400 to-brand-600',
    green: 'from-emerald-400 to-emerald-600',
    red: 'from-rose-400 to-rose-600',
  };
  return (
    <div className={cls('w-full overflow-hidden rounded-full bg-ink-100', size === 'sm' ? 'h-1.5' : 'h-2.5')}>
      <div
        className={cls('h-full rounded-full bg-gradient-to-r transition-all duration-500', tones[tone] || tones.brand)}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-xl bg-ink-100/80 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cls(
            'rounded-lg px-3 py-1.5 text-[12px] font-semibold transition',
            value === o.value ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800',
          )}
        >
          {o.label}
          {o.count !== undefined && <span className="ml-1.5 text-[10.5px] font-bold text-ink-400">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
