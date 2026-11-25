// Express API + static SPA host
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

import {
  isLoaded, getStats, loadWorkbook, clearWorkbook, getVendorList, editMapping, rematchAll, getSuggestions,
  buildSummaryFor, vendorSummary, getState,
} from './dataset.js';
import { peekWorkbook, detectHeaderRow, detectColumns } from './xlsx.js';
import {
  loadSettings, saveSettings, publicSettings, clearGmailConnection, loadRecipients, saveRecipients,
  appendHistory, loadHistory,
} from './store.js';
import {
  previewPayload, buildAttachment, startCampaign, cancelCampaign, cancelAllCampaigns, clearAttachmentCache,
  getJob, jobSnapshot, campaignCsv, attachmentFile, listJobs,
} from './campaign.js';
import { testConnection, sendTestEmail } from './email.js';
import {
  gmailAuthUrl, exchangeCode, checkGmailAuth, sendViaGmail, explainGmailError, gmailLimits,
} from './gmail.js';
import { parseEmails, EMAIL_RE, strictKeyLoose } from './util.js';
import { createAuth } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const UPLOADS = path.join(ROOT, 'uploads');
const DIST = path.join(ROOT, 'dist');
fs.mkdirSync(UPLOADS, { recursive: true });

const app = express();
app.use(express.json({ limit: '12mb' }));

const upload = multer({
  dest: UPLOADS,
  limits: { fileSize: 120 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(xlsx|xlsm|csv)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Upload an .xlsx workbook (2 tabs) or a .csv file'));
  },
});

const uploadStore = new Map(); // fileId -> { path, filename, size, uploadedAt, cache }
const SESSION_FILE = path.join(ROOT, 'data', 'session.json');
const BACKUP_DIR = path.join(ROOT, 'data', 'workbook');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const auth = createAuth(path.join(ROOT, 'data'));

const api = express.Router();

function fail(res, status, message) { return res.status(status).json({ error: message }); }

api.get('/health', (req, res) => {
  res.json({ ok: true, loaded: isLoaded(), version: '2.0.0', uptime: process.uptime() });
});

// ------------------------------------------------------------------ upload
api.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return fail(res, 400, 'No file received');
  const fileId = crypto.randomBytes(5).toString('hex');
  const ext = path.extname(req.file.originalname).toLowerCase();
  const dest = path.join(UPLOADS, `${fileId}${ext}`);
  fs.renameSync(req.file.path, dest);
  const isCsv = ext === '.csv';
  try {
    let sheets;
    if (isCsv) {
      // parse CSV through exceljs csv reader
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.csv.readFile(dest);
      const ws = wb.worksheets[0];
      const rows = [];
      ws.eachRow((row) => {
        const vals = [];
        for (let c = 1; c <= row.cellCount; c += 1) vals.push(row.getCell(c).value ?? '');
        rows.push(vals);
      });
      const headerIdx = detectHeaderRow(rows.slice(0, 25));
      const headerRow = rows[headerIdx] || [];
      sheets = [{
        name: path.basename(req.file.originalname, ext),
        headerRow: headerIdx,
        columns: headerRow.map(String).filter(Boolean),
        sampleRows: rows.slice(headerIdx + 1, headerIdx + 4).map((r) => Object.fromEntries(headerRow.map((h, i) => [String(h), r[i] ?? '']))),
        rowCount: Math.max(0, rows.length - headerIdx - 1),
      }];
    } else {
      const peek = await peekWorkbook(dest, 25);
      sheets = peek.map((s) => {
        const headerIdx = detectHeaderRow(s.rows);
        const cols = (s.rows[headerIdx] || []).map((c) => String(c ?? '').trim()).filter(Boolean);
        return {
          name: s.name,
          headerRow: headerIdx,
          columns: cols,
          sampleRows: s.rows.slice(headerIdx + 1, headerIdx + 4).map((r) => Object.fromEntries(cols.map((h, i) => [h, String(r[i] ?? '')]))),
        };
      });
    }
    uploadStore.set(fileId, { path: dest, filename: req.file.originalname, size: fs.statSync(dest).size, uploadedAt: new Date().toISOString() });
    // single-user app: keep only the file that was just uploaded
    fs.readdirSync(UPLOADS).filter((f) => !f.startsWith(fileId)).forEach((f) => {
      try { fs.unlinkSync(path.join(UPLOADS, f)); } catch { /* ignore */ }
    });
    res.json({ fileId, filename: req.file.originalname, sizeKb: Math.round(fs.statSync(dest).size / 1024), isCsv, sheets });
  } catch (err) {
    res.status(422).json({ error: `Could not read workbook: ${err.message}` });
  }
});

