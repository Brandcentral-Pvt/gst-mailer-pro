// Workbook reading (streaming, constant memory) and per-vendor .xlsx writing.
import ExcelJS from 'exceljs';
import { formatINR, parseINR, slug } from './util.js';

const HEADER_HINTS = [
  'vendor', 'party', 'supplier', 'gstin', 'invoice', 'bill', 'date', 'cgst', 'sgst',
  'igst', 'cess', 'total gst', 'taxable', 'status', 'match', 'remark', 'reference',
  'transaction', 'email', 'mail', 'irn', 'itc', 'filing', 'doc type', 'entry',
];

const VENDOR_CANDIDATES = [
  'vendor name', 'supplier name', 'party name', 'trade/legal name', 'trade name',
  'legal name', 'name of supplier', 'supplier/legal name', 'supplier trade name',
  'vendor', 'supplier', 'party', 'account name', 'ledger name',
  'customer/vendor name', 'name',
];

const GSTIN_CANDIDATES = ['gstin', 'gstin of supplier', 'supplier gstin', 'vendor gstin', 'party gstin', 'gstin/uin', 'gst no'];
const STATUS_CANDIDATES = ['match status', 'reconciliation status', 'reco status', 'gst status', 'status'];
const EMAIL_CANDIDATES = ['email id', 'mail id', 'vendor email', 'email address', 'e-mail', 'email', 'mail'];
const AMOUNT_HINTS = ['cgst', 'sgst', 'igst', 'utgst', 'cess', 'total gst', 'taxable', 'tax amount', 'invoice value', 'bill amount', 'total tax', 'net amount', 'amount'];
const SKIP_AMOUNT = ['invoice no', 'invoice number', 'reference', 'gstin', 'date', 'rate', '%', 'hsn', 'sac', 'phone', 'mobile', 'entry no', 'irn'];

/** Read one sheet fully into { headers:[], rows:[][] } using a streaming reader. */
export async function readSheet(filePath, sheetName) {
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
    worksheets: 'emit',
    entries: 'emit',
  });
  let target = null;
  for await (const ws of wb) {
    if (!sheetName || ws.name === sheetName) {
      const rows = [];
      for await (const row of ws) {
        const vals = [];
        const count = row.cellCount;
        for (let c = 1; c <= count; c += 1) {
          const v = row.getCell(c).value;
          if (v && typeof v === 'object' && !(v instanceof Date)) {
            if ('richText' in v) vals.push(v.richText.map((t) => t.text).join(''));
            else if ('result' in v) vals.push(v.result);
            else if ('text' in v) vals.push(v.text);
            else vals.push('');
          } else vals.push(v);
        }
        if (vals.some((x) => String(x ?? '').trim() !== '')) rows.push(vals);
      }
      target = { name: ws.name, rows };
      break;
    }
  }
  if (!target) throw new Error(`Sheet "${sheetName}" not found`);
  return target;
}

/** Cheap peek at every sheet: name + first N rows. */
export async function peekWorkbook(filePath, limit = 40) {
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore', worksheets: 'emit', entries: 'emit',
  });
  const out = [];
  for await (const ws of wb) {
    const rows = [];
    for await (const row of ws) {
      if (rows.length >= limit) break;
      const vals = [];
      for (let c = 1; c <= row.cellCount; c += 1) {
        const v = row.getCell(c).value;
        vals.push(v && typeof v === 'object' && !(v instanceof Date) ? (v.result ?? v.text ?? v.richText?.map((t) => t.text).join('') ?? '') : v);
      }
      rows.push(vals);
    }
    out.push({ name: ws.name, rows });
  }
  return out;
}

export function scoreHeaderCell(cell) {
  const s = String(cell ?? '').toLowerCase().trim();
  if (!s) return { kw: 0, alpha: 0, numeric: 0 };
  return {
    kw: HEADER_HINTS.some((h) => s.includes(h)) ? 1 : 0,
    alpha: /[a-z]/i.test(s) && s.length < 60 ? 1 : 0,
    numeric: /^-?[\d.,]+$/.test(s) ? 1 : 0,
  };
}

export function detectHeaderRow(rows) {
  let best = 0; let bestScore = -Infinity;
  rows.slice(0, 20).forEach((row, idx) => {
    const cells = row.map((c) => String(c ?? '').trim()).filter(Boolean);
    if (cells.length < 2) return;
    let kw = 0; let alpha = 0; let numeric = 0;
    cells.forEach((c) => { const s = scoreHeaderCell(c); kw += s.kw; alpha += s.alpha; numeric += s.numeric; });
    const score = kw * 5 + alpha - numeric * 4 - idx * 0.15;
    if (score > bestScore) { bestScore = score; best = idx; }
  });
  return best;
}

