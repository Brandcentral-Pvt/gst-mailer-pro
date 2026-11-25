// JSON persistence for recipients, settings and campaign history.
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve('data');

function ensure() { fs.mkdirSync(DATA_DIR, { recursive: true }); }

export function readJson(name, fallback) {
  ensure();
  const file = path.join(DATA_DIR, name);
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(name, value) {
  ensure();
  const file = path.join(DATA_DIR, name);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export const DEFAULT_SETTINGS = {
  template: {
    subject: 'GST Reconciliation Statement & Transaction Details — {vendor_name}',
    greeting: 'Dear {vendor_name} Team,',
    intro: 'Please find below the summary of your GST records across {tab1_name} and {tab2_name}. '
      + 'The complete transaction-level workbook ({attachment_filename}) is attached, containing every '
      + 'record from both sheets for your review and necessary GST compliance action.',
    closing: 'Kindly review the attached statement and share your confirmation or reconciliation remarks at the earliest.\n\nWarm regards,\nAccounts & GST Reconciliation Team',
    includeStatusBreakdown: true,
    includeGstin: true,
    // the mail body carries the real transaction rows, not just totals
    includeRows: true,
    bodyRowLimit: 100,
    // attachment = plain copy of the uploaded sheet (no banner, no TOTAL row)
    attachmentMode: 'exact',
  },
  // 'smtp' = app password over SMTP, 'gmail' = Gmail API via OAuth 2.0
  deliveryMode: 'smtp',
  gmail: {
    clientId: '',
    clientSecret: '',
    redirectUri: '',
    refreshToken: '',
    accountEmail: '',
    workspace: false,      // Workspace accounts get a 2000/day limit instead of 500
  },
  smtp: {
    provider: 'gmail',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    username: '',
    password: '',
    senderName: 'GST Accounts Team',
    senderEmail: '',
    replyTo: '',
    globalCc: '',
    globalBcc: '',
    delaySeconds: 1.2,
    detectedDelay: 1.2,
    delayUserSet: false,
  },
};

export function loadSettings() {
  const raw = readJson('settings.json', {});
  const smtp = { ...DEFAULT_SETTINGS.smtp, ...(raw.smtp || {}) };
  if (!raw.smtp?.delayUserSet) smtp.delaySeconds = Number(raw.smtp?.detectedDelay) || DEFAULT_SETTINGS.smtp.delaySeconds;
  return {
    template: { ...DEFAULT_SETTINGS.template, ...(raw.template || {}) },
    smtp,
    deliveryMode: raw.deliveryMode === 'gmail' ? 'gmail' : 'smtp',
    gmail: { ...DEFAULT_SETTINGS.gmail, ...(raw.gmail || {}) },
  };
}

export function saveSettings(patch = {}) {
  const raw = readJson('settings.json', {});
  const current = {
    smtp: { ...(raw.smtp || {}) },
    template: { ...(raw.template || {}) },
    deliveryMode: raw.deliveryMode === 'gmail' ? 'gmail' : 'smtp',
    gmail: { ...(raw.gmail || {}) },
  };
  if (patch.deliveryMode) current.deliveryMode = patch.deliveryMode === 'gmail' ? 'gmail' : 'smtp';
  if (patch.gmail && typeof patch.gmail === 'object') {
    const g = { ...patch.gmail };
    // masked secrets must never overwrite a real stored value
    for (const key of ['clientSecret', 'refreshToken']) {
      if (g[key] === '••••••••') delete g[key];
      else if (g[key] !== undefined && !String(g[key]).trim()) delete g[key];
    }
    current.gmail = { ...current.gmail, ...g };
    if ('workspace' in g) current.gmail.workspace = Boolean(g.workspace);
  }
  if (patch.template && typeof patch.template === 'object') {
    current.template = { ...current.template, ...patch.template };
  }
  if (patch.smtp && typeof patch.smtp === 'object') {
    const incoming = { ...patch.smtp };
    const pass = incoming.password;
    delete incoming.password;
    if (pass && String(pass).trim() && pass !== '••••••••') current.smtp.password = String(pass).trim();
    if ('delaySeconds' in incoming) {
      current.smtp.delayUserSet = true;
      current.smtp.detectedDelay = Number(incoming.delaySeconds) || current.smtp.detectedDelay;
    }
    current.smtp = { ...current.smtp, ...incoming };
  }
  writeJson('settings.json', current);
  return loadSettings();
}

export function publicSettings() {
  const s = loadSettings();
  const configured = Boolean(s.smtp.username && s.smtp.password);
  const gmailReady = Boolean(s.gmail.clientId && s.gmail.clientSecret && s.gmail.refreshToken);
  return {
    ...s,
    smtp: { ...s.smtp, password: s.smtp.password ? '••••••••' : '', configured },
    gmail: {
      ...s.gmail,
      clientSecret: s.gmail.clientSecret ? '••••••••' : '',
      refreshToken: s.gmail.refreshToken ? '••••••••' : '',
      configured: gmailReady,
      hasCredentials: Boolean(s.gmail.clientId && s.gmail.clientSecret),
    },
  };
}

export function recordDetectedDelay(seconds) {
  const raw = readJson('settings.json', {});
  raw.smtp = { ...(raw.smtp || {}) };
  raw.smtp.detectedDelay = Math.round(Math.min(8, Math.max(0.6, Number(seconds) || 1.2)) * 10) / 10;
  writeJson('settings.json', raw);
}

export function loadRecipients() { return readJson('recipients.json', {}); }

export function saveRecipients(map) { writeJson('recipients.json', map); }

export function appendHistory(record) {
  const list = readJson('history.json', []);
  list.unshift(record);
  writeJson('history.json', list.slice(0, 40));
}

export function loadHistory() { return readJson('history.json', []); }