// ------------------------------------------------------------------ configure
api.post('/configure', async (req, res) => {
  const { fileId, tabs } = req.body || {};
  if (!fileId || !Array.isArray(tabs) || !tabs.length) return fail(res, 400, 'fileId and tabs are required');
  const meta = uploadStore.get(fileId);
  if (!meta) return fail(res, 404, 'Upload expired — please upload the workbook again');
  try {
    const tabConfigs = tabs.map((t, i) => ({
      sheetName: t.sheetName,
      label: (t.label || t.sheetName || `Sheet ${i + 1}`).trim(),
      headerRow: Number.isInteger(t.headerRow) ? t.headerRow : undefined,
      vendorCol: t.vendorCol || null,
    }));
    const stats = await loadWorkbook({
      filePath: meta.path,
      filename: meta.filename,
      fileId,
      tabConfigs,
    });
    // keep a copy of the workbook + its config so the dataset survives a restart
    try {
      const backup = path.join(BACKUP_DIR, `session${path.extname(meta.path) || '.xlsx'}`);
      fs.copyFileSync(meta.path, backup);
      fs.writeFileSync(SESSION_FILE, JSON.stringify({
        path: backup, filename: meta.filename, tabConfigs, savedAt: new Date().toISOString(),
      }, null, 2));
    } catch (e) { console.warn('session persist failed:', e.message); }
    res.json({
      stats,
      vendors: withRecipients(getVendorList()),
      suggestions: getSuggestions(),
    });
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

function removeFilesIn(dir, keep = () => false) {
  let removed = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (keep(name)) continue;
      const p = path.join(dir, name);
      try {
        if (fs.statSync(p).isFile()) { fs.unlinkSync(p); removed += 1; }
      } catch { /* ignore a single locked/missing file */ }
    }
  } catch { /* directory not present yet */ }
  return removed;
}

// Remove the active workbook without touching Mail IDs, settings or campaign history.
api.delete('/workbook', (req, res) => {
  const cancelled = cancelAllCampaigns();
  clearWorkbook();
  uploadStore.clear();

  let sessionPath = '';
  try { sessionPath = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'))?.path || ''; } catch { /* already gone */ }
  if (sessionPath && sessionPath !== SESSION_FILE) {
    try { if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath); } catch { /* ignore */ }
  }
  const files = {
    session: (() => { try { if (fs.existsSync(SESSION_FILE)) { fs.unlinkSync(SESSION_FILE); return 1; } } catch { /* ignore */ } return 0; })(),
    backups: removeFilesIn(BACKUP_DIR),
    uploads: removeFilesIn(UPLOADS),
    attachments: clearAttachmentCache(),
  };
  res.json({
    ok: true, loaded: false, cancelledJobs: cancelled, removedFiles: files,
    settings: publicSettings(), recipients: Object.keys(loadRecipients()).length, history: loadHistory(),
  });
});

api.get('/state', (req, res) => {
  if (!isLoaded()) {
    return res.json({ loaded: false, settings: publicSettings(), recipients: Object.keys(loadRecipients()).length, history: loadHistory() });
  }
  res.json({
    loaded: true,
    stats: getStats(),
    vendors: withRecipients(getVendorList()),
    suggestions: getSuggestions(),
    settings: publicSettings(),
    history: loadHistory(),
    jobs: listJobs(),
  });
});

// ------------------------------------------------------------------ matching
api.post('/rematch', (req, res) => {
  if (!isLoaded()) return fail(res, 409, 'No workbook loaded');
  const threshold = Math.min(100, Math.max(80, Number(req.body?.threshold) || 92));
  rematchAll(threshold);
  res.json({ vendors: withRecipients(getVendorList()), suggestions: getSuggestions() });
});

api.post('/mapping/edits', (req, res) => {
  if (!isLoaded()) return fail(res, 409, 'No workbook loaded');
  editMapping(req.body || {});
  res.json({ vendors: withRecipients(getVendorList()), suggestions: getSuggestions() });
});

api.get('/suggestions', (req, res) => {
  if (!isLoaded()) return fail(res, 409, 'No workbook loaded');
  res.json({ suggestions: getSuggestions() });
});

// ------------------------------------------------------------------ vendor detail
api.get('/vendor/:name', (req, res) => {
  if (!isLoaded()) return fail(res, 409, 'No workbook loaded');
  const name = decodeURIComponent(req.params.name);
  const summary = buildSummaryFor(name);
  if (!summary) return fail(res, 404, `Vendor "${name}" not found`);
  const rec = loadRecipients()[strictKeyLoose(name)] || {};
  const file = attachmentFile(name);
  res.json({
    summary,
    tabs: [0, 1].map((i) => vendorSummary(name, i)).map((t, i) => ({
      label: t.label, rows: t.rows, cgst: t.cgst, sgst: t.sgst, igst: t.igst, totalGst: t.totalGst, statusCounts: t.statusCounts,
      columns: t.headers, sample: (() => {
        const st = getState();
        const tab = st.tabs[i];
        const out = [];
        tab.byVendor.forEach((list, raw) => {
          if ((st.mapping[raw] || raw) === name) out.push(...list.slice(0, 3));
        });
        return out.slice(0, 4);
      })(),
    })),
    recipient: { email: rec.email || '', cc: rec.cc || '' },
    attachment: { name: file.name, cached: file.exists() },
  });
});

api.get('/vendor/:name/attachment', async (req, res) => {
  if (!isLoaded()) return fail(res, 409, 'No workbook loaded');
  const name = decodeURIComponent(req.params.name);
  try {
    const pkg = await buildAttachment(name);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${pkg.name}"`);
    fs.createReadStream(pkg.path).pipe(res);
  } catch (err) {
    fail(res, 500, err.message);
  }
});

// ------------------------------------------------------------------ recipients
function withRecipients(list) {
  const store = loadRecipients();
  return list.map((v) => {
    const rec = store[strictKeyLoose(v.vendor)] || {};
    const emails = parseEmails(rec.email);
    return {
      ...v,
      email: rec.email || '',
      cc: rec.cc || '',
      recipients: emails,
      emailValid: emails.length > 0 && emails.every((e) => EMAIL_RE.test(e)),
    };
  });
}

api.get('/recipients', (req, res) => {
  const store = loadRecipients();
  res.json({ count: Object.keys(store).length, entries: Object.values(store), vendors: isLoaded() ? withRecipients(getVendorList()) : [] });
});

api.post('/recipients', (req, res) => {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  const store = loadRecipients();
  let saved = 0;
  entries.forEach((e) => {
    const key = strictKeyLoose(e.vendor || '');
    if (!key) return;
    const email = String(e.email || '').replace(/;/g, ',').trim();
    const cc = String(e.cc || '').replace(/;/g, ',').trim();
    if (email) { store[key] = { vendor: e.vendor, email, cc }; saved += 1; } else delete store[key];
  });
  saveRecipients(store);
  res.json({ ok: true, saved, stored: Object.keys(store).length, vendors: isLoaded() ? withRecipients(getVendorList()) : [] });
});

api.post('/recipients/paste', (req, res) => {
  const text = String(req.body?.text || '');
  const store = loadRecipients();
  let imported = 0;
  text.split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t) return;
    const parts = t.split(/\t|;|\||,/).map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2) return;
    const emailIdx = parts.findIndex((p) => p.includes('@'));
    if (emailIdx < 0) return;
    const email = parts[emailIdx];
    const vendor = parts.filter((p, i) => i !== emailIdx && !p.includes('@')).join(', ').trim() || parts[0];
    if (!vendor) return;
    store[strictKeyLoose(vendor)] = { vendor, email, cc: '' };
    imported += 1;
  });
  saveRecipients(store);
  res.json({ ok: true, imported, stored: Object.keys(store).length, vendors: isLoaded() ? withRecipients(getVendorList()) : [] });
});

