// Proves campaign.js routes through the Gmail API when deliveryMode='gmail',
// and through SMTP when deliveryMode='smtp'. googleapis and nodemailer are
// stubbed, so nothing touches the network.
import { google } from 'googleapis';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- stubs -------------------------------------------------------------
const gmailCalls = [];
const smtpCalls = [];
google.gmail = () => ({
  users: {
    messages: {
      send: async ({ requestBody }) => {
        gmailCalls.push(requestBody.raw);
        return { data: { id: `stub-gmail-${gmailCalls.length}`, threadId: 't1' } };
      },
    },
    getProfile: async () => ({ data: { emailAddress: 'accounts@example.com' } }),
  },
});

const realCreateTransport = nodemailer.createTransport;
nodemailer.createTransport = () => ({
  verify: async () => true,
  close: () => {},
  sendMail: async (msg) => {
    smtpCalls.push(msg);
    return { messageId: `stub-smtp-${smtpCalls.length}` };
  },
});

// ---- environment -------------------------------------------------------
const store = await import(path.join(root, 'server/store.js'));
const dataset = await import(path.join(root, 'server/dataset.js'));
const campaign = await import(path.join(root, 'server/campaign.js'));
const { loadSettings } = store;

const wb = path.join(root, 'data/workbook/session.xlsx');
if (!fs.existsSync(wb)) { console.log('SKIP — no workbook'); process.exit(0); }
const sess = JSON.parse(fs.readFileSync(path.join(root, 'data/session.json'), 'utf8'));
await dataset.loadWorkbook({ filePath: wb, filename: sess.filename, fileId: 'test', tabConfigs: sess.tabConfigs });

const fileSettings = loadSettings();
// snapshot the raw file, not the merged view, so restore is exact
const rawSettingsFile = path.join(root, 'data/settings.json');
const rawSettingsBackup = JSON.parse(fs.readFileSync(rawSettingsFile, 'utf8'));
const savedSettings = fileSettings;   // in-memory baseline used for each saveSettings() call
const savedRecipients = store.loadRecipients();
fs.mkdirSync(path.join(root, 'data/attachments'), { recursive: true });

function waitFor(jobId, ms = 180000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const st = campaign.getJob(jobId);
      if (!st) return reject(new Error('job not found'));
      if (st.status !== 'running') return resolve(st);
      if (Date.now() - t0 > ms) return reject(new Error('timeout'));
      setTimeout(tick, 300);
    };
    tick();
  });
}

const vendor = (() => {
  const list = dataset.getVendorList();
  const v = list.find((x) => /DEELMO/i.test(x.name)) || list[0];
  return v.vendor;
})();
console.log(`vendor: ${vendor}`);

store.saveRecipients({ [vendor]: ['vendor-test@example.com'] });

try {
  // ---------- 1. Gmail API mode ----------
  store.saveSettings({
    ...savedSettings,
    deliveryMode: 'gmail',
    gmail: {
      clientId: 'cid.apps.googleusercontent.com',
      clientSecret: 'secret',
      refreshToken: 'refresh',
      accountEmail: 'accounts@example.com',
      workspace: true,
    },
    smtp: { ...savedSettings.smtp, senderName: 'GST Accounts', senderEmail: 'accounts@example.com', replyTo: 'gst@example.com', globalCc: '', globalBcc: 'audit@example.com', delaySeconds: 0 },
  });

  const g1 = campaign.startCampaign({ vendors: [{ vendor, to: ['vendor-test@example.com'], cc: [], rows: 0 }], dryRun: false });
  const gmailJob = await waitFor(g1.id);
  assert.equal(gmailJob.transport, 'gmail-api', 'job should report gmail-api');
  assert.equal(gmailJob.sent, 1, `sent=${gmailJob.sent} failed=${gmailJob.failed}: ${gmailJob.entries.map((e) => e.message).join(' | ')}`);
  assert.equal(smtpCalls.length, 0, 'SMTP must not be touched in gmail mode');
  assert.equal(gmailCalls.length, 1);

  const mime = Buffer.from(gmailCalls[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  assert.ok(mime.includes('To: vendor-test@example.com'), 'recipient in MIME');
  assert.ok(mime.includes('Bcc: audit@example.com'), 'global Bcc in MIME');
  assert.ok(mime.includes('Reply-To: gst@example.com'), 'reply-to in MIME');
  assert.ok(mime.includes('From: GST Accounts <accounts@example.com>'), 'From name/address');
  assert.ok(/Content-Disposition: attachment; filename="GST_Statement_DEELMO/i.test(mime) || /Content-Disposition: attachment; filename="[^"]+\.xlsx"/i.test(mime), 'xlsx attachment present');
  const attBlock = mime.split('\r\n--').find((b) => b.includes('.xlsx') && b.includes('Content-Disposition: attachment'));
  assert.ok(attBlock, 'attachment part found');
  const attBytes = Buffer.from(attBlock.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').length;
  assert.ok(attBytes > 1000, `attachment decoded to ${attBytes} bytes`);
  console.log(`PASS gmail  — 1 sent via Gmail API, MIME ${(mime.length / 1024).toFixed(1)} KB, attachment ${(attBytes / 1024).toFixed(1)} KB, SMTP untouched`);

  // ---------- 2. SMTP mode ----------
  store.saveSettings({
    ...savedSettings,
    deliveryMode: 'smtp',
    smtp: { ...savedSettings.smtp, username: 'accounts@gmail.com', password: 'app-password', senderName: 'GST Accounts', senderEmail: 'accounts@example.com', delaySeconds: 0 },
  });
  const g2 = campaign.startCampaign({ vendors: [{ vendor, to: ['vendor-test@example.com'], cc: [], rows: 0 }], dryRun: false });
  const smtpJob = await waitFor(g2.id);
  assert.equal(smtpJob.transport, 'smtp');
  assert.equal(smtpJob.sent, 1, `smtp failed: ${smtpJob.entries.map((e) => e.message).join(' | ')}`);
  assert.equal(smtpCalls.length, 1, 'SMTP transport used exactly once');
  assert.equal(gmailCalls.length, 1, 'Gmail API not called in smtp mode');
  assert.ok(smtpCalls[0].attachments?.[0]?.path, 'SMTP path uses a file path attachment');
  console.log(`PASS smtp   — 1 sent via SMTP, ${path.basename(smtpCalls[0].attachments[0].path)} attached from disk`);

  // ---------- 3. dry run in gmail mode never sends ----------
  store.saveSettings({ ...savedSettings, deliveryMode: 'gmail', gmail: { clientId: 'c', clientSecret: 's', refreshToken: 'r', accountEmail: 'accounts@example.com' } });
  const g3 = campaign.startCampaign({ vendors: [{ vendor, to: ['vendor-test@example.com'], cc: [], rows: 0 }], dryRun: true });
  const dryJob = await waitFor(g3.id);
  assert.equal(dryJob.skipped, 1);
  assert.equal(gmailCalls.length, 1, 'dry run must not call Gmail');
  assert.equal(smtpCalls.length, 1, 'dry run must not call SMTP');
  console.log('PASS dryrun — attachment built, no transport invoked');
} finally {
  fs.writeFileSync(rawSettingsFile, JSON.stringify(rawSettingsBackup, null, 2));
  store.saveRecipients(savedRecipients);
  nodemailer.createTransport = realCreateTransport;
}

console.log('\nALL CAMPAIGN TRANSPORT CHECKS PASSED');
