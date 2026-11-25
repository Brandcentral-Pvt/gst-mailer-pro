// Gmail API delivery (OAuth 2.0) — an alternative to SMTP.
//
// Why this is better than SMTP for bulk vendor mail:
//   · OAuth token instead of a 16-char app password (works even when the org
//     blocks less-secure app passwords)
//   · revoke the app's access from the Google Account at any time
//   · per-user quota is tracked, so a run cannot silently stall
//   · structured error codes (RATE_LIMIT_EXCEEDED, QUOTA_EXCEEDED, …)
//
// One-time Google Cloud setup (the UI walks through this):
//   1. console.cloud.google.com -> new project -> APIs & Services -> enable "Gmail API"
//   2. OAuth consent screen -> External -> add yourself as a test user
//   3. Credentials -> Create credentials -> OAuth client ID -> Web application
//   4. Authorised redirect URI: <APP_URL>/api/oauth/google/callback
//   5. Paste Client ID + Client Secret into Settings -> Gmail API -> Save,
//      then click "Connect Gmail" and approve access.

import { google } from 'googleapis';
import { randomUUID } from 'crypto';

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

/** Build an OAuth2 client from stored settings. */
export function oauthClient(gmail = {}) {
  return new google.auth.OAuth2(
    gmail.clientId || '',
    gmail.clientSecret || '',
    gmail.redirectUri || '',
  );
}

export function gmailAuthUrl(gmail, state) {
  const client = oauthClient(gmail);
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // forces a refresh_token even on re-consent
    scope: GMAIL_SCOPES,
    state,
    include_granted_scopes: true,
  });
}

export async function exchangeCode(gmail, code) {
  const client = oauthClient(gmail);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  let email = '';
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const me = await oauth2.userinfo.get();
    email = me.data?.email || '';
  } catch { /* email is a nicety, not required */ }
  return { tokens, email };
}

/** Is the stored credential usable? Returns { ok, message, email } without sending. */
export async function checkGmailAuth(gmail = {}) {
  if (!gmail.clientId || !gmail.clientSecret) {
    return { ok: false, message: 'Add the OAuth Client ID and Client Secret from Google Cloud first.' };
  }
  if (!gmail.refreshToken) {
    return { ok: false, message: 'Not connected yet - click "Connect Gmail" and approve access.' };
  }
  try {
    const client = oauthClient(gmail);
    client.setCredentials({ refresh_token: gmail.refreshToken });
    const gmailApi = google.gmail({ version: 'v1', auth: client });
    const profile = await gmailApi.users.getProfile({ userId: 'me' });
    return {
      ok: true,
      email: profile.data?.emailAddress || gmail.accountEmail || '',
      messagesTotal: profile.data?.messagesTotal,
      threadsTotal: profile.data?.threadsTotal,
      message: `Connected as ${profile.data?.emailAddress || 'your account'}.`,
    };
  } catch (err) {
    return { ok: false, message: explainGmailError(err) };
  }
}