/** Turn raw rows + header index into a dataframe-ish object with clean headers. */
export function tableFrom(rows, headerIdx) {
  const headerCells = (rows[headerIdx] || []).map((c) => String(c ?? '').trim());
  const body = rows.slice(headerIdx + 1).filter((r) => (r || []).some((c) => String(c ?? '').trim() !== ''));
  const maxCols = Math.max(headerCells.length, ...body.map((r) => r.length), 0);
  const headers = [];
  const seen = {};
  const keep = [];
  const structural = new Set(); // headerless columns kept only to preserve the sheet grid
  const nonEmptyCol = new Array(maxCols).fill(false);
  body.forEach((r) => {
    for (let c = 0; c < maxCols; c += 1) {
      if (String(r[c] ?? '').trim() !== '') nonEmptyCol[c] = true;
    }
  });
  for (let c = 0; c < maxCols; c += 1) {
    const raw = (headerCells[c] || '').trim();
    // keep a column when it has data OR the sheet gave it a header
    // (headerless + empty columns are layout noise and are dropped)
    if (!raw && !nonEmptyCol[c]) continue;
    let name = raw || `_blank_${c + 1}`;
    const key = name.toLowerCase();
    if (seen[key]) { seen[key] += 1; name = `${name} ${seen[key]}`; } else seen[key] = 1;
    headers.push(name);
    keep.push(c);
    if (!raw) structural.add(name);
  }
  const data = body.map((r, idx) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = String(r[keep[i]] ?? '').trim(); });
    // source sheet order, so a vendor's rows read exactly as they do in Excel
    Object.defineProperty(o, '__row', { value: idx, enumerable: false });
    return o;
  });
  return {
    headers,
    rows: data,
    originalHeaders: keep.map((c) => (headerCells[c] || '').trim()),
    sourceCols: keep,          // index of each header inside the original sheet row
    rawHeaderRow: headerCells,
    sourceWidth: maxCols,
    structuralCols: [...structural],
  };
}

export function pickColumn(headers, candidates) {
  const lower = headers.map((h) => h.toLowerCase());
  for (const c of candidates) {
    const i = lower.indexOf(c);
    if (i >= 0) return headers[i];
  }
  for (const c of candidates) {
    const i = lower.findIndex((h) => h.includes(c));
    if (i >= 0) return headers[i];
  }
  return null;
}

export function detectColumns(headers) {
  const vendorCol = pickColumn(headers, VENDOR_CANDIDATES) || headers[0] || null;
  const gstinCol = pickColumn(headers, GSTIN_CANDIDATES);
  const statusCol = pickColumn(headers, STATUS_CANDIDATES);
  const emailCol = pickColumn(headers, EMAIL_CANDIDATES);
  const dateCol = pickColumn(headers, ['invoice date', 'bill date', 'transaction date', 'doc date', 'date'])
    || headers.find((h) => /date/i.test(h) && !/update/i.test(h)) || null;
  const amountCols = headers.filter((h) => {
    const l = h.toLowerCase();
    if ([vendorCol, gstinCol, statusCol, emailCol].includes(h)) return false;
    if (SKIP_AMOUNT.some((s) => l.includes(s))) return false;
    return AMOUNT_HINTS.some((k) => l.includes(k)) || h.includes('₹');
  });
  return { vendorCol, gstinCol, statusCol, emailCol, dateCol, amountCols };
}

// ---------------------------------------------------------------------------
// money totals helpers
// ---------------------------------------------------------------------------
export function sumTotals(rows, amountCols) {
  const totals = {};
  amountCols.forEach((c) => { totals[c] = 0; });
  rows.forEach((r) => {
    amountCols.forEach((c) => { totals[c] += parseINR(r[c]) || 0; });
  });
  Object.keys(totals).forEach((k) => { totals[k] = Math.round(totals[k] * 100) / 100; });
  return totals;
}

export function gstOf(totals) {
  const totalKey = Object.keys(totals).find((k) => /total gst/i.test(k));
  if (totalKey && Math.abs(totals[totalKey]) > 0.004) return Math.round(totals[totalKey] * 100) / 100;
  return Math.round(['cgst', 'sgst', 'igst', 'utgst', 'cess']
    .reduce((a, k) => {
      const key = Object.keys(totals).find((x) => x.toLowerCase().replace(/\(₹\)/, '').trim() === k);
      return a + (key ? totals[key] : 0);
    }, 0) * 100) / 100;
}

// ---------------------------------------------------------------------------
// per-vendor workbook writer
// ---------------------------------------------------------------------------
const NAVY = 'FF0F2D4A';
const TEAL = 'FF0B7285';
const MONEY_FMT = '#,##0.00;[Red]-#,##0.00';

