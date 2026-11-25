// Vendor-name clustering: exact (case/space/punct), legal-suffix aware, guarded fuzzy.
import { normCol } from './util.js';

const LEGAL_SUFFIX = /\b(private\s+limited|pvt\.?\s*ltd\.?|pvt\.?\s+limited|private\s+ltd\.?|limited|ltd\.?|llp|llc|inc\.?|incorporated|corp\.?|corporation|and\s+co\.?|&\s*co\.?|co\.?)\b/gi;
const STOP = new Set(['m/s', 'ms', 'messrs', 'the', 'and', '&', 'of']);

const baseClean = (name) => String(name || '')
  .normalize('NFKD')
  .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
  .replace(/&/g, ' and ')
  .replace(/\s+/g, ' ')
  .trim();

export const strictKey = (name) => baseClean(name).toLowerCase().replace(/[^a-z0-9]/g, '');

export const suffixKey = (name) => baseClean(name)
  .toLowerCase()
  .replace(LEGAL_SUFFIX, ' ')
  .replace(/\s+/g, ' ')
  .replace(/^[\s.,-]+|[\s.,-]+$/g, '')
  .replace(/[^a-z0-9]/g, '');

export const displayKey = (name) => baseClean(name)
  .toLowerCase()
  .replace(LEGAL_SUFFIX, ' ')
  .split(/[^a-z0-9]+/)
  .filter((t) => t && !STOP.has(t))
  .join(' ');

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i += 1) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

/** Sørensen–Dice coefficient on character bigrams, 0..100 */
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.length < 2 || b.length < 2) return a === b ? 100 : 0;
  const A = bigrams(a); const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) {
    const m = B.get(g);
    if (m) inter += Math.min(n, m);
  }
  const total = (a.length - 1) + (b.length - 1);
  return Math.round((2 * inter / total) * 1000) / 10;
}

function fuzzyOk(a, b) {
  if (!a || !b) return { ok: false, score: 0 };
  if (a === b) return { ok: true, score: 100 };
  const score = similarity(a, b);
  if (score < 88) return { ok: false, score };
  let prefix = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) break;
    prefix += 1;
  }
  const contained = a.includes(b) || b.includes(a);
  if (prefix < 4 && !contained) return { ok: false, score };
  const [short, long] = [a.length, b.length].sort((x, y) => x - y);
  if (!contained && short / long < 0.62) return { ok: false, score };
  return { ok: true, score };
}