api.post('/recipients/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return fail(res, 400, 'No file received');
  try {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    if (/\.csv$/i.test(req.file.originalname)) await wb.csv.readFile(req.file.path);
    else await wb.xlsx.readFile(req.file.path);
    const ws = wb.worksheets[0];
    const rows = [];
    ws.eachRow((row) => {
      const vals = [];
      for (let c = 1; c <= row.cellCount; c += 1) vals.push(String(row.getCell(c).value ?? '').trim());
      rows.push(vals);
    });
    const headerIdx = detectHeaderRow(rows.slice(0, 10));
    const headers = rows[headerIdx] || [];
    const cols = detectColumns(headers);
    let emailCol = cols.emailCol;
    if (!emailCol) emailCol = headers.find((h, i) => rows.slice(headerIdx + 1, headerIdx + 6).some((r) => String(r[i] || '').includes('@')));
    const vendorCol = cols.vendorCol || headers[0];
    if (!vendorCol || !emailCol) {
      return res.status(422).json({ error: 'Could not detect Vendor Name and Mail ID columns', columns: headers });
    }
    const vi = headers.indexOf(vendorCol);
    const ei = headers.indexOf(emailCol);
    const store = loadRecipients();
    let imported = 0;
    rows.slice(headerIdx + 1).forEach((r) => {
      const vendor = String(r[vi] || '').trim();
      const email = String(r[ei] || '').trim();
      if (!vendor || !email.includes('@')) return;
      store[strictKeyLoose(vendor)] = { vendor, email, cc: '' };
      imported += 1;
    });
    saveRecipients(store);
    res.json({ ok: true, imported, stored: Object.keys(store).length, vendorCol, emailCol, vendors: isLoaded() ? withRecipients(getVendorList()) : [] });
  } catch (err) {
    res.status(422).json({ error: `Could not read mapping file: ${err.message}` });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
  }
});

