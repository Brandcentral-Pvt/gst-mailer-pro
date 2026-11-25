// In-memory dataset: parsed tabs, vendor mapping, aggregates, and job state.
import fs from 'fs';
import { buildMapping, applyEdits, suggestMerges } from './matcher.js';
import { readSheet, tableFrom, detectHeaderRow, detectColumns, sumTotals, gstOf, vendorFileName } from './xlsx.js';
import { formatINR, parseINR } from './util.js';

const state = {
  loaded: false,
  fileId: '',
  filename: '',
  loadedAt: '',
  tabs: [],            // [{ key, label, sheetName, headers, columns, rows, byVendor: Map }]
  mapping: {},
  meta: {},
  vendors: new Map(),  // canonical -> aggregate
  rawCounts: {},
};

export function isLoaded() { return state.loaded; }

export function getState() { return state; }

function dateRangeOf(rows, col) {
  if (!col) return '—';
  let min = null; let max = null;
  const parse = (s) => {
    const m = String(s).match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (m) {
      const d = Number(m[1]); const mo = Number(m[2]); let y = Number(m[3]);
      if (y < 100) y += 2000;
      const dt = new Date(y, mo - 1, d);
      return Number.isNaN(dt.getTime()) ? null : dt;
    }
    const dt = new Date(s);
    return Number.isNaN(dt.getTime()) ? null : dt;
  };
  rows.forEach((r) => {
    const d = parse(r[col]);
    if (!d) return;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  });
  if (!min || !max) return '—';
  const f = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
  return `${f(min)} – ${f(max)}`;
}

export async function loadWorkbook({ filePath, filename, fileId, tabConfigs }) {
  const tabs = [];
  const rawCounts = {};

  for (let i = 0; i < Math.min(tabConfigs.length, 2); i += 1) {
    const cfg = tabConfigs[i];
    const sheet = await readSheet(filePath, cfg.sheetName);
    const headerIdx = Number.isInteger(cfg.headerRow) ? cfg.headerRow : detectHeaderRow(sheet.rows);
    // header row must exist; if a sheet has extra junk above, trim
    const table = tableFrom(sheet.rows, headerIdx);
    const detected = detectColumns(table.headers);
    const columns = { ...detected };
    // an explicitly chosen column wins — unless it looks like a status/amount column,
    // in which case the detected supplier/vendor column is used instead
    const explicit = cfg.vendorCol && table.headers.includes(cfg.vendorCol) ? cfg.vendorCol : null;
    const looksLikeStatus = explicit && /status|period|section|date|gstin|invoice|remark|type|amount|value|cess|igst|cgst|sgst/i.test(explicit);
    columns.vendorCol = explicit && !looksLikeStatus ? explicit : (detected.vendorCol || explicit);

    const vcol = columns.vendorCol;
    if (!vcol) throw new Error(`Could not detect a Vendor Name column in "${cfg.sheetName}"`);

    const rows = table.rows.filter((r) => String(r[vcol] || '').trim() !== '');
    const byVendor = new Map();
    rows.forEach((r) => {
      const raw = String(r[vcol] || '').replace(/\s+/g, ' ').trim();
      if (!raw) return;
      r[vcol] = raw;
      if (!byVendor.has(raw)) byVendor.set(raw, []);
      byVendor.get(raw).push(r);
      rawCounts[raw] = (rawCounts[raw] || 0) + 1;
    });

    tabs.push({
      key: i === 0 ? 'tab1' : 'tab2',
      label: (cfg.label || cfg.sheetName || `Sheet ${i + 1}`).trim(),
      sheetName: cfg.sheetName || sheet.name,
      headerRow: headerIdx,
      headers: table.headers,
      originalHeaders: table.originalHeaders || table.headers,
      sourceCols: table.sourceCols,
      rawHeaderRow: table.rawHeaderRow,
      sourceWidth: table.sourceWidth,
      columns,
      rows,
      byVendor,
    });
  }

  if (tabs.length === 1) {
    const clone = { ...tabs[0], key: 'tab2', label: `${tabs[0].label} (2)` };
    const byVendor2 = new Map();
    tabs[0].byVendor.forEach((list, k) => {
      byVendor2.set(k, list);
      rawCounts[k] = (rawCounts[k] || 0);
    });
    tabs.push({ ...clone, byVendor: byVendor2 });
  }

  const { mapping, meta } = buildMapping(Object.keys(rawCounts), rawCounts);

  state.loaded = true;
  state.fileId = fileId;
  state.filename = filename;
  state.loadedAt = new Date().toISOString();
  state.tabs = tabs;
  state.mapping = mapping;
  state.meta = meta;
  state.rawCounts = rawCounts;
  rebuildAggregates();
  return getStats();
}

export function setMapping(mapping, meta) {
  state.mapping = mapping;
  state.meta = meta;
  rebuildAggregates();
}

export function editMapping(edits) {
  const { mapping, meta } = applyEdits(state.mapping, state.meta, edits);
  setMapping(mapping, meta);
}

export function rematchAll(threshold = 92) {
  const { mapping, meta } = buildMapping(Object.keys(state.rawCounts), state.rawCounts, { fuzzyThreshold: threshold });
  setMapping(mapping, meta);
  return { mapping, meta };
}

