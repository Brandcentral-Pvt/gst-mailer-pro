// HTML email rendering (inline styles) + SMTP delivery via nodemailer.
import nodemailer from 'nodemailer';
import ExcelJS from 'exceljs';
import { escapeHtml as esc, formatINR, parseEmails, EMAIL_RE } from './util.js';

const NAVY = '#0f2d4a';
const TEAL = '#0b7285';
const LIGHT = '#eef6f9';
const BORDER = '#d7e3ec';
const MUTED = '#5b7185';

function interpolate(text, ctx) {
  return String(text || '')
    .replace(/\{vendor_name\}/g, ctx.vendor)
    .replace(/\{tab1_name\}/g, ctx.tab1)
    .replace(/\{tab2_name\}/g, ctx.tab2)
    .replace(/\{attachment_filename\}/g, ctx.attachment);
}

function pillStyle(status) {
  const s = status.toLowerCase();
  if (s.includes('match') && !s.includes('mis')) return { bg: '#e8f7ee', fg: '#17803d' };
  if (s.includes('mismatch') || s.includes('value')) return { bg: '#fff5e6', fg: '#a35a06' };
  if (s.includes('unmatch')) return { bg: '#fdecec', fg: '#b42318' };
  return { bg: '#eef2f6', fg: '#41556b' };
}