api.delete('/recipients', (req, res) => {
  saveRecipients({});
  res.json({ ok: true, vendors: isLoaded() ? withRecipients(getVendorList()) : [] });
});

api.get('/recipients/template.csv', (req, res) => {
  const lines = ['Vendor Name,Mail ID,CC'];
  if (isLoaded()) {
    getVendorList().forEach((v) => lines.push(`"${v.vendor.replace(/"/g, '""')}",,`));
  } else lines.push('"SAMPLE VENDOR PVT LTD",,');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="vendor_email_mapping_template.csv"');
  res.send(lines.join('\n'));
});

// ------------------------------------------------------------------ settings
api.get('/settings', (req, res) => res.json(publicSettings()));

api.post('/settings', (req, res) => {
  saveSettings(req.body || {});
  res.json(publicSettings());
});

api.post('/smtp/test', async (req, res) => {
  const s = loadSettings().smtp;
  res.json(await testConnection(s));
});

api.post('/smtp/test-email', async (req, res) => {
  const { smtp, template } = loadSettings();
  const to = req.body?.to || smtp.senderEmail || smtp.username;
  res.json(await sendTestEmail(smtp, template, to));
});

// ------------------------------------------------------------------ Gmail API (OAuth)
// The redirect URI must be registered in Google Cloud. Default to the incoming host
// so the same build works on localhost and on a deployed preview URL.
function appBaseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').toString().split(',')[0];
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().split(',')[0];
  return `${proto}://${host}`;
}