export async function writeVendorWorkbook({ filePath, vendor, tabs, summary }) {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: filePath,
    useStyles: true,
    useSharedStrings: false,
  });
  wb.creator = 'GST Vendor Mailer Pro';
  wb.created = new Date();

  // ---------------- Summary ----------------
  const ws = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [{ width: 34 }, { width: 18 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 18 }];
  const titleRow = ws.addRow([`GST Reconciliation Summary — ${vendor}`]);
  titleRow.height = 30;
  ws.mergeCells(titleRow.number, 1, titleRow.number, 6);
  titleRow.getCell(1).font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  titleRow.commit();

  const subRow = ws.addRow([`Generated ${new Date().toLocaleString('en-IN')}  ·  All rows from both sheets included`]);
  ws.mergeCells(subRow.number, 1, subRow.number, 6);
  subRow.getCell(1).font = { size: 9, color: { argb: 'FF5B7185' } };
  subRow.commit();
  ws.addRow([]).commit();

  const kpi = ws.addRow(['Total Records', summary.totalRows, 'Total GST', summary.totalGst, 'GSTINs', summary.gstins.length]);
  kpi.height = 22;
  [1, 3, 5].forEach((c) => { kpi.getCell(c).font = { bold: true, color: { argb: NAVY } }; });
  [2, 4, 6].forEach((c) => { kpi.getCell(c).font = { bold: true, size: 13, color: { argb: TEAL } }; });
  kpi.commit();
  ws.addRow([]).commit();

  const secHead = ws.addRow(['Break-up by sheet']);
  ws.mergeCells(secHead.number, 1, secHead.number, 6);
  secHead.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  secHead.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
  secHead.commit();

  const header = ws.addRow(['Sheet', 'Rows', 'CGST', 'SGST', 'IGST', 'Total GST']);
  header.height = 24;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: 'center' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF0B7285' } } };
  });
  header.commit();

  const moneyCell = (cell) => { cell.numFmt = MONEY_FMT; cell.alignment = { horizontal: 'right' }; };
  summary.tabs.forEach((t) => {
    const r = ws.addRow([t.label, t.rows, t.cgst, t.sgst, t.igst, t.totalGst]);
    [3, 4, 5, 6].forEach((c) => moneyCell(r.getCell(c)));
    r.commit();
  });
  const grand = ws.addRow(['TOTAL', summary.totalRows, summary.cgst, summary.sgst, summary.igst, summary.totalGst]);
  grand.font = { bold: true };
  [3, 4, 5, 6].forEach((c) => moneyCell(grand.getCell(c)));
  grand.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F1F8' } }; });
  grand.commit();
  ws.addRow([]).commit();

  if (summary.statusCounts && Object.keys(summary.statusCounts).length) {
    const stHead = ws.addRow(['Match status break-up']);
    ws.mergeCells(stHead.number, 1, stHead.number, 6);
    stHead.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    stHead.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
    stHead.commit();
    Object.entries(summary.statusCounts).forEach(([k, v]) => ws.addRow([k, v]).commit());
    ws.addRow([]).commit();
  }

  const metaRows = [
    ['GSTIN(s)', summary.gstins.join(', ') || '—'],
    ['Date range', summary.dateRange || '—'],
    ['Matched name variants', summary.aliases.join(', ') || '—'],
  ];
  metaRows.forEach(([k, v]) => {
    const r = ws.addRow([k, v]);
    r.getCell(1).font = { bold: true };
    ws.mergeCells(r.number, 2, r.number, 6);
    r.commit();
  });
  ws.commit();

  // ---------------- data sheets ----------------
  for (const tab of tabs) {
    const sh = wb.addWorksheet(tab.label.slice(0, 31) || 'Sheet', {
      views: [{ state: 'frozen', ySplit: 5 }],
    });
    const cols = tab.headers;
    sh.columns = cols.map((h) => ({ width: Math.min(Math.max(h.length + 3, 12), 48) }));

    const title = sh.addRow([vendor]);
    title.height = 26;
    sh.mergeCells(title.number, 1, title.number, Math.max(cols.length, 4));
    title.getCell(1).font = { size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
    title.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    title.getCell(1).alignment = { vertical: 'middle', indent: 1 };
    title.commit();

    const sub = sh.addRow([`${tab.label}  |  ${tab.rows.length.toLocaleString('en-IN')} rows  |  generated ${new Date().toLocaleDateString('en-IN')}`]);
    sh.mergeCells(sub.number, 1, sub.number, Math.max(cols.length, 4));
    sub.getCell(1).font = { size: 9, color: { argb: 'FF5B7185' } };
    sub.commit();
    sh.addRow([]).commit();

    const head = sh.addRow(cols);
    head.height = 28;
    head.eachCell((cell) => {
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
      cell.alignment = { vertical: 'middle', wrapText: true, horizontal: 'center' };
    });
    head.commit();

    const amountSet = new Set(tab.amountCols);
    const totals = {};
    tab.amountCols.forEach((c) => { totals[c] = 0; });

    for (const row of tab.rows) {
      const values = cols.map((c) => {
        const raw = row[c];
        if (amountSet.has(c)) {
          const n = parseINR(raw);
          if (n === null) return raw ?? '';
          totals[c] = (totals[c] || 0) + n;
          return Math.round(n * 100) / 100;
        }
        return raw ?? '';
      });
      const r = sh.addRow(values);
      if (amountSet.size) {
        r.eachCell((cell, colNumber) => {
          const name = cols[colNumber - 1];
          if (amountSet.has(name) && typeof cell.value === 'number') {
            cell.numFmt = MONEY_FMT;
          }
        });
      }
      r.commit();
    }

    if (!cols.length) sh.addRow([]).commit();
    if (tab.rows.length) {
      sh.autoFilter = { from: { row: head.number, column: 1 }, to: { row: head.number + tab.rows.length, column: cols.length } };
    }

    const totalValues = cols.map((c, i) => {
      if (i === 0) return `TOTAL (${tab.rows.length.toLocaleString('en-IN')} rows)`;
      if (amountSet.has(c)) return Math.round((totals[c] || 0) * 100) / 100;
      return null;
    });
    const totalRow = sh.addRow(totalValues);
    totalRow.font = { bold: true };
    totalRow.eachCell((cell, colNumber) => {
      const name = cols[colNumber - 1];
      if (amountSet.has(name) && typeof cell.value === 'number') cell.numFmt = MONEY_FMT;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F1F8' } };
    });
    totalRow.commit();
    sh.commit();
  }

  await wb.commit();
  return filePath;
}

