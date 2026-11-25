export const nf = new Intl.NumberFormat('en-IN');

export const fmtInt = (n) => nf.format(Number(n) || 0);

export function fmtINR(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '₹0.00';
  const neg = n < -0.0001;
  const [i, d] = Math.abs(n).toFixed(2).split('.');
  let g = i;
  if (i.length > 3) {
    const last3 = i.slice(-3);
    let rest = i.slice(0, -3);
    const groups = [];
    while (rest.length > 2) { groups.unshift(rest.slice(-2)); rest = rest.slice(0, -2); }
    if (rest) groups.unshift(rest);
    g = `${groups.join(',')},${last3}`;
  }
  return `${neg ? '-₹' : '₹'}${g}.${d}`;
}

export function compactINR(amount) {
  const n = Number(amount) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)} K`;
  return fmtINR(n);
}

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

export function initials(name = '') {
  return String(name).trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
}

const AVATAR_GRADIENTS = [
  'from-brand-500 to-brand-700',
  'from-emerald-500 to-teal-700',
  'from-indigo-500 to-blue-700',
  'from-amber-500 to-orange-600',
  'from-fuchsia-500 to-purple-700',
  'from-sky-500 to-cyan-700',
  'from-rose-500 to-pink-700',
];

export function avatarGradient(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) % 997;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}

export function cls(...args) {
  return args.filter(Boolean).join(' ');
}

export function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