function gmailCfg() {
  const { gmail } = loadSettings();
  return gmail;
}

api.get('/oauth/google/url', (req, res) => {
  const cfg = gmailCfg();
  if (!cfg.clientId || !cfg.clientSecret) {
    return fail(res, 400, 'Save the OAuth Client ID and Client Secret first');
  }
  const redirectUri = cfg.redirectUri || `${appBaseUrl(req)}/api/oauth/google/callback`;
  const state = crypto.randomBytes(8).toString('hex');
  try {
    const url = gmailAuthUrl({ ...cfg, redirectUri }, state);
    res.json({ url, redirectUri, state });
  } catch (err) {
    fail(res, 400, err.message);
  }
});

api.get('/oauth/google/callback', async (req, res) => {
  const { code, error } = req.query || {};
  const cfg = gmailCfg();
  if (error) {
    return res.redirect(`/?gmail=error&reason=${encodeURIComponent(String(error))}`);
  }
  if (!code) return res.redirect('/?gmail=error&reason=no_code');
  try {
    const redirectUri = cfg.redirectUri || `${appBaseUrl(req)}/api/oauth/google/callback`;
    const { tokens, email } = await exchangeCode({ ...cfg, redirectUri }, String(code));
    if (!tokens.refresh_token && !cfg.refreshToken) {
      return res.redirect('/?gmail=error&reason=no_refresh_token');
    }
    const settings = loadSettings();
    saveSettings({
      ...settings,
      deliveryMode: 'gmail',
      gmail: {
        ...settings.gmail,
        redirectUri,
        refreshToken: tokens.refresh_token || settings.gmail.refreshToken,
        accountEmail: email || settings.gmail.accountEmail,
      },
      smtp: settings.smtp.senderEmail ? settings.smtp : { ...settings.smtp, senderEmail: email || settings.smtp.senderEmail },
    });
    res.redirect('/?gmail=connected');
  } catch (err) {
    console.error('OAuth exchange failed:', err?.message);
    res.redirect(`/?gmail=error&reason=${encodeURIComponent(explainGmailError(err).slice(0, 160))}`);
  }
});

api.post('/gmail/test', async (req, res) => {
  const { gmail } = loadSettings();
  const started = Date.now();
  const result = await checkGmailAuth(gmail);
  res.json({ ...result, latencyMs: Date.now() - started, limits: gmailLimits(gmail.workspace) });
});

api.post('/gmail/disconnect', (req, res) => {
  clearGmailConnection();
  res.json(publicSettings());
});