export function rebuildAggregates() {
  const vendors = new Map();
  const mapping = state.mapping;

  const ensure = (canon) => {
    if (!vendors.has(canon)) {
      vendors.set(canon, {
        vendor: canon,
        rows: 0,
        tabRows: { tab1: 0, tab2: 0 },
        totals: { tab1: {}, tab2: {} },
        statusCounts: {},
        statusByTab: { tab1: {}, tab2: {} },
        gstins: [],
        dateRange: '—',
        aliases: [],
      });
    }
    return vendors.get(canon);
  };

  Object.keys(mapping).forEach((raw) => ensure(mapping[raw]));

  state.tabs.forEach((tab) => {
    const { columns } = tab;
    const dateRanges = new Map();
    const perVendorRows = new Map();

    tab.byVendor.forEach((rows, rawName) => {
      const canon = mapping[rawName] || rawName;
      const v = ensure(canon);
      v.rows += rows.length;
      v.tabRows[tab.key] += rows.length;
      if (!v.aliases.includes(rawName)) v.aliases.push(rawName);
      if (!perVendorRows.has(canon)) perVendorRows.set(canon, rows);

      // totals
      const t = sumTotals(rows, columns.amountCols);
      const acc = v.totals[tab.key];
      Object.entries(t).forEach(([k, val]) => { acc[k] = Math.round(((acc[k] || 0) + val) * 100) / 100; });

      // status
      if (columns.statusCol) {
        rows.forEach((r) => {
          const s = String(r[columns.statusCol] || '').trim() || '—';
          v.statusCounts[s] = (v.statusCounts[s] || 0) + 1;
          v.statusByTab[tab.key][s] = (v.statusByTab[tab.key][s] || 0) + 1;
        });
      }
      // gstin
      if (columns.gstinCol) {
        rows.forEach((r) => {
          const g = String(r[columns.gstinCol] || '').trim();
          if (g && !v.gstins.includes(g)) v.gstins.push(g);
        });
      }
      if (columns.dateCol) dateRanges.set(canon, rows);
    });

    perVendorRows.forEach((rows, canon) => {
      const v = ensure(canon);
      const rng = dateRangeOf(rows, columns.dateCol);
      if (rng !== '—' && v.dateRange === '—') v.dateRange = rng;
    });
  });

  vendors.forEach((v) => {
    v.gst = gstOf(v.totals.tab1) + gstOf(v.totals.tab2);
    v.gst = Math.round(v.gst * 100) / 100;
    v.tabGst = { tab1: gstOf(v.totals.tab1), tab2: gstOf(v.totals.tab2) };
    v.aliases.sort();
  });

  state.vendors = vendors;
}

export function vendorRows(canon, tabIndex) {
  const tab = state.tabs[tabIndex];
  const out = [];
  tab.byVendor.forEach((rows, rawName) => {
    if ((state.mapping[rawName] || rawName) === canon) out.push(...rows);
  });
  // name-variant groups are separate lists; re-sort so rows keep the sheet's own order
  out.sort((a, b) => (a.__row ?? 0) - (b.__row ?? 0));
  return out;
}

export function vendorSummary(canon, tabIndex) {
  const tab = state.tabs[tabIndex];
  const rows = vendorRows(canon, tabIndex);
  const totals = sumTotals(rows, tab.columns.amountCols);
  const statusCounts = {};
  if (tab.columns.statusCol) {
    rows.forEach((r) => {
      const s = String(r[tab.columns.statusCol] || '').trim() || '—';
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    });
  }
  const norm = (totalsObj, key) => {
    const k = Object.keys(totalsObj).find((x) => x.toLowerCase().replace(/\(₹\)/, '').trim() === key);
    return k ? totalsObj[k] : 0;
  };
  return {
    label: tab.label,
    key: tab.key,
    rows: rows.length,
    totals,
    cgst: norm(totals, 'cgst'),
    sgst: norm(totals, 'sgst'),
    igst: norm(totals, 'igst'),
    totalGst: gstOf(totals),
    statusCounts,
    amountCols: tab.columns.amountCols,
    headers: tab.headers,
  };
}

export function getVendorList() {
  const list = [...state.vendors.values()].map((v) => {
    const meta = state.meta[v.vendor] || {};
    return {
      vendor: v.vendor,
      rows: v.rows,
      tab1Rows: v.tabRows.tab1,
      tab2Rows: v.tabRows.tab2,
      gst: v.gst,
      gstFormatted: formatINR(v.gst),
      tabGst: v.tabGst,
      statusCounts: v.statusCounts,
      gstins: v.gstins.slice(0, 6),
      dateRange: v.dateRange,
      aliases: v.aliases,
      match: {
        kind: meta.kind || 'exact',
        score: meta.score ?? 100,
        status: meta.status || 'auto',
        variantCount: v.aliases.length,
      },
    };
  });
  return list.sort((a, b) => b.rows - a.rows || a.vendor.localeCompare(b.vendor));
}