export function renderEmailHtml(summary, template, ctx) {
  const tab1 = summary.tabs[0]?.label || 'Sheet 1';
  const tab2 = summary.tabs[1]?.label || 'Sheet 2';
  const subject = interpolate(template.subject, { ...ctx, tab1, tab2 });
  const greeting = interpolate(template.greeting, { ...ctx, tab1, tab2 });
  const intro = interpolate(template.intro, { ...ctx, tab1, tab2 });
  const closingLines = interpolate(template.closing, { ...ctx, tab1, tab2 }).split('\n');

  const kpis = [
    ['Total Records', summary.totalRows.toLocaleString('en-IN')],
    ['Total GST', formatINR(summary.totalGst)],
    ['GSTIN', (summary.gstins[0] || '—')],
    ['Period', summary.dateRange],
  ];

  const kpiCells = kpis.map(([label, value]) => `
    <td style="padding:11px 12px;background:${LIGHT};border:1px solid ${BORDER};border-radius:8px;text-align:center;vertical-align:top;">
      <div style="font:600 10px/14px Arial,sans-serif;color:${MUTED};letter-spacing:.7px;text-transform:uppercase;">${esc(label)}</div>
      <div style="font:700 15px/22px Arial,sans-serif;color:${NAVY};padding-top:3px;">${esc(value)}</div>
    </td>`).join('');

  const rows = summary.tabs.map((t) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid ${BORDER};font:600 13px Arial,sans-serif;color:${NAVY};">${esc(t.label)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${BORDER};text-align:right;font:13px Arial,sans-serif;color:#1f2d3a;">${t.rows.toLocaleString('en-IN')}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${BORDER};text-align:right;font:13px Arial,sans-serif;color:#1f2d3a;">${formatINR(t.cgst)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${BORDER};text-align:right;font:13px Arial,sans-serif;color:#1f2d3a;">${formatINR(t.sgst)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${BORDER};text-align:right;font:13px Arial,sans-serif;color:#1f2d3a;">${formatINR(t.igst)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${BORDER};text-align:right;font:700 13px Arial,sans-serif;color:${TEAL};">${formatINR(t.totalGst)}</td>
    </tr>`).join('');

  const grandRow = `
    <tr>
      <td style="padding:11px 12px;background:#f4f8fb;font:700 13px Arial,sans-serif;color:${NAVY};border-top:2px solid ${TEAL};">TOTAL</td>
      <td style="padding:11px 12px;background:#f4f8fb;text-align:right;font:700 13px Arial,sans-serif;color:${NAVY};border-top:2px solid ${TEAL};">${summary.totalRows.toLocaleString('en-IN')}</td>
      <td style="padding:11px 12px;background:#f4f8fb;text-align:right;font:700 13px Arial,sans-serif;color:${NAVY};border-top:2px solid ${TEAL};">${formatINR(summary.cgst)}</td>
      <td style="padding:11px 12px;background:#f4f8fb;text-align:right;font:700 13px Arial,sans-serif;color:${NAVY};border-top:2px solid ${TEAL};">${formatINR(summary.sgst)}</td>
      <td style="padding:11px 12px;background:#f4f8fb;text-align:right;font:700 13px Arial,sans-serif;color:${NAVY};border-top:2px solid ${TEAL};">${formatINR(summary.igst)}</td>
      <td style="padding:11px 12px;background:#f4f8fb;text-align:right;font:700 13px Arial,sans-serif;color:${TEAL};border-top:2px solid ${TEAL};">${formatINR(summary.totalGst)}</td>
    </tr>`;

  const statusPills = template.includeStatusBreakdown !== false
    ? Object.entries(summary.statusCounts || {})
      .sort((a, b) => b[1] - a[1])
      .map(([s, n]) => {
        const { bg, fg } = pillStyle(s);
        return `<span style="display:inline-block;padding:4px 10px;margin:0 6px 6px 0;background:${bg};color:${fg};border-radius:12px;font:600 11px Arial,sans-serif;">${esc(s)}: ${n.toLocaleString('en-IN')}</span>`;
      }).join('')
    : '';

  const statusBlock = statusPills ? `
    <tr><td style="padding:4px 28px 0;">
      <div style="font:600 11px Arial,sans-serif;color:${MUTED};text-transform:uppercase;letter-spacing:.7px;padding-bottom:7px;">Reconciliation status</div>
      ${statusPills}
    </td></tr>` : '';

  const aliasBlock = summary.aliases.length > 1
    ? `<div style="font:12px Arial,sans-serif;color:${MUTED};padding-top:8px;">Names combined in this statement: <b>${esc(summary.aliases.join(', '))}</b></div>`
    : '';

  // ---------------- transaction-level rows: EVERY column from the sheet ----------------
  // Rendered with a <style> block + short class names: Gmail clips messages over
  // ~102 KB, so cells carry no inline CSS and the row count auto-fits the budget.
  const maxRows = Number.isFinite(template.bodyRowLimit) ? template.bodyRowLimit : 100;
  const rowBlocks = template.includeRows === false
    ? []
    : (summary.rowTables || []).filter((t) => t && t.rows && t.rows.length);

  const fmtCell = (v, maxLen = 0) => {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number') {
      if (!Number.isInteger(v)) return v.toFixed(2);
      return Math.abs(v) > Number.MAX_SAFE_INTEGER ? String(v) : v.toLocaleString('en-IN');
    }
    let t = String(v).replace(/\s+/g, ' ').trim();
    if (maxLen && t.length > maxLen) t = `${t.slice(0, maxLen - 1)}\u2026`;
    return esc(t);
  };

  /** Render the per-sheet row tables for a given number of rows per sheet. */
  function renderTables(tables, limit) {
    if (!tables.length) return '';
    return `
    <tr><td style="padding:20px 0 0;">
      <div style="font:700 11px Arial,sans-serif;color:${MUTED};text-transform:uppercase;letter-spacing:.8px;padding:0 20px 8px;">
        Transaction records &mdash; every column from your sheet
      </div>
      ${tables.map((t, tIdx) => {
        const shown = Math.min(t.rows.length, limit);
        const kinds = t.kinds || t.headers.map(() => 'text');
        // width from the longest real value per column, with a floor per kind
        const widths = t.headers.map((h, ci) => {
          const vals = t.rows.slice(0, 30).map((r) => String(r[ci] ?? ''));
          const longest = Math.max(0, ...vals.map((v) => v.length));
          const head = String(t.originalHeaders?.[ci] ?? h).length;
          const floor = kinds[ci] === 'money' || kinds[ci] === 'num' ? 7
            : kinds[ci] === 'date' ? 10
            : kinds[ci] === 'gstin' ? 15
            : kinds[ci] === 'status' ? 11
            : 6;
          return Math.max(Math.min(longest, 30), head * 0.85, floor);
        });
        // Every column must be visible in every mail client, so the table is
        // laid out fixed with percentages that always sum to 100%.
        // Width is shared in proportion to sqrt(need): long text columns get more
        // room than short codes, but no single column can dominate.
        const CARD_PCT = 1100; // card max-width in px, used to turn px minimums into %
        const NAT_MIN = { money: 58, num: 46, date: 74, gstin: 96, status: 74, text: 56 };
        const need = t.headers.map((h, ci) => {
          const vals = t.rows.slice(0, 30).map((r) => String(r[ci] ?? ''));
          const longest = Math.max(0, ...vals.map((v) => v.length));
          const head = String(t.originalHeaders?.[ci] ?? h).replace(/\s*\(₹\)\s*$/, '').trim().length;
          const ch = kinds[ci] === 'money' || kinds[ci] === 'num' ? 5.7 : 5.8;
          const cap = kinds[ci] === 'text' ? 150 : 120;
          return Math.min(Math.max(Math.max(longest * ch, head * 3.6) + 12, NAT_MIN[kinds[ci]] || 56), cap);
        });
        const minShare = { money: 58, num: 46, date: 66, gstin: 88, status: 70, text: 40 };
        // character budget per column — a 15-char GSTIN needs ~3x the room of a
        // 5-char amount, so weight by the real max length rather than a flat sqrt
        const budget = t.headers.map((h, ci) => {
          const vals = t.rows.slice(0, 40).map((r) => String(r[ci] ?? ''));
          const longest = Math.max(0, ...vals.map((v) => v.length));
          const head = String(t.originalHeaders?.[ci] ?? h).replace(/\s*\(₹\)\s*$/, '').trim().length;
          return Math.max(Math.min(longest, 34), Math.min(head, 20) * 0.9, 4);
        });
        const weight = budget.map((b) => Math.pow(b, 0.75));
        const wSum = weight.reduce((a, b) => a + b, 0) || 1;
        let pct = weight.map((w) => (w / wSum) * 100);
        // enforce a hard minimum per kind, then shrink the rest proportionally
        for (let pass = 0; pass < 3; pass += 1) {
          const deficit = pct.reduce((a, p, ci) => a + Math.max(0, (minShare[kinds[ci]] || 54) / CARD_PCT - p), 0);
          if (deficit <= 0.001) break;
          const room = pct.reduce((a, p, ci) => a + (p > (minShare[kinds[ci]] || 54) / CARD_PCT ? p : 0), 0);
          pct = pct.map((p, ci) => {
            const min = (minShare[kinds[ci]] || 54) / CARD_PCT;
            if (p < min) return min;
            return room > 0 ? p - (p / room) * deficit : p;
          });
        }
        const pctSum = pct.reduce((a, b) => a + b, 0);
        pct = pct.map((p) => (p / pctSum) * 100);
        const colsHtml = pct.map((p) => `<col style="width:${p.toFixed(2)}%">`).join('');

        const th = t.headers.map((h, ci) => {
          const label = String(t.originalHeaders?.[ci] ?? h).replace(/\s*\(₹\)\s*$/, '').trim();
          return `<th>${label ? esc(label) : '&nbsp;'}</th>`;
        }).join('');
        const trs = t.rows.slice(0, shown).map((r, ri) => `<tr${ri % 2 ? ' class="alt"' : ''}>${r
          .map((v, ci) => {
            const k = kinds[ci];
            const code = k === 'gstin' || /invoice|reference|irn|voucher|doc\.? no/i.test(String(t.headers[ci] || ''));
            return `<td${code ? ' class="code"' : ''}>${fmtCell(v, k === 'text' ? 60 : 0)}</td>`;
          })
          .join('')}</tr>`).join('');
        const more = t.total > shown
          ? `<tr><td colspan="${t.headers.length}" class="more">+ ${(t.total - shown).toLocaleString('en-IN')} more rows in ${esc(ctx.attachment)}</td></tr>`
          : '';
        return `
      <div style="font:700 12px Arial,sans-serif;color:${NAVY};padding:0 20px 6px;">
        ${esc(t.label)}
        <span style="font:10.5px Arial,sans-serif;color:${MUTED};font-weight:400;">&nbsp;&middot;&nbsp; ${t.total.toLocaleString('en-IN')} rows &middot; ${t.headers.length} columns${t.total > shown ? ` &middot; showing first ${shown}` : ''}</span>
      </div>
      <table class="rt rt${tIdx}" role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <colgroup>${colsHtml}</colgroup>
        <tr>${th}</tr>
        ${trs}
        ${more}
      </table>
      <div style="height:14px;line-height:14px;font-size:0;">&nbsp;</div>`;
      }).join('')}
    </td></tr>`;
  }

  // alignment / no-wrap per column, scoped per table so the two sheets cannot clash
  const alignRules = rowBlocks.map((t, ti) => {
    const kinds = t.kinds || [];
    return kinds.map((k, ci) => {
      const n = ci + 1;
      if (k === 'money' || k === 'num') return `.rt${ti} td:nth-child(${n}),.rt${ti} th:nth-child(${n}){text-align:right;}`;
      return '';
    }).join('');
  }).join('');

  // ---- fit the whole message under Gmail's ~102 KB clip limit -----------------
  const BUDGET = 96 * 1024;
  let rowLimit = maxRows;
  let rowTablesBlock = renderTables(rowBlocks, rowLimit);
  if (rowBlocks.length && rowTablesBlock.length > BUDGET * 0.7) {
    let lo = 5;
    let hi = maxRows;
    let best = 5;
    for (let i = 0; i < 7; i += 1) {
      const mid = Math.floor((lo + hi) / 2);
      const size = renderTables(rowBlocks, mid).length;
      if (size <= BUDGET * 0.7) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
      if (lo > hi) break;
    }
    rowLimit = best;
    rowTablesBlock = renderTables(rowBlocks, rowLimit);
  }
  if (rowBlocks.length && rowLimit < maxRows) {
    rowTablesBlock += `<tr><td style="padding:6px 20px 0;font:10.5px/16px Arial,sans-serif;color:${MUTED};">
      Row limit reduced to ${rowLimit} per sheet so the message is not clipped by Gmail &mdash;
      every row is in the attached workbook.</td></tr>`;
  }

  const rowStyles = rowBlocks.length ? `
<style>
  .rt{border-collapse:collapse;width:100%;table-layout:fixed;border-top:1px solid ${BORDER};
       border-bottom:1px solid ${BORDER};}
  .rt th{background:${NAVY};color:#ffffff;font:600 8.5px/11px Arial,sans-serif;text-transform:uppercase;
         letter-spacing:0;padding:6px 4px;vertical-align:bottom;text-align:left;
         word-wrap:break-word;overflow-wrap:break-word;}
  .rt td{border-bottom:1px solid #edf3f8;padding:4px;font:9px/12px Arial,sans-serif;
         color:#233746;vertical-align:top;text-align:left;
         word-wrap:break-word;overflow-wrap:break-word;}
  .rt td.code{overflow-wrap:anywhere;word-break:break-all;}
  .rt tr.alt td{background:#fafcfe;}
  .rt td.more{background:#eef6f9;color:${TEAL};font:600 10.5px Arial,sans-serif;text-align:center;padding:7px;}
  .rt td{font-variant-numeric:tabular-nums;}
  ${alignRules}
</style>` : '';

  const closingBlocks = closingLines.map((line) => (line.trim()
    ? `<p style="margin:0 0 10px;">${esc(line)}</p>`
    : '<p style="margin:0 0 6px;">&nbsp;</p>')).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title>${rowStyles}</head>
<body style="margin:0;padding:0;background:#f2f5f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f5f8;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="1100" cellpadding="0" cellspacing="0" style="width:100%;max-width:1100px;background:#ffffff;border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">
    <tr><td style="background:${NAVY};padding:22px 28px;">
      <div style="font:700 11px Arial,sans-serif;letter-spacing:2px;color:#8fc7d8;text-transform:uppercase;">GST Reconciliation</div>
      <div style="font:700 23px/31px Arial,sans-serif;color:#ffffff;padding-top:4px;">${esc(summary.vendor)}</div>
      <div style="font:13px/20px Arial,sans-serif;color:#c7d8e5;padding-top:2px;">Tax period statement — ${esc(summary.dateRange)}</div>
    </td></tr>
    <tr><td style="padding:20px 28px 6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-spacing:8px 0;"><tr>${kpiCells}</tr></table>
    </td></tr>
    <tr><td style="padding:14px 28px 0;font:14px/22px Arial,sans-serif;color:#1f2d3a;">
      <p style="margin:0 0 10px;">${esc(greeting)}</p>
      <p style="margin:0;color:#3b4f61;">${esc(intro)}</p>
    </td></tr>
    <tr><td style="padding:18px 28px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:8px;overflow:hidden;">
        <tr style="background:${NAVY};">
          ${['Sheet', 'Records', 'CGST', 'SGST', 'IGST', 'Total GST'].map((h, i) => `<th align="${i === 0 ? 'left' : 'right'}" style="padding:11px 12px;font:600 11px Arial,sans-serif;color:#ffffff;text-transform:uppercase;letter-spacing:.6px;">${h}</th>`).join('')}
        </tr>
        ${rows}
        ${grandRow}
      </table>
      ${aliasBlock}
    </td></tr>
    ${statusBlock}
    ${rowTablesBlock}
    <tr><td style="padding:18px 28px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${LIGHT};border:1px dashed #9cc4d4;border-radius:8px;">
        <tr><td style="padding:14px 16px;">
          <div style="font:700 13px Arial,sans-serif;color:${NAVY};">&#128206; Attached: ${esc(ctx.attachment)}</div>
          <div style="font:12px/19px Arial,sans-serif;color:${MUTED};padding-top:4px;">
            Complete workbook with <b>all ${summary.totalRows.toLocaleString('en-IN')} records</b> exactly as in the uploaded sheet &mdash;
            <b>${esc(tab1)}</b> (${summary.rowSplit.tab1.toLocaleString('en-IN')} rows) and
            <b>${esc(tab2)}</b> (${summary.rowSplit.tab2.toLocaleString('en-IN')} rows), original columns and values, nothing filtered.
          </div>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:18px 28px 24px;font:14px/22px Arial,sans-serif;color:#1f2d3a;">${closingBlocks}</td></tr>
    <tr><td style="background:#f4f8fb;border-top:1px solid ${BORDER};padding:14px 28px;font:11px/17px Arial,sans-serif;color:${MUTED};">
      This is an automated GST reconciliation statement sent to ${esc(summary.vendor)}. Amounts are as per the books of accounts
      and include GSTIN, invoice and transaction-level detail from both reconciliation sheets.<br>
      Generated on ${new Date().toLocaleString('en-IN')} · Please disregard if this reached you in error.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

export function renderEmailText(summary, template, ctx) {
  const tab1 = summary.tabs[0]?.label || 'Sheet 1';
  const tab2 = summary.tabs[1]?.label || 'Sheet 2';
  const body = [];
  body.push(interpolate(template.greeting, { ...ctx, tab1, tab2 }));
  body.push('');
  body.push(interpolate(template.intro, { ...ctx, tab1, tab2 }));
  body.push('');
  body.push(`${'Sheet'.padEnd(24)}${'Records'.padStart(10)}${'Total GST'.padStart(16)}`);
  body.push('-'.repeat(50));
  summary.tabs.forEach((t) => {
    body.push(`${t.label.slice(0, 23).padEnd(24)}${String(t.rows).padStart(10)}${formatINR(t.totalGst).padStart(16)}`);
  });
  body.push('-'.repeat(50));
  body.push(`${'TOTAL'.padEnd(24)}${String(summary.totalRows).padStart(10)}${formatINR(summary.totalGst).padStart(16)}`);
  body.push('');

  // transaction-level rows, same as the HTML version
  const maxRows = Number.isFinite(template.bodyRowLimit) ? template.bodyRowLimit : 100;
  const textRowTables = template.includeRows === false ? [] : (summary.rowTables || []).filter((t) => t && t.rows?.length);
  textRowTables.forEach((t) => {
    const shown = Math.min(t.rows.length, maxRows);
    body.push(`--- ${t.label} : ${t.total} rows, ${t.headers.length} columns${t.total > shown ? ` (showing first ${shown})` : ''} ---`);
    body.push((t.originalHeaders || t.headers).join(' | '));
    t.rows.slice(0, shown).forEach((r) => {
      body.push(r.map((v) => (v === null || v === undefined ? '' : String(v))).join(' | '));
    });
    if (t.total > shown) body.push(`... ${t.total - shown} more rows in ${ctx.attachment}`);
    body.push('');
  });

  body.push(`Attachment: ${ctx.attachment} (every row exactly as in the uploaded sheet)`);
  body.push('');
  body.push(interpolate(template.closing, { ...ctx, tab1, tab2 }));
  return body.join('\n');
}

export function subjectFor(summary, template, ctx) {
  const tab1 = summary.tabs[0]?.label || 'Sheet 1';
  const tab2 = summary.tabs[1]?.label || 'Sheet 2';
  return interpolate(template.subject, { ...ctx, tab1, tab2 }).replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// SMTP
// ---------------------------------------------------------------------------
export function makeTransport(smtp) {
  const options = {
    host: smtp.host,
    port: Number(smtp.port) || 587,
    secure: Boolean(smtp.secure),
    requireTLS: !smtp.secure && Number(smtp.port) === 587,
    tls: { minVersion: 'TLSv1.2' },
    auth: smtp.username && smtp.password ? { user: smtp.username, pass: smtp.password } : undefined,
    connectionTimeout: 25000,
    greetingTimeout: 15000,
    socketTimeout: 60000,
    pool: false,
  };
  return nodemailer.createTransport(options);
}

export async function testConnection(smtp) {
  if (!smtp.username || !smtp.password) {
    return { ok: false, message: 'Enter the SMTP username and App Password first — authentication cannot be verified without them.' };
  }
  const started = Date.now();
  try {
    const t = makeTransport(smtp);
    await t.verify();
    return { ok: true, message: `Connected & authenticated with ${smtp.host}:${smtp.port} successfully.`, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, message: explainSmtpError(err) };
  }
}

export function explainSmtpError(err) {
  const code = err?.code || '';
  const msg = String(err?.message || err);
  if (code === 'EAUTH' || /Invalid login|535|534-5\.7\.9|Username and Password not accepted/i.test(msg)) {
    return 'Authentication failed. For Gmail use a 16-character App Password (Google Account → Security → 2-Step Verification → App passwords), and make sure 2-Step Verification is on.';
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || /timeout/i.test(msg)) {
    return `${msg} — the server could not be reached. Check host/port (587 STARTTLS or 465 SSL) and whether the network blocks outbound SMTP.`;
  }
  if (code === 'ESOCKET' || /wrong version|EPROTO|SSL/i.test(msg)) {
    return `${msg} — the encryption mode does not match the port. Try 587 + STARTTLS or 465 + SSL.`;
  }
  if (/5\.7\.0|Authentication Required|relay/i.test(msg)) {
    return `${msg} — the SMTP server refused to relay. Authenticate with an account that is allowed to send as this From address.`;
  }
  return msg;
}

async function sampleWorkbookBuffer(summary) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GST Vendor Mailer Pro';
  const ws = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [{ width: 32 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 16 }];
  const title = ws.addRow([`GST Reconciliation Summary — ${summary.vendor}`]);
  ws.mergeCells(title.number, 1, title.number, 6);
  title.getCell(1).font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
  title.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2D4A' } };
  ws.addRow([]);
  ws.addRow(['This is a SAMPLE attachment generated by the "Send test email" button.']).getCell(1).font =
    { italic: true, color: { argb: 'FF5B7185' } };
  ws.addRow(['Real campaigns attach every row of the vendor from both tabs.']).getCell(1).font =
    { italic: true, color: { argb: 'FF5B7185' } };
  ws.addRow([]);
  const hdr = ws.addRow(['Sheet', 'Rows', 'CGST', 'SGST', 'IGST', 'Total GST']);
  hdr.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B7285' } };
  });
  for (const t of summary.tabs) {
    const r = ws.addRow([t.label, t.rows, t.cgst, t.sgst, t.igst, t.totalGst]);
    [3, 4, 5, 6].forEach((i) => { r.getCell(i).numFmt = '#,##0.00'; });
  }
  const tot = ws.addRow(['TOTAL', summary.totalRows, summary.cgst, summary.sgst, summary.igst, summary.totalGst]);
  tot.font = { bold: true };
  [3, 4, 5, 6].forEach((i) => { tot.getCell(i).numFmt = '#,##0.00'; });
  ws.addRow([]);
  ws.addRow(['GSTIN', summary.gstins[0] || '—']);
  ws.addRow(['Period', summary.dateRange]);

  const rows = wb.addWorksheet('Sample rows');
  rows.columns = [
    { header: 'Sheet', key: 'sheet', width: 20 }, { header: 'Invoice No', key: 'inv', width: 16 },
    { header: 'Date', key: 'date', width: 14 }, { header: 'GSTIN', key: 'gstin', width: 20 },
    { header: 'Taxable Value', key: 'taxable', width: 16 }, { header: 'CGST', key: 'cgst', width: 12 },
    { header: 'SGST', key: 'sgst', width: 12 }, { header: 'IGST', key: 'igst', width: 12 },
    { header: 'Status', key: 'status', width: 16 },
  ];
  rows.getRow(1).eachCell((c) => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF6F9' } }; });
  for (let i = 1; i <= 6; i += 1) {
    const tab = summary.tabs[i % 2];
    rows.addRow({
      sheet: tab.label, inv: `SAMPLE/${String(1000 + i)}`, date: '15-Apr-2026',
      gstin: summary.gstins[0] || '—', taxable: 10000 + i * 500,
      cgst: Math.round((tab.cgst / 37) * 100) / 100, sgst: Math.round((tab.sgst / 37) * 100) / 100,
      igst: 0, status: i % 3 ? 'Matched' : 'Value Mismatch',
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Build the sample/test mail so SMTP and Gmail API share one code path. */
export async function buildTestEmail(template, to) {
  const { subject, html, text } = buildTestEmailBodies(template);
  return {
    subject,
    html,
    text,
    to,
    attachment: {
      filename: 'GST_SAMPLE_VENDOR.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content: await sampleWorkbookBuffer(buildSampleSummary()),
    },
  };
}

function buildSampleSummary() {
  return {
    vendor: 'SAMPLE VENDOR PVT LTD',
    totalRows: 128,
    rowSplit: { tab1: 74, tab2: 54 },
    tabs: [
      { label: 'Purchase Register', rows: 74, cgst: 1200.5, sgst: 1200.5, igst: 0, totalGst: 2401 },
      { label: 'GSTR-2B Portal', rows: 54, cgst: 980.25, sgst: 980.25, igst: 0, totalGst: 1960.5 },
    ],
    cgst: 2180.75,
    sgst: 2180.75,
    igst: 0,
    totalGst: 4361.5,
    gstins: ['24ABCDE1234F1Z5'],
    statusCounts: { Matched: 109, Unmatched: 14, 'Value Mismatch': 5 },
    dateRange: '01-Apr-2026 – 31-Aug-2026',
    aliases: ['SAMPLE VENDOR PVT LTD'],
  };
}

function buildTestEmailBodies(template) {
  const sampleSummary = buildSampleSummary();
  const ctx = { vendor: 'SAMPLE VENDOR PVT LTD', tab1: 'Purchase Register', tab2: 'GSTR-2B Portal', attachment: 'GST_SAMPLE_VENDOR.xlsx' };
  return {
    html: renderEmailHtml(sampleSummary, template, ctx),
    text: renderEmailText(sampleSummary, template, ctx),
    subject: `TEST — ${subjectFor(sampleSummary, template, ctx)}`,
  };
}

export async function sendTestEmail(smtp, template, to) {
  if (!EMAIL_RE.test(String(to || '').trim())) return { ok: false, message: `"${to}" is not a valid email address.` };
  const { html, text, subject } = buildTestEmailBodies(template);
  try {
    const transport = makeTransport(smtp);
    const info = await transport.sendMail({
      from: { name: smtp.senderName || 'GST Accounts', address: smtp.senderEmail || smtp.username },
      to,
      replyTo: smtp.replyTo || undefined,
      subject,
      text,
      html,
      attachments: [{
        filename: 'GST_SAMPLE_VENDOR.xlsx',
        content: await sampleWorkbookBuffer(buildSampleSummary()),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }],
    });
    return { ok: true, message: `Test email sent to ${to} (${info.messageId || 'queued'}). Check inbox and spam — it includes the summary HTML and an attachment.` };
  } catch (err) {
    return { ok: false, message: explainSmtpError(err) };
  }
}

export { parseEmails };