class UnionFind {
  constructor() { this.parent = new Map(); }
  add(x) { if (!this.parent.has(x)) this.parent.set(x, x); }
  find(x) {
    this.add(x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    let cur = x;
    while (this.parent.get(cur) !== root) { const next = this.parent.get(cur); this.parent.set(cur, root); cur = next; }
    return root;
  }
  union(a, b) {
    const ra = this.find(a); const rb = this.find(b);
    if (ra === rb) return false;
    this.parent.set(rb, ra);
    return true;
  }
}

/**
 * @param {string[]} rawNames
 * @param {Record<string, number>} rowCounts rawName -> rows
 */
export function buildMapping(rawNames, rowCounts = {}, { fuzzyThreshold = 92 } = {}) {
  const raws = [...new Set(rawNames.filter((r) => String(r || '').trim()))];
  const uf = new UnionFind();
  raws.forEach((r) => uf.add(r));

  // (a) strict key
  const byStrict = new Map();
  raws.forEach((r) => {
    const k = strictKey(r);
    if (!k) return;
    if (!byStrict.has(k)) byStrict.set(k, []);
    byStrict.get(k).push(r);
  });
  byStrict.forEach((group) => group.slice(1).forEach((g) => uf.union(group[0], g)));

  // (b) suffix-stripped key
  const bySuffix = new Map();
  raws.forEach((r) => {
    const k = suffixKey(r);
    if (k.length < 3) return;
    if (!bySuffix.has(k)) bySuffix.set(k, []);
    bySuffix.get(k).push(r);
  });
  bySuffix.forEach((group) => group.slice(1).forEach((g) => uf.union(group[0], g)));

  // (c) guarded fuzzy — mutual best matches only
  const roots = new Map();
  raws.forEach((r) => {
    const root = uf.find(r);
    if (!roots.has(root)) roots.set(root, []);
    roots.get(root).push(r);
  });
  const rootKeys = [...roots.entries()].map(([root, members]) => [root, strictKey(members[0])]).filter(([, k]) => k);
  const best = new Map();
  for (let i = 0; i < rootKeys.length; i += 1) {
    for (let j = i + 1; j < rootKeys.length; j += 1) {
      const [ra, ka] = rootKeys[i];
      const [rb, kb] = rootKeys[j];
      const { ok, score } = fuzzyOk(ka, kb);
      if (!ok || score < fuzzyThreshold) continue;
      if (!best.has(ra) || score > best.get(ra)[1]) best.set(ra, [rb, score]);
      if (!best.has(rb) || score > best.get(rb)[1]) best.set(rb, [ra, score]);
    }
  }
  best.forEach(([partner], root) => {
    const rec = best.get(partner);
    if (rec && rec[0] === root) uf.union(root, partner);
  });

  // canonical pick: most rows, then prettiest casing
  const clusters = new Map();
  raws.forEach((r) => {
    const root = uf.find(r);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(r);
  });

  const mapping = {};
  const meta = {};
  clusters.forEach((members) => {
    const sorted = [...members].sort((a, b) => {
      const ra = rowCounts[a] || 0; const rb = rowCounts[b] || 0;
      if (ra !== rb) return rb - ra;
      const ua = (a.match(/[A-Z]/g) || []).length;
      const ub = (b.match(/[A-Z]/g) || []).length;
      if (ua !== ub) return ub - ua;
      if (a.length !== b.length) return a.length - b.length;
      return a.localeCompare(b);
    });
    const canonical = sorted[0];
    const keys = new Set(members.map(strictKey));
    const sKeys = new Set(members.map(suffixKey));
    let kind = 'exact';
    let score = 100;
    if (keys.size > 1) {
      if (sKeys.size === 1) { kind = 'suffix'; score = 98; } else {
        kind = 'fuzzy';
        score = Math.max(...members.map((m) => similarity(strictKey(members[0]), strictKey(m))));
      }
    }
    members.forEach((m) => { mapping[m] = canonical; });
    meta[canonical] = {
      canonical,
      kind,
      score: Math.round(score * 10) / 10,
      status: kind === 'fuzzy' ? 'review' : 'auto',
      members: sorted.map((m) => ({ raw: m, rows: rowCounts[m] || 0 })),
    };
  });
  return { mapping, meta };
}

/** Apply user edits: merge / split / assign / rename */
export function applyEdits(mappingIn, meta, edits = {}) {
  const mapping = { ...mappingIn };
  (edits.assign ? Object.entries(edits.assign) : []).forEach(([raw, canon]) => {
    if (mapping[raw] !== undefined && String(canon).trim()) mapping[raw] = String(canon).trim();
  });
  (edits.split || []).forEach((raw) => {
    if (mapping[raw] !== undefined && mapping[raw] !== raw) mapping[raw] = raw;
  });
  (edits.rename ? Object.entries(edits.rename) : []).forEach(([oldName, newName]) => {
    const target = String(newName || '').trim();
    if (!target) return;
    Object.keys(mapping).forEach((raw) => { if (mapping[raw] === oldName) mapping[raw] = target; });
  });
  (edits.merge || []).forEach((pair) => {
    if (!Array.isArray(pair) || pair.length !== 2) return;
    const [source, target] = pair.map((x) => String(x).trim());
    if (!source || !target || source === target) return;
    Object.keys(mapping).forEach((raw) => { if (mapping[raw] === source) mapping[raw] = target; });
    if (mapping[source] === source) mapping[source] = target;
  });

  const groups = new Map();
  Object.entries(mapping).forEach(([raw, canon]) => {
    if (!groups.has(canon)) groups.set(canon, []);
    groups.get(canon).push(raw);
  });
  const newMeta = {};
  groups.forEach((members, canon) => {
    const prev = meta[canon] || {};
    newMeta[canon] = {
      canonical: canon,
      kind: prev.kind || 'manual',
      score: prev.score ?? 100,
      status: 'manual',
      members: members.sort((a, b) => b.length - a.length).map((m) => ({ raw: m, rows: 0 })),
    };
  });
  return { mapping, meta: newMeta };
}

/**
 * Suggest potential merges among canonical vendors (helps the review UI).
 * Returns pairs [{ a, b, score }] sorted desc, excluding already-merged pairs.
 */
export function suggestMerges(canonicals, mapping, limit = 25) {
  const keys = canonicals.map((c) => [c, strictKey(c)]);
  const out = [];
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      const [ca, ka] = keys[i];
      const [cb, kb] = keys[j];
      if (!ka || !kb) continue;
      const score = similarity(ka, kb);
      if (score < 80) continue;
      const samePrefix = ka.slice(0, 4) === kb.slice(0, 4);
      const contained = ka.includes(kb) || kb.includes(ka);
      if (score < 88 && !(samePrefix && contained)) continue;
      out.push({ a: ca, b: cb, score, sameGroup: mapping[ca] === mapping[cb] });
    }
  }
  return out.sort((x, y) => y.score - x.score).slice(0, limit);
}

export { normCol };