export function getStats() {
  return {
    fileId: state.fileId,
    filename: state.filename,
    loadedAt: state.loadedAt,
    totalRows: state.tabs.reduce((a, t) => a + t.rows.length, 0),
    vendorCount: state.vendors.size,
    rawNameCount: Object.keys(state.mapping).length,
    tabs: state.tabs.map((t) => ({
      key: t.key,
      label: t.label,
      sheetName: t.sheetName,
      rows: t.rows.length,
      headers: t.headers,
      headerRow: t.headerRow,
      vendorCol: t.columns.vendorCol,
      gstinCol: t.columns.gstinCol,
      statusCol: t.columns.statusCol,
      dateCol: t.columns.dateCol,
      amountCols: t.columns.amountCols,
    })),
  };
}

export function getSuggestions() {
  const canonicals = [...state.vendors.keys()];
  return suggestMerges(canonicals, state.mapping, 30);
}

export function buildSummaryFor(canon) {
  const v = state.vendors.get(canon);
  if (!v) return null;
  const tabs = [0, 1].map((i) => vendorSummary(canon, i));
  const totalGst = Math.round((tabs[0].totalGst + tabs[1].totalGst) * 100) / 100;
  return {
    vendor: canon,
    tabs,
    totalRows: v.rows,
    totalGst,
    cgst: Math.round((tabs[0].cgst + tabs[1].cgst) * 100) / 100,
    sgst: Math.round((tabs[0].sgst + tabs[1].sgst) * 100) / 100,
    igst: Math.round((tabs[0].igst + tabs[1].igst) * 100) / 100,
    gstins: v.gstins,
    statusCounts: v.statusCounts,
    statusByTab: v.statusByTab,
    dateRange: v.dateRange,
    aliases: v.aliases,
    rowSplit: v.tabRows,
    // actual transaction rows for the email body (first N rows of each sheet)
    rowTables: [0, 1].map((i) => rowPreview(canon, i, 100)).filter(Boolean),
  };
}

/**
 * Build the payload used to render a vendor attachment.
 * NOTE: large vendors (10k+ rows) are expensive to serialise; only used for writing.
 */
export function vendorTabPayloads(canon) {
  return state.tabs.map((tab, i) => ({
    label: tab.label,
    headers: tab.headers,
    originalHeaders: tab.originalHeaders || tab.headers,
    sourceCols: tab.sourceCols,
    rawHeaderRow: tab.rawHeaderRow,
    sourceWidth: tab.sourceWidth,
    amountCols: tab.columns.amountCols,
    rows: vendorRows(canon, i),
  }));
}

export function attachmentPathFor(dir, canon) {
  return `${dir}/${vendorFileName(canon)}`;
}

export function fileSizeSafe(p) {
  try { return fs.statSync(p).size; } catch { return 0; }
}

export { formatINR, parseINR };

// ---------------------------------------------------------------------------
// Transaction-level row preview for the email body
// ---------------------------------------------------------------------------
/**
 * Rows for one tab, reduced to the columns a human wants to read:
 * date, invoice, document/transaction details and the tax amounts.
 * Returns { headers, rows, total } where `total` is the unfiltered row count.
 */
export function rowPreview(canon, tabIndex, limit = 100) {
  const tab = state.tabs[tabIndex];
  if (!tab) return null;
  const all = vendorRows(canon, tabIndex);
  const empty = { label: tab.label, headers: [], rows: [], total: 0, shown: 0, cols: [], kinds: [] };
  if (!all.length) return empty;

  // EVERY column from the sheet, in the sheet's own order — nothing curated, nothing dropped
  const pick = tab.headers;
  const rows = all.slice(0, limit).map((r) => pick.map((c) => r[c] ?? ''));

  // per-column kind, so the mail can size and align each one sensibly
  const amountSet = new Set(tab.columns.amountCols || []);
  const kinds = pick.map((h, ci) => {
    if (amountSet.has(h)) return 'money';
    if (h === tab.columns.dateCol) return 'date';
    if (h === tab.columns.statusCol) return 'status';
    const vals = rows.map((r) => r[ci]).filter((v) => v !== '' && v !== null && v !== undefined).slice(0, 40);
    if (vals.length && vals.every((v) => typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(String(v).trim()))) return 'num';
    if (vals.length && vals.every((v) => /^\d{1,2}[-/][A-Za-z0-9]{2,4}[-/]\d{2,4}$/.test(String(v).trim()))) return 'date';
    if (vals.length && vals.every((v) => /^[A-Z0-9]{15}$/.test(String(v).trim()))) return 'gstin';
    return 'text';
  });

  return {
    label: tab.label,
    headers: pick,
    originalHeaders: tab.originalHeaders || pick,
    rows,
    total: all.length,
    shown: Math.min(limit, all.length),
    cols: pick,
    kinds,
    colCount: pick.length,
  };
}

function pickHeader(headers, candidates) {
  const lower = headers.map((h) => String(h).toLowerCase());
  for (const c of candidates) {
    const i = lower.findIndex((h) => h === c);
    if (i >= 0) return headers[i];
  }
  for (const c of candidates) {
    const i = lower.findIndex((h) => h.includes(c));
    if (i >= 0) return headers[i];
  }
  return null;
}
