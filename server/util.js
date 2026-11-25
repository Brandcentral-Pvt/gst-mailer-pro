// Shared formatting / parsing helpers for Indian GST data
export const INR_RE = /[₹$,\s]/g;

export function formatCell(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    const d = String(v.getDate()).padStart(2, '0');
    const m = v.toLocaleString('en-GB', { month: 'short' });
    return `${d}-${m}-${v.getFullYear()}`;
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  }
  return String(v).trim();
}

/** "₹2,495.06" -> 2495.06 ; "(₹53.62)" -> -53.62 ; "-" -> 0 ; "" -> null */
export function parseINR(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = String(raw).trim();
  if (!s) return null;
  if (/^(-|--|—|NIL|nil|NA|N\/A)$/.test(s)) return 0;

  let neg = false;
  if (s.startsWith('(') && s.endsWith(')')) { neg = true; s = s.slice(1, -1).trim(); }
  if (/^[₹$\s]*-/.test(s) || s.endsWith('-')) neg = true;

  s = s.replace(INR_RE, '').replace(/[()]/g, '');
  s = s.replace(/^\+/, '').replace(/-+$/, '');
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

/** 1234567.8 -> "₹12,34,567.80" (Indian grouping, negatives as -₹) */
export function formatINR(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '₹0.00';
  const neg = n < -0.0001;
  const [intPart, decPart] = Math.abs(n).toFixed(2).split('.');
  let grouped = intPart;
  if (intPart.length > 3) {
    const last3 = intPart.slice(-3);
    let rest = intPart.slice(0, -3);
    const groups = [];
    while (rest.length > 2) { groups.unshift(rest.slice(-2)); rest = rest.slice(0, -2); }
    if (rest) groups.unshift(rest);
    grouped = `${groups.join(',')},${last3}`;
  }
  return `${neg ? '-₹' : '₹'}${grouped}.${decPart}`;
}

export function fmtInt(n) {
  return new Intl.NumberFormat('en-IN').format(Number(n) || 0);
}

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

export function parseEmails(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter((x) => x.includes('@'));
}

export function slug(name, max = 70) {
  const s = String(name || 'VENDOR')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return (s || 'VENDOR').slice(0, max);
}

export function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Loose key for mapping vendor names to stored recipient records. */
export function strictKeyLoose(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function normCol(c) {
  return String(c).toLowerCase().replace(/\(₹\)|\(rs\.?\)|rs\.?/g, '').trim();
}
