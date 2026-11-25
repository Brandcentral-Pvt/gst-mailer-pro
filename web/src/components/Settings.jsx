import React, { useEffect, useState } from 'react';
import {
  Mail, KeyRound, Server, ShieldCheck, Send, Eye, EyeOff, Sparkles, CheckCircle2, AlertTriangle, MailCheck,
  Cloud, Link2, Unplug, ExternalLink, Zap,
} from 'lucide-react';
import api from '../lib/api';
import { Drawer, Badge, Spinner } from './ui';
import { cls } from '../lib/format';

const PRESETS = {
  gmail: { host: 'smtp.gmail.com', port: 587, secure: false },
  outlook: { host: 'smtp.office365.com', port: 587, secure: false },
  zoho: { host: 'smtp.zoho.com', port: 587, secure: false },
  custom: null,
};

export default function Settings({ open, onClose, settings, onSaved, toast, initialTab }) {
  const [tab, setTab] = useState(initialTab || 'smtp');
  const [form, setForm] = useState(null);
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [gmailResult, setGmailResult] = useState(null);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    if (!open || !settings) return;
    const password = settings.smtp.password === '••••••••' ? '' : settings.smtp.password;
    setForm({
      smtp: {
        provider: 'gmail', host: 'smtp.gmail.com', port: 587, secure: false,
        username: '', senderName: '', senderEmail: '', replyTo: '',
        globalCc: '', globalBcc: '', delaySeconds: 1.2,
        ...settings.smtp,
        password,
      },
      template: { ...settings.template },
      deliveryMode: settings.deliveryMode || 'smtp',
      gmail: {
        clientId: '', refreshToken: '', accountEmail: '',
        redirectUri: '', workspace: false,
        ...(settings.gmail || {}),
        // the server masks the secret; a blank box means "keep the saved one"
        clientSecret: settings.gmail?.clientSecret === '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' ? '' : (settings.gmail?.clientSecret || ''),
      },
    });
    setTestResult(null);
    setGmailResult(null);
    if (initialTab) setTab(initialTab);
  }, [open, settings, initialTab]);

  if (!form) return null;
  const set = (group, key, value) => setForm((f) => ({ ...f, [group]: { ...f[group], [key]: value } }));

  function applyPreset(provider) {
    set('smtp', 'provider', provider);
    const p = PRESETS[provider];
    if (p) {
      setForm((f) => ({ ...f, smtp: { ...f.smtp, provider, ...p } }));
    }
  }

  async function save() {
    setBusy(true);
    try {
      const payload = {
        smtp: { ...form.smtp },
        template: { ...form.template },
        deliveryMode: form.deliveryMode,
        gmail: { ...form.gmail },
      };
      if (!payload.smtp.password) delete payload.smtp.password;
      if (!payload.gmail.clientSecret) delete payload.gmail.clientSecret;
      if (!payload.gmail.refreshToken) delete payload.gmail.refreshToken;
      const saved = await api.post('/api/settings', payload);
      onSaved(saved);
      toast({ tone: 'ok', title: 'Settings saved', body: 'SMTP and email template updated.' });
      onClose();
    } catch (e) {
      toast({ tone: 'err', title: 'Save failed', body: e.message });
    } finally { setBusy(false); }
  }

  async function testConn() {
    setBusy(true); setTestResult(null);
    try {
      const payload = { smtp: { ...form.smtp } };
      if (!payload.smtp.password) delete payload.smtp.password;
      await api.post('/api/settings', payload);
      const res = await api.post('/api/smtp/test');
      setTestResult(res);
      toast({ tone: res.ok ? 'ok' : 'err', title: res.ok ? 'SMTP connected' : 'SMTP failed', body: res.message });
    } catch (e) {
      setTestResult({ ok: false, message: e.message });
    } finally { setBusy(false); }
  }

  async function testMail() {
    setBusy(true); setTestResult(null);
    try {
      const payload = { smtp: { ...form.smtp } };
      if (!payload.smtp.password) delete payload.smtp.password;
      await api.post('/api/settings', payload);
      const to = form.smtp.senderEmail || form.smtp.username;
      const res = await api.post('/api/smtp/test-email', { to });
      setTestResult(res);
      toast({ tone: res.ok ? 'ok' : 'err', title: res.ok ? 'Test email sent' : 'Test email failed', body: res.message });
    } catch (e) {
      setTestResult({ ok: false, message: e.message });
    } finally { setBusy(false); }
  }

  async function saveTransport(extra = {}) {
    const payload = {
      smtp: { ...form.smtp },
      template: { ...form.template },
      deliveryMode: form.deliveryMode,
      gmail: { ...form.gmail },
      ...extra,
    };
    if (!payload.smtp.password) delete payload.smtp.password;
    if (!payload.gmail.clientSecret) delete payload.gmail.clientSecret;
    if (!payload.gmail.refreshToken) delete payload.gmail.refreshToken;
    return api.post('/api/settings', payload);
  }

  async function connectGmail() {
    setBusy(true); setGmailResult(null);
    try {
      await saveTransport({ deliveryMode: 'gmail' });
      const { url } = await api.get('/api/oauth/google/url');
      window.location.href = url;
    } catch (e) {
      setGmailResult({ ok: false, message: e.message });
      setBusy(false);
    }
  }

  async function testGmail() {
    setBusy(true); setGmailResult(null);
    try {
      await saveTransport();
      const res = await api.post('/api/gmail/test');
      setGmailResult(res);
      toast({ tone: res.ok ? 'ok' : 'err', title: res.ok ? 'Gmail API connected' : 'Gmail API not connected', body: res.message });
    } catch (e) {
      setGmailResult({ ok: false, message: e.message });
    } finally { setBusy(false); }
  }

  async function testGmailMail() {
    setBusy(true); setGmailResult(null);
    try {
      await saveTransport();
      const to = form.gmail.accountEmail || form.smtp.senderEmail;
      const res = await api.post('/api/gmail/test-email', { to });
      setGmailResult(res);
      toast({ tone: res.ok ? 'ok' : 'err', title: res.ok ? 'Test email sent via Gmail API' : 'Test email failed', body: res.message });
    } catch (e) {
      setGmailResult({ ok: false, message: e.message });
    } finally { setBusy(false); }
  }

  async function disconnectGmail() {
    setBusy(true);
    try {
      const saved = await api.post('/api/gmail/disconnect');
      onSaved(saved);
      setForm((f) => ({ ...f, deliveryMode: 'smtp', gmail: { ...f.gmail, refreshToken: '', accountEmail: '' } }));
      setGmailResult({ ok: false, message: 'Gmail disconnected. The app is back on SMTP.' });
      toast({ tone: 'ok', title: 'Gmail disconnected', body: 'Access token cleared; you can revoke the app in your Google Account too.' });
    } catch (e) {
      setGmailResult({ ok: false, message: e.message });
    } finally { setBusy(false); }
  }

  const smtp = form.smtp;
  const gm = form.gmail;
  const gmailConnected = Boolean(settings.gmail?.configured || gm.refreshToken);
  const mode = form.deliveryMode;

  return (
    <Drawer
      open={open} onClose={onClose} width="max-w-2xl"
      title="Delivery & email template"
      subtitle={mode === 'gmail'
        ? 'Sending through the Gmail API with OAuth 2.0 — no app password needed.'
        : 'SMTP with an app password. Switch to the Gmail API tab for OAuth delivery.'}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? <Spinner /> : <ShieldCheck className="h-4 w-4" />} Save settings
        </button>
      </>}
    >
      <div className="mb-4 inline-flex rounded-xl bg-ink-100/80 p-1">
        {[['smtp', 'SMTP', Server], ['gmail', 'Gmail API', Cloud], ['template', 'Email template', Sparkles]].map(([key, label, Icon]) => (
          <button key={key} onClick={() => setTab(key)}
            className={cls('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition',
              tab === key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800')}>
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      <div className={cls('mb-4 flex items-center gap-2.5 rounded-xl border p-3 text-[12px]',
        mode === 'gmail' ? 'border-brand-500/25 bg-brand-50/70 text-brand-800' : 'border-ink-100 bg-ink-50/70 text-ink-600')}>
        {mode === 'gmail' ? <Cloud className="h-4 w-4 shrink-0" /> : <Server className="h-4 w-4 shrink-0" />}
        <span>
          <b>Active transport: {mode === 'gmail' ? 'Gmail API (OAuth 2.0)' : 'SMTP'}</b>
          {' · '}
          {mode === 'gmail'
            ? (gmailConnected ? `connected as ${gm.accountEmail || 'your account'}` : 'not connected yet — finish setup in the Gmail API tab')
            : (settings.smtp.configured ? `authenticated as ${smtp.username || smtp.senderEmail || 'saved account'}` : 'no credentials saved yet')}
        </span>
        <button className="btn ml-auto !py-1 !text-[11px]" onClick={() => setForm((f) => ({ ...f, deliveryMode: mode === 'gmail' ? 'smtp' : 'gmail' }))}>
          Switch to {mode === 'gmail' ? 'SMTP' : 'Gmail API'}
        </button>
      </div>

      {tab === 'smtp' ? (
        <div className="space-y-3">
          <label className="block">
            <span className="label">Provider preset</span>
            <select className="select" value={smtp.provider} onChange={(e) => applyPreset(e.target.value)}>
              <option value="gmail">Gmail · smtp.gmail.com · 587 STARTTLS</option>
              <option value="outlook">Outlook / Microsoft 365 · 587</option>
              <option value="zoho">Zoho Mail · 587</option>
              <option value="custom">Custom SMTP</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">SMTP host</span>
              <input className="input" value={smtp.host} onChange={(e) => set('smtp', 'host', e.target.value)} placeholder="smtp.gmail.com" />
            </label>
            <label className="block">
              <span className="label">Port</span>
              <input className="input" type="number" value={smtp.port} onChange={(e) => set('smtp', 'port', Number(e.target.value))} />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Encryption</span>
              <select className="select" value={smtp.secure ? 'ssl' : 'tls'} onChange={(e) => {
                const ssl = e.target.value === 'ssl';
                setForm((f) => ({ ...f, smtp: { ...f.smtp, secure: ssl, port: ssl ? 465 : 587 } }));
              }}>
                <option value="tls">STARTTLS (587)</option>
                <option value="ssl">SSL (465)</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Delay per vendor (s)</span>
              <input className="input" type="number" step="0.1" min="0" value={smtp.delaySeconds}
                onChange={(e) => set('smtp', 'delaySeconds', Number(e.target.value))} />
            </label>
          </div>

          <div className="rounded-xl border border-ink-100 bg-ink-50/60 p-3">
            <p className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.08em] text-ink-400">
              <KeyRound className="h-3.5 w-3.5" /> Credentials
            </p>
            <div className="space-y-3">
              <label className="block">
                <span className="label">SMTP username</span>
                <input className="input" value={smtp.username} autoComplete="off" onChange={(e) => set('smtp', 'username', e.target.value)} placeholder="youraddress@gmail.com" />
              </label>
              <label className="block">
                <span className="label">App password</span>
                <div className="relative">
                  <input className="input pr-10" type={showPass ? 'text' : 'password'} value={smtp.password} autoComplete="new-password"
                    onChange={(e) => set('smtp', 'password', e.target.value)}
                    placeholder={settings.smtp.configured ? 'Saved — leave blank to keep current password' : '16-character Gmail App Password'} />
                  <button type="button" onClick={() => setShowPass((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-ink-400">Google Account → Security → 2-Step Verification → App passwords.</p>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="label">From name</span>
              <input className="input" value={smtp.senderName} onChange={(e) => set('smtp', 'senderName', e.target.value)} placeholder="GST Accounts Team" /></label>
            <label className="block"><span className="label">From email</span>
              <input className="input" value={smtp.senderEmail} onChange={(e) => set('smtp', 'senderEmail', e.target.value)} placeholder="accounts@yourcompany.com" /></label>
          </div>
          <label className="block"><span className="label">Reply-To (optional)</span>
            <input className="input" value={smtp.replyTo} onChange={(e) => set('smtp', 'replyTo', e.target.value)} placeholder="gst@yourcompany.com" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="label">Global CC</span>
              <input className="input" value={smtp.globalCc} onChange={(e) => set('smtp', 'globalCc', e.target.value)} placeholder="compliance@yourcompany.com" /></label>
            <label className="block"><span className="label">Global BCC</span>
              <input className="input" value={smtp.globalBcc} onChange={(e) => set('smtp', 'globalBcc', e.target.value)} placeholder="archive@yourcompany.com" /></label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={testConn} disabled={busy}><Server className="h-4 w-4" /> Test connection</button>
            <button className="btn" onClick={testMail} disabled={busy}><MailCheck className="h-4 w-4" /> Send test email to me</button>
          </div>

          {testResult && (
            <div className={cls('flex items-start gap-2 rounded-xl border p-3 text-[12px]',
              testResult.ok ? 'border-emerald-500/20 bg-mint-100/60 text-emerald-700' : 'border-rose-500/20 bg-rose-100/60 text-rose-600')}>
              {testResult.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>{testResult.message}{testResult.latencyMs ? ` (${testResult.latencyMs} ms)` : ''}</span>
            </div>
          )}

          <div className="rounded-xl border border-brand-500/15 bg-brand-50/60 p-3 text-[11.5px] text-brand-800">
            <b>Live mode:</b> the send button refuses to run until a username and password are saved — dry runs still build every attachment.
            {mode === 'gmail' && ' Sending currently uses the Gmail API, so these SMTP credentials are kept only as a fallback.'}
          </div>
        </div>
      ) : tab === 'gmail' ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-brand-500/20 bg-brand-50/40 p-3.5">
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.08em] text-brand-700">
              <Zap className="h-3.5 w-3.5" /> One-time Google Cloud setup
            </p>
            <ol className="ml-4 list-decimal space-y-1 text-[11.5px] leading-relaxed text-ink-600">
              <li>Go to <a className="font-semibold text-brand-700 underline" href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noreferrer">Google Cloud Console → Gmail API</a> and press <b>Enable</b>.</li>
              <li>Configure the <b>OAuth consent screen</b> (External) and add your own Gmail address as a <b>Test user</b>.</li>
              <li><b>Credentials → Create credentials → OAuth client ID → Web application</b>.</li>
              <li>Add this exact <b>Authorised redirect URI</b>:
                <code className="mt-1 block break-all rounded-md bg-white px-2 py-1 font-mono text-[11px] text-ink-700 ring-1 ring-ink-100">
                  {gm.redirectUri || `${window.location.origin}/api/oauth/google/callback`}
                </code>
              </li>
              <li>Paste the Client ID and Client Secret below, press <b>Save</b>, then <b>Connect Gmail</b>.</li>
            </ol>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <label className="block">
              <span className="label">OAuth Client ID</span>
              <input className="input font-mono !text-[11.5px]" value={gm.clientId}
                onChange={(e) => set('gmail', 'clientId', e.target.value)}
                placeholder="1234567890-abcdefg.apps.googleusercontent.com" />
            </label>
            <label className="block">
              <span className="label">OAuth Client Secret</span>
              <div className="relative">
                <input className="input pr-10 font-mono !text-[11.5px]" type={showSecret ? 'text' : 'password'} value={gm.clientSecret}
                  autoComplete="new-password"
                  onChange={(e) => set('gmail', 'clientSecret', e.target.value)}
                  placeholder={settings.gmail?.clientSecret ? 'Saved — leave blank to keep the current secret' : 'GOCSPX-…'} />
                <button type="button" onClick={() => setShowSecret((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>
            <label className="block">
              <span className="label">Redirect URI (leave blank to auto-detect this host)</span>
              <input className="input font-mono !text-[11.5px]" value={gm.redirectUri}
                onChange={(e) => set('gmail', 'redirectUri', e.target.value)}
                placeholder={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/oauth/google/callback`} />
            </label>
            <label className="block">
              <span className="label">Sender Gmail address (From)</span>
              <input className="input" value={gm.accountEmail}
                onChange={(e) => set('gmail', 'accountEmail', e.target.value)}
                placeholder="accounts@yourcompany.com" />
              <p className="mt-1 text-[11px] text-ink-400">Auto-filled after you connect. Must be the same account (or a Workspace alias) that granted access.</p>
            </label>
            <label className="flex items-start gap-2.5 rounded-xl border border-ink-100 p-3">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={Boolean(gm.workspace)}
                onChange={(e) => set('gmail', 'workspace', e.target.checked)} />
              <span className="text-[12px] text-ink-700">
                <b>Google Workspace account</b>
                <span className="block text-[11px] text-ink-400">Raises the daily sending limit from 500 to 2,000 emails and the per-minute limit from 100 to 1,800.</span>
              </span>
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            {!gmailConnected ? (
              <button className="btn btn-primary" onClick={connectGmail} disabled={busy || !gm.clientId || !gm.clientSecret}>
                {busy ? <Spinner /> : <Link2 className="h-4 w-4" />} Connect Gmail
              </button>
            ) : (
              <>
                <button className="btn" onClick={testGmail} disabled={busy}><Cloud className="h-4 w-4" /> Test connection</button>
                <button className="btn" onClick={testGmailMail} disabled={busy}><MailCheck className="h-4 w-4" /> Send test email</button>
                <button className="btn" onClick={connectGmail} disabled={busy}><Link2 className="h-4 w-4" /> Reconnect</button>
                <button className="btn !text-rose-600" onClick={disconnectGmail} disabled={busy}><Unplug className="h-4 w-4" /> Disconnect</button>
              </>
            )}
          </div>

          {gmailConnected && (
            <div className="rounded-xl border border-emerald-500/20 bg-mint-100/50 p-3 text-[12px] text-emerald-700">
              <CheckCircle2 className="mr-1 inline h-4 w-4 shrink-0" />
              Connected{gm.accountEmail ? ` as ${gm.accountEmail}` : ''}. Daily limit: {gm.workspace ? '2,000' : '500'} emails
              (Google per-user quota){gm.workspace ? ', per-minute 1,800' : ', per-minute 100'}.
            </div>
          )}

          {gmailResult && (
            <div className={cls('flex items-start gap-2 rounded-xl border p-3 text-[12px]',
              gmailResult.ok ? 'border-emerald-500/20 bg-mint-100/60 text-emerald-700' : 'border-rose-500/20 bg-rose-100/60 text-rose-600')}>
              {gmailResult.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>{gmailResult.message}{gmailResult.latencyMs ? ` (${gmailResult.latencyMs} ms)` : ''}</span>
            </div>
          )}

          <div className="rounded-xl border border-ink-100 bg-ink-50/60 p-3 text-[11.5px] leading-relaxed text-ink-500">
            <b className="text-ink-700">Why prefer this?</b> OAuth access is revocable from your Google Account at any time,
            it works even when the org blocks app passwords, and Google returns precise quota errors instead of a silent stall.
            The email itself — template, all columns, exact-copy Excel attachment — is identical on both transports.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block"><span className="label">Subject</span>
            <input className="input" value={form.template.subject} onChange={(e) => set('template', 'subject', e.target.value)} /></label>
          <label className="block"><span className="label">Greeting</span>
            <input className="input" value={form.template.greeting} onChange={(e) => set('template', 'greeting', e.target.value)} /></label>
          <label className="block">
            <span className="label">Intro paragraph</span>
            <textarea className="textarea !font-sans !text-[12.5px] min-h-[120px]" value={form.template.intro}
              onChange={(e) => set('template', 'intro', e.target.value)} />
            <p className="mt-1 font-mono text-[10.5px] text-ink-400">{'{vendor_name} · {tab1_name} · {tab2_name} · {attachment_filename}'}</p>
          </label>
          <label className="block">
            <span className="label">Closing</span>
            <textarea className="textarea !font-sans !text-[12.5px] min-h-[100px]" value={form.template.closing}
              onChange={(e) => set('template', 'closing', e.target.value)} />
          </label>
          <label className="flex items-center gap-2.5 rounded-xl border border-ink-100 p-3">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={form.template.includeStatusBreakdown !== false}
              onChange={(e) => set('template', 'includeStatusBreakdown', e.target.checked)} />
            <span className="text-[12.5px] font-semibold text-ink-700">Include match-status breakdown in the email</span>
          </label>

          <div className="rounded-xl border border-brand-500/20 bg-brand-50/40 p-3 space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-[.08em] text-brand-700">Actual transaction rows in the body</p>
            <label className="flex items-center gap-2.5">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={form.template.includeRows !== false}
                onChange={(e) => set('template', 'includeRows', e.target.checked)} />
              <span className="text-[12.5px] font-semibold text-ink-700">Show the actual rows (not only totals)</span>
            </label>
            <label className="block">
              <span className="label !mb-1">Rows per sheet in the mail</span>
              <select className="select !py-1.5 !text-[12px]" value={form.template.bodyRowLimit ?? 100}
                disabled={form.template.includeRows === false}
                onChange={(e) => set('template', 'bodyRowLimit', Number(e.target.value))}>
                {[25, 50, 100, 200, 500].map((n) => <option key={n} value={n}>First {n} rows</option>)}
              </select>
              <p className="mt-1 text-[11px] text-ink-400">Every remaining row is always in the attachment.</p>
            </label>
          </div>

          <div className="rounded-xl border border-brand-500/20 bg-brand-50/40 p-3 space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-[.08em] text-brand-700">Excel attachment</p>
            <select className="select !py-1.5 !text-[12px]" value={form.template.attachmentMode || 'exact'}
              onChange={(e) => set('template', 'attachmentMode', e.target.value)}>
              <option value="exact">Exact copy of the uploaded sheet (original columns, no totals)</option>
              <option value="formatted">Formatted statement (banner + totals + Summary sheet)</option>
            </select>
            <p className="text-[11px] text-ink-400">Exact copy keeps the sheet's own column names and every row, nothing added.</p>
          </div>
        </div>
      )}
    </Drawer>
  );
}