api.post('/gmail/test-email', async (req, res) => {
  const { gmail, template } = loadSettings();
  const to = String(req.body?.to || gmail.accountEmail || '').trim();
  const check = await checkGmailAuth(gmail);
  if (!check.ok) return res.json({ ok: false, message: check.message });
  try {
    const { buildTestEmail } = await import('./email.js');
    const mail = await buildTestEmail(template, to);
    await sendViaGmail(gmail, gmail.accountEmail || check.email, {
      to: [to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      fromName: loadSettings().smtp.senderName || '',
      attachment: mail.attachment,
    });
    res.json({ ok: true, message: `Test email sent to ${to} through the Gmail API. Check inbox and spam.` });
  } catch (err) {
    res.json({ ok: false, message: explainGmailError(err) });
  }
});

// ------------------------------------------------------------------ preview & send
api.post('/preview', (req, res) => {
  if (!isLoaded()) return fail(res, 409, 'No workbook loaded');
  const name = String(req.body?.vendor || '');
  const payload = previewPayload(name, loadRecipients());
  if (!payload) return fail(res, 404, `Vendor "${name}" not found`);
  res.json(payload);
});

api.post('/send', (req, res) => {
  if (!isLoaded()) return fail(res, 409, 'No workbook loaded');
  const { vendors = [], dryRun = false } = req.body || {};
  if (!Array.isArray(vendors) || !vendors.length) return fail(res, 400, 'Select at least one vendor');
  const store = loadRecipients();
  const byName = new Map(withRecipients(getVendorList()).map((v) => [v.vendor, v]));
  const recipients = [];
  const skippedNoEmail = [];
  vendors.forEach((name) => {
    const v = byName.get(name);
    if (!v) return;
    if (!v.recipients.length) { skippedNoEmail.push(name); return; }
    const rec = store[strictKeyLoose(name)] || {};
    recipients.push({
      vendor: name,
      to: v.recipients,
      cc: parseEmails(rec.cc),
      rows: v.rows,
    });
  });
  if (!recipients.length) return fail(res, 400, 'None of the selected vendors have a valid Mail ID');
  if (!dryRun) {
    const settings = loadSettings();
    if (settings.deliveryMode === 'gmail') {
      const g = settings.gmail;
      if (!g.clientId || !g.clientSecret) return fail(res, 400, 'Add the Google OAuth Client ID and Client Secret in Settings');
      if (!g.refreshToken) return fail(res, 400, 'Connect your Gmail account in Settings before sending');
      if (!g.accountEmail) return fail(res, 400, 'Set the sender Gmail address in Settings before sending');
    } else {
      const cfg = settings.smtp;
      if (!(cfg.senderEmail || cfg.username)) return fail(res, 400, 'Set the sender email in Settings before sending');
      if (cfg.username && !cfg.password) return fail(res, 400, 'SMTP password / App Password is missing in Settings');
    }
  }
  try {
    const job = startCampaign({ vendors: recipients, dryRun, delaySeconds: req.body?.delaySeconds });
    res.json({ ...job, skippedNoEmail });
  } catch (err) {
    fail(res, 400, err.message);
  }
});

api.get('/send/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return fail(res, 404, 'Job not found');
  res.json(jobSnapshot(job));
});

api.get('/send/:id/stream', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return fail(res, 404, 'Job not found');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ type: 'snapshot', ...jobSnapshot(job) })}\n\n`);
  const unsub = job.listeners.add ? null : null;
  const listener = (evt) => res.write(`data: ${JSON.stringify({ ...evt, ...jobSnapshot(job) })}\n\n`);
  job.listeners.add(listener);
  const keep = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(keep);
    job.listeners.delete(listener);
  });
});

api.post('/send/:id/cancel', (req, res) => {
  res.json({ ok: cancelCampaign(req.params.id) });
});

api.get('/send/:id/log.csv', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return fail(res, 404, 'Job not found');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="GST_send_log_${job.id}.csv"`);
  res.send(campaignCsv(job));
});

api.get('/history', (req, res) => res.json({ history: loadHistory() }));

// ------------------------------------------------------------------ SPA
// Auth endpoints stay public; everything else under /api requires a signed session cookie.
app.use('/api/auth', auth.router);
app.use('/api', auth.requireAuth, api);

if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')));
} else {
  app.get('/', (req, res) => res.send('<h1>GST Mailer Pro</h1><p>Run <code>npm run build</code> to build the React app, or use <code>npm run dev</code>.</p>'));
}

app.use((err, req, res, next) => {
  if (err?.message?.includes('File too large')) return fail(res, 413, 'File is larger than 120 MB');
  return fail(res, 400, err?.message || 'Request failed');
});

async function restoreSession() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return;
    const sess = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    if (!sess?.path || !fs.existsSync(sess.path)) return;
    await loadWorkbook({
      filePath: sess.path,
      filename: sess.filename || path.basename(sess.path),
      fileId: 'restored',
      tabConfigs: sess.tabConfigs || [],
    });
    console.log(`[boot] restored ${sess.filename} → ${getStats().vendorCount} vendors`);
  } catch (e) {
    console.warn('[boot] could not restore session:', e.message);
  }
}

const PORT = process.env.PORT || 8000;
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`GST Vendor Mailer Pro API on http://0.0.0.0:${PORT}`);
  await restoreSession();
});
