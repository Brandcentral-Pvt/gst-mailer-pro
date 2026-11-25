// Bulk campaign runner: builds per-vendor workbooks and sends them with live progress.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  buildSummaryFor, vendorTabPayloads, isLoaded, getState,
} from './dataset.js';
import { writeVendorWorkbook, writeVendorWorkbookExact, vendorFileName } from './xlsx.js';
import {
  makeTransport, renderEmailHtml, renderEmailText, subjectFor, explainSmtpError,
} from './email.js';
import { sendViaGmail, explainGmailError } from './gmail.js';
import { loadSettings, recordDetectedDelay, appendHistory } from './store.js';
import { strictKeyLoose } from './util.js';

const ATTACH_DIR = path.resolve('data/attachments');
fs.mkdirSync(ATTACH_DIR, { recursive: true });

const jobs = new Map();

export function getJob(id) { return jobs.get(id); }

export function listJobs() {
  return [...jobs.values()].map((j) => ({ id: j.id, status: j.status, total: j.total, dryRun: j.dryRun, processed: j.processed, startedAt: j.startedAt }));
}

export function attachmentFile(canon) {
  const p = path.join(ATTACH_DIR, vendorFileName(canon));
  return { path: p, name: vendorFileName(canon), exists: () => fs.existsSync(p) };
}

/** Cached attachments are format-specific; drop them when the format option changes. */
function syncAttachmentCache(modeKey) {
  const marker = path.join(ATTACH_DIR, '.mode');
  let prev = '';
  try { prev = fs.readFileSync(marker, 'utf8'); } catch { /* first run */ }
  if (prev !== modeKey) {
    try {
      fs.readdirSync(ATTACH_DIR)
        .filter((f) => f.endsWith('.xlsx'))
        .forEach((f) => fs.unlinkSync(path.join(ATTACH_DIR, f)));
    } catch { /* ignore */ }
    fs.writeFileSync(marker, modeKey);
  }
}

export async function buildAttachment(canon) {
  const summary = buildSummaryFor(canon);
  if (!summary) throw new Error(`Vendor "${canon}" not found`);
  const tabs = vendorTabPayloads(canon);
  const file = attachmentFile(canon);
  const { template } = loadSettings();
  syncAttachmentCache(template.attachmentMode === 'exact' ? 'exact' : 'formatted');
  if (template.attachmentMode === 'exact') {
    await writeVendorWorkbookExact({ filePath: file.path, tabs });
  } else {
    await writeVendorWorkbook({ filePath: file.path, vendor: canon, tabs, summary });
  }
  const stat = fs.statSync(file.path);
  return { ...file, bytes: stat.size, rows: summary.totalRows, summary };
}

export function previewPayload(canon, recipients) {
  const summary = buildSummaryFor(canon);
  if (!summary) return null;
  const { template } = loadSettings();
  const file = attachmentFile(canon);
  const ctx = {
    vendor: canon,
    tab1: summary.tabs[0]?.label || '',
    tab2: summary.tabs[1]?.label || '',
    attachment: file.name,
  };
  const rec = recipients[strictKeyLoose(canon)] || {};
  return {
    vendor: canon,
    to: rec.email || '',
    cc: rec.cc || '',
    subject: subjectFor(summary, template, ctx),
    html: renderEmailHtml(summary, template, ctx),
    text: renderEmailText(summary, template, ctx),
    attachment: { name: file.name, rows: summary.totalRows, tab1Rows: summary.rowSplit.tab1, tab2Rows: summary.rowSplit.tab2, cached: file.exists() },
    summary,
  };
}

export function startCampaign({ vendors, dryRun = false, delaySeconds }) {
  if (!isLoaded()) throw new Error('No workbook loaded');
  const settings = loadSettings();
  const id = crypto.randomBytes(6).toString('hex');
  const job = {
    id,
    status: 'running',
    dryRun,
    total: vendors.length,
    processed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    current: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    entries: [],
    cancelRequested: false,
    listeners: new Set(),
    persisted: false,
  };
  jobs.set(id, job);
  run(job, vendors, settings, dryRun, delaySeconds).catch((err) => {
    job.entries.push({ index: job.entries.length + 1, vendor: '—', status: 'failed', message: `Fatal: ${err.message}` });
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
  });
  return { id, total: job.total, dryRun };
}

function emit(job, payload) {
  job.listeners.forEach((fn) => {
    try { fn(payload); } catch { /* ignore */ }
  });
}