/**
 * Exact copy of the vendor's rows: same column names, same values, no banner,
 * no TOTAL row, no Summary sheet. One worksheet per source tab.
 */
export async function writeVendorWorkbookExact({ filePath, tabs }) {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: filePath,
    useStyles: true,
    useSharedStrings: false,
  });
  wb.creator = 'GST Vendor Mailer Pro';
  wb.created = new Date();

  for (const tab of tabs) {
    const head = tab.headers;
    // a tab with no rows for this vendor adds nothing to an exact copy
    if (!head.length || !tab.rows.length) continue;

    // Reproduce the sheet's original column grid: kept columns sit at their real
    // positions and column text is the sheet's own (repeated "Remark" stays identical).
    const srcCols = Array.isArray(tab.sourceCols) && tab.sourceCols.length === head.length
      ? tab.sourceCols
      : head.map((_, i) => i);
    const rawHeader = Array.isArray(tab.rawHeaderRow) ? tab.rawHeaderRow : head;
    const width = Math.max(
      Number.isInteger(tab.sourceWidth) ? tab.sourceWidth : 0,
      srcCols.length ? Math.max(...srcCols) + 1 : head.length,
    );
    const headAt = new Array(width).fill('');
    srcCols.forEach((c, i) => { headAt[c] = (rawHeader[c] ?? head[i] ?? '').toString(); });

    const sh = wb.addWorksheet(tab.label.slice(0, 31) || 'Sheet', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sh.columns = headAt.map((h) => ({
      width: Math.min(Math.max(String(h).length + 4, 12), 44),
      style: { numFmt: '#,##0.00;[Red]-#,##0.00' },
    }));

    const headerRow = sh.addRow(headAt);
    headerRow.height = 22;
    headerRow.eachCell((cell) => {
      const isNum = false;
      cell.font = { bold: true, size: 10 };
      cell.alignment = { vertical: 'middle', wrapText: true, horizontal: 'left' };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFBFCFDB' } } };
      if (isNum) cell.numFmt = '#,##0.00';
    });
    headerRow.commit();

    const amountSet = new Set(tab.amountCols || []);
    for (const row of tab.rows) {
      const values = new Array(width).fill(null);
      srcCols.forEach((srcIdx, i) => {
        const c = head[i];
        const raw = row[c];
        if (raw === null || raw === undefined || raw === '') return;
        if (typeof raw === 'number' || raw instanceof Date) { values[srcIdx] = raw; return; }
        if (amountSet.has(c)) {
          const n = parseINR(raw);
          values[srcIdx] = n === null ? raw : n;
          return;
        }
        values[srcIdx] = raw;
      });
      sh.addRow(values).commit();
    }
    if (tab.rows.length) {
      sh.autoFilter = {
        from: { row: headerRow.number, column: 1 },
        to: { row: headerRow.number + tab.rows.length, column: width },
      };
    }
    sh.commit();
  }

  await wb.commit();
  return filePath;
}

export function vendorFileName(vendor) {
  return `GST_Statement_${slug(vendor, 55)}.xlsx`;
}

export { formatINR };