/** Base64url encode for the Gmail raw payload. */
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RFC 2047 for non-ASCII (rupee sign in subjects, accented vendor names). */
function encodeHeader(value) {
  if (!value) return '';
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function wrap76(str) {
  const out = [];
  for (let i = 0; i < str.length; i += 76) out.push(str.slice(i, i + 76));
  return out.join('\r\n');
}

/**
 * Build an RFC 2822 message with html + text + a binary attachment.
 * Hand-written so there is no extra dependency.
 */
export function buildMime({
  from, fromName, to = [], cc = [], bcc = [], replyTo,
  subject, text, html, attachment,
}) {
  const boundary = `----gstmailer_${randomUUID().replace(/-/g, '')}`;
  const altBoundary = `----gstmailer_alt_${randomUUID().replace(/-/g, '')}`;
  const domain = String(from || 'mail.gmail.com').split('@')[1] || 'gmail.com';
  const messageId = `<${randomUUID()}@${domain}>`;
  const headers = [];
  const fromHeader = fromName ? `${encodeHeader(fromName)} <${from}>` : `<${from}>`;

  headers.push(`From: ${fromHeader}`);
  headers.push(`To: ${to.join(', ')}`);
  if (cc.length) headers.push(`Cc: ${cc.join(', ')}`);
  if (bcc.length) headers.push(`Bcc: ${bcc.join(', ')}`);
  if (replyTo) headers.push(`Reply-To: ${replyTo}`);
  headers.push(`Subject: ${encodeHeader(subject)}`);
  headers.push(`Message-ID: ${messageId}`);
  headers.push('MIME-Version: 1.0');
  headers.push(`Date: ${new Date().toUTCString()}`);
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  headers.push('');

  const parts = [];
  parts.push(`--${boundary}`);
  parts.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
  parts.push('');
  parts.push(`--${altBoundary}`);
  parts.push('Content-Type: text/plain; charset="UTF-8"');
  parts.push('Content-Transfer-Encoding: base64');
  parts.push('');
  parts.push(wrap76(Buffer.from(text || '', 'utf8').toString('base64')));
  parts.push('');
  parts.push(`--${altBoundary}`);
  parts.push('Content-Type: text/html; charset="UTF-8"');
  parts.push('Content-Transfer-Encoding: base64');
  parts.push('');
  parts.push(wrap76(Buffer.from(html || '', 'utf8').toString('base64')));
  parts.push('');
  parts.push(`--${altBoundary}--`);

  if (attachment && attachment.content) {
    parts.push('');
    parts.push(`--${boundary}`);
    parts.push(`Content-Type: ${attachment.contentType || 'application/octet-stream'}; name="${attachment.filename}"`);
    parts.push('Content-Transfer-Encoding: base64');
    parts.push(`Content-Disposition: attachment; filename="${attachment.filename}"`);
    parts.push('');
    parts.push(wrap76(attachment.content.toString('base64')));
  }

  parts.push('');
  parts.push(`--${boundary}--`);
  parts.push('');
  return { raw: b64url(`${headers.join('\r\n')}\r\n${parts.join('\r\n')}`), messageId };
}

/** Send one message through the Gmail API. */
export async function sendViaGmail(gmail, fromEmail, payload) {
  if (!fromEmail) {
    throw Object.assign(new Error('Set the sender Gmail address in Settings before sending'), { code: 'GMAIL_NO_SENDER' });
  }
  const client = oauthClient(gmail);
  client.setCredentials({ refresh_token: gmail.refreshToken });
  const gmailApi = google.gmail({ version: 'v1', auth: client });

  const { raw, messageId } = buildMime({
    from: fromEmail,
    fromName: payload.fromName || '',
    to: payload.to || [],
    cc: payload.cc || [],
    bcc: payload.bcc || [],
    replyTo: payload.replyTo || '',
    subject: payload.subject || '',
    text: payload.text || '',
    html: payload.html || '',
    attachment: payload.attachment,
  });

  const res = await gmailApi.users.messages.send({ userId: 'me', requestBody: { raw } });
  return {
    ok: true,
    messageId: res.data?.id || messageId,
    threadId: res.data?.threadId,
  };
}

/** Google's documented per-user sending limits. */
export function gmailLimits(isWorkspace = false) {
  return isWorkspace
    ? { perDay: 2000, perMinute: 1800 }
    : { perDay: 500, perMinute: 100 };
}

/** Turn a Google API error into something a human can act on. */
export function explainGmailError(err) {
  const data = err?.response?.data;
  const reason = data?.error?.errors?.[0]?.reason || (typeof data?.error === 'string' ? data.error : '');
  const msg = data?.error_description || data?.error?.message || err?.message || 'Unknown error';
  const s = `${reason} ${msg}`.toLowerCase();

  if (s.includes('invalid_grant')) {
    return 'The Gmail authorisation expired or was revoked. Click "Reconnect Gmail" in Settings.';
  }
  if (s.includes('daily limit') || s.includes('user-rate limit') || s.includes('rate limit')) {
    return 'Gmail quota reached - Google limits how much mail an account can send per day. Wait for the quota to reset (usually a few hours) or send from a Workspace account.';
  }
  if (s.includes('quota exceeded') || s.includes('quotaexceeded')) {
    return 'Google API quota exceeded. Wait a few minutes and resume - the app can restart from the vendors that failed.';
  }
  if (s.includes('insufficient') || s.includes('scope')) {
    return 'The granted permission is missing gmail.send. Reconnect Gmail and approve the permission for sending email.';
  }
  if (s.includes('invalid to') || s.includes('recipient')) {
    return `One of the recipients was rejected by Gmail (${msg}). Check the Mail ID for that vendor.`;
  }
  if (s.includes('message too large') || s.includes('exceeded maximum')) {
    return 'The message with its attachment is larger than Gmail allows (25 MB). Reduce the row count or split the vendor.';
  }
  if (s.includes('has not been used') || s.includes('mail service not enabled') || s.includes('accessnotconfigured')) {
    return 'Enable the Gmail API for your Google Cloud project first (APIs & Services -> Library -> Gmail API).';
  }
  if (err?.code === 'ENOTFOUND' || err?.code === 'ETIMEDOUT') {
    return 'Could not reach Google. Check the internet connection and try again.';
  }
  return msg;
}