async function run(job, vendors, settings, dryRun) {
  const { smtp, template, gmail } = settings;
  const useGmail = settings.deliveryMode === 'gmail';
  const delay = Number(job.delaySeconds ?? smtp.delaySeconds) || 1.2;
  let transport = null;
  const durations = [];
  job.transport = useGmail ? 'gmail-api' : 'smtp';

  if (!dryRun) {
    if (useGmail) {
      if (!gmail.clientId || !gmail.clientSecret) throw new Error('Add the Google OAuth Client ID and Client Secret in Settings');
      if (!gmail.refreshToken) throw new Error('Connect your Gmail account in Settings before sending');
      if (!gmail.accountEmail) throw new Error('Set the sender Gmail address in Settings before sending');
    } else {
      if (!(smtp.senderEmail || smtp.username)) throw new Error('Set the sender email in Settings before sending');
      if (smtp.username && !smtp.password) throw new Error('SMTP password / App Password is missing in Settings');
      transport = makeTransport(smtp);
    }
  }

  const globalCc = (smtp.globalCc || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  const globalBcc = (smtp.globalBcc || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);

  try {
    for (const item of vendors) {
      if (job.cancelRequested) break;
      job.current = item.vendor;
      emit(job, { type: 'current', vendor: item.vendor });
      const t0 = Date.now();
      const entry = {
        index: job.entries.length + 1,
        vendor: item.vendor,
        to: item.to,
        cc: [...(item.cc || []), ...globalCc],
        rows: item.rows,
        status: 'pending',
        attachment: '',
      };
      try {
        if (!item.to?.length) throw new Error('No recipient email mapped');

        const pkg = await buildAttachment(item.vendor);
        entry.attachment = pkg.name;
        entry.attachmentKb = Math.round((pkg.bytes / 1024) * 10) / 10;
        entry.buildMs = Date.now() - t0;

        const ctx = {
          vendor: item.vendor,
          tab1: pkg.summary.tabs[0]?.label || '',
          tab2: pkg.summary.tabs[1]?.label || '',
          attachment: pkg.name,
        };
        const html = renderEmailHtml(pkg.summary, template, ctx);
        const text = renderEmailText(pkg.summary, template, ctx);
        const subject = subjectFor(pkg.summary, template, ctx);
        entry.subject = subject;

        if (dryRun) {
          entry.status = 'dry_run';
          entry.message = 'Dry run — email not sent (attachment generated)';
          job.skipped += 1;
        } else if (useGmail) {
          const attachment = {
            filename: pkg.name,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            content: fs.readFileSync(pkg.path),
          };
          const info = await sendViaGmail(gmail, gmail.accountEmail, {
            fromName: smtp.senderName || 'GST Accounts',
            to: item.to,
            cc: entry.cc,
            bcc: globalBcc,
            replyTo: smtp.replyTo || '',
            subject,
            text,
            html,
            attachment,
          });
          entry.status = 'sent';
          entry.message = `Sent to ${item.to.join(', ')} (Gmail API)`;
          entry.messageId = info.messageId;
          job.sent += 1;
          durations.push((Date.now() - t0) / 1000);
        } else {
          const info = await transport.sendMail({
            from: { name: smtp.senderName || 'GST Accounts', address: smtp.senderEmail || smtp.username },
            to: item.to.join(', '),
            cc: entry.cc.length ? entry.cc.join(', ') : undefined,
            bcc: globalBcc.length ? globalBcc.join(', ') : undefined,
            replyTo: smtp.replyTo || undefined,
            subject,
            text,
            html,
            attachments: [{
              filename: pkg.name,
              path: pkg.path,
              contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            }],
          });
          entry.status = 'sent';
          entry.message = `Sent to ${item.to.join(', ')}`;
          entry.messageId = info.messageId;
          job.sent += 1;
          durations.push((Date.now() - t0) / 1000);
        }
        entry.elapsedMs = Date.now() - t0;
        entry.sentAt = new Date().toISOString();
      } catch (err) {
        entry.status = 'failed';
        entry.message = useGmail ? explainGmailError(err) : explainSmtpError(err);
        entry.elapsedMs = Date.now() - t0;
        job.failed += 1;
        if (!dryRun && !useGmail && /ECONNECTION|ETIMEDOUT|ESOCKET|EAUTH/.test(err?.code || '')) {
          try { transport?.close?.(); } catch { /* ignore */ }
          try { transport = makeTransport(smtp); } catch { transport = null; }
        }
      }
      job.processed += 1;
      job.entries.push(entry);
      emit(job, { type: 'entry', entry });
      if (!dryRun && delay > 0) await new Promise((r) => setTimeout(r, delay * 1000));
    }
  } finally {
    try { transport?.close?.(); } catch { /* ignore */ }
    job.status = job.cancelRequested ? 'cancelled' : 'done';
    job.current = null;
    job.finishedAt = new Date().toISOString();
    if (durations.length) {
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      recordDetectedDelay(Math.round((avg * 0.75 + 0.35) * 10) / 10);
    }
    appendHistory({
      jobId: job.id,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      dryRun: job.dryRun,
      total: job.total,
      sent: job.sent,
      failed: job.failed,
      skipped: job.skipped,
      status: job.status,
    });
    emit(job, { type: 'done' });
    job.listeners.clear();
  }
}

export function cancelCampaign(id) {
  const job = jobs.get(id);
  if (!job) return false;
  job.cancelRequested = true;
  return true;
}

export function subscribe(id, fn) {
  const job = jobs.get(id);
  if (!job) return () => {};
  job.listeners.add(fn);
  return () => job.listeners.delete(fn);
}

export function jobSnapshot(job) {
  return {
    id: job.id,
    status: job.status,
    dryRun: job.dryRun,
    transport: job.transport || (loadSettings().deliveryMode === 'gmail' ? 'gmail-api' : 'smtp'),
    total: job.total,
    processed: job.processed,
    sent: job.sent,
    failed: job.failed,
    skipped: job.skipped,
    current: job.current,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    entries: job.entries,
  };
}

export function campaignCsv(job) {
  const head = ['#', 'Vendor', 'To', 'CC', 'Status', 'Rows', 'Attachment', 'Attachment KB', 'Build ms', 'Elapsed ms', 'Message', 'Sent at'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [head.join(',')];
  job.entries.forEach((e) => {
    lines.push([
      e.index, e.vendor, (e.to || []).join('; '), (e.cc || []).join('; '), e.status, e.rows,
      e.attachment, e.attachmentKb, e.buildMs, e.elapsedMs, e.message, e.sentAt,
    ].map(esc).join(','));
  });
  return lines.join('\n');
}

export { getState };
