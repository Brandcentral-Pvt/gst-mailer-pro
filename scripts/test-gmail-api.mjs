// Offline proof of the Gmail API path: patches google.gmail with a fake that
// decodes the raw MIME we hand to Google, so buildMime + sendViaGmail are both
// exercised without any real credentials or network.
import { google } from 'googleapis';
import { createRequire } from 'module';
import { sendViaGmail, buildMime, checkGmailAuth, gmailAuthUrl, gmailLimits, explainGmailError } from '../server/gmail.js';

const require = createRequire(import.meta.url);
const assert = require('assert');

let captured = null;
let profileCalls = 0;

google.gmail = () => ({
  users: {
    messages: {
      send: async ({ requestBody }) => {
        captured = requestBody.raw;
        return { data: { id: 'mock-msg-123', threadId: 'mock-thread-9', labelIds: ['SENT'] } };
      },
    },
    getProfile: async () => {
      profileCalls += 1;
      return { data: { emailAddress: 'accounts@example.com', messagesTotal: 42, threadsTotal: 40 } };
    },
  },
});

function decodeRaw(raw) {
  const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

function partBody(mime, marker) {
  // find the part that declares marker, return its decoded base64 body
  const blocks = mime.split(/^--/m);
  for (const b of blocks) {
    if (!b.includes(marker)) continue;
    const idx = b.indexOf('\r\n\r\n');
    if (idx < 0) continue;
    const body = b.slice(idx + 4).split(/\r\n--/)[0].replace(/\r\n/g, '');
    return Buffer.from(body, 'base64');
  }
  return null;
}

const attachmentBytes = Buffer.from(require('fs').readFileSync('/home/user/gst-mailer-pro/package.json'));
const INR = '\u20b9';

const gmail = {
  clientId: 'cid.apps.googleusercontent.com',
  clientSecret: 'secret',
  refreshToken: 'refresh-token-value',
  accountEmail: 'accounts@example.com',
  workspace: true,
};

// ---- 1. full send path
const res = await sendViaGmail(gmail, 'accounts@example.com', {
  fromName: 'GST Accounts',
  to: ['vendor1@example.com', 'vendor2@example.com'],
  cc: ['ops@example.com'],
  bcc: ['audit@example.com'],
  replyTo: 'reply@example.com',
  subject: `GST Statement ${INR} 1,20,450 — DEELMO`,
  text: 'Plain text body with all 38 columns',
  html: '<html><body><table><tr><td>Rupee ' + INR + ' and more</td></tr></table></body></html>',
  attachment: {
    filename: 'GST_Statement_DEELMO.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    content: attachmentBytes,
  },
});

assert.equal(res.ok, true);
assert.equal(res.messageId, 'mock-msg-123');
assert.equal(res.threadId, 'mock-thread-9');

const mime = decodeRaw(captured);
const has = (s) => assert.ok(mime.includes(s), `missing: ${s}`);

has('From: GST Accounts <accounts@example.com>'); // pure-ASCII name stays readable
has('To: vendor1@example.com, vendor2@example.com');
has('Cc: ops@example.com');
has('Bcc: audit@example.com');
has('Reply-To: reply@example.com');
has('Subject: =?UTF-8?B?');                    // rupee sign in subject -> RFC2047
assert.ok(mime.includes('MIME-Version: 1.0'));
assert.ok(/Message-ID: <[0-9a-f-]{36}@example\.com>/.test(mime));
assert.ok(mime.includes('multipart/mixed'));
assert.ok(mime.includes('multipart/alternative'));
assert.ok(mime.includes('Content-Disposition: attachment; filename="GST_Statement_DEELMO.xlsx"'));

const textPart = partBody(mime, 'text/plain');
const htmlPart = partBody(mime, 'text/html');
const attPart = partBody(mime, 'GST_Statement_DEELMO.xlsx');
assert.equal(textPart.toString('utf8'), 'Plain text body with all 38 columns');
assert.ok(htmlPart.toString('utf8').includes(INR), 'rupee sign survived html encoding');
assert.ok(attPart.equals(attachmentBytes), 'attachment bytes are byte-identical');

// non-ASCII display name must be RFC 2047 encoded
const intl = buildMime({ from: 'accounts@example.com', fromName: 'GST \u0932\u0947\u0916\u093e', to: ['a@b.com'], subject: 's', text: 't', html: 'h' });
const intlMime = decodeRaw(intl.raw);
assert.ok(/^From: =\?UTF-8\?B\?/.test(intlMime), 'unicode display name not encoded: ' + intlMime.split('\r\n')[0]);
console.log('PASS header — unicode display name RFC 2047 encoded');

// long base64 lines must be wrapped (Gmail rejects very long raw lines)
const longest = Math.max(...mime.split('\r\n').map((l) => l.length));
assert.ok(longest <= 1000, `longest line ${longest}`);
console.log(`PASS send  — ${mime.length} B MIME, longest line ${longest}, attachment ${(attPart.length / 1024).toFixed(1)} KB byte-identical`);

// ---- 2. auth check
profileCalls = 0;
const auth = await checkGmailAuth(gmail);
assert.equal(auth.ok, true);
assert.equal(auth.email, 'accounts@example.com');
assert.equal(profileCalls, 1);
console.log(`PASS auth  — ${auth.message}`);

const notConnected = await checkGmailAuth({ clientId: 'x', clientSecret: 'y' });
assert.equal(notConnected.ok, false);
assert.ok(notConnected.message.includes('Connect Gmail'));
console.log(`PASS guard — ${notConnected.message}`);

// ---- 3. auth URL
const url = new URL(gmailAuthUrl({ ...gmail, redirectUri: 'http://localhost:8000/api/oauth/google/callback' }, 'state123'));
assert.equal(url.host, 'accounts.google.com');
assert.ok(url.searchParams.get('scope').includes('gmail.send'));
assert.equal(url.searchParams.get('access_type'), 'offline');
assert.equal(url.searchParams.get('prompt'), 'consent');
assert.equal(url.searchParams.get('state'), 'state123');
console.log('PASS oauth — scope/offline/consent/state all correct');

// ---- 4. limits + friendly errors
assert.deepEqual(gmailLimits(false), { perDay: 500, perMinute: 100 });
assert.deepEqual(gmailLimits(true), { perDay: 2000, perMinute: 1800 });
const rateErr = explainGmailError({ response: { data: { error: { errors: [{ reason: 'userRateLimitExceeded' }], message: 'User-rate limit exceeded' } } } });
assert.ok(rateErr.includes('quota reached'), rateErr);
const grantErr = explainGmailError({ response: { data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } } });
assert.ok(grantErr.includes('Reconnect Gmail'), grantErr);
const scopeErr = explainGmailError({ response: { data: { error: { errors: [{ reason: 'insufficientPermissions' }], message: 'Request had insufficient authentication scopes.' } } } });
assert.ok(scopeErr.includes('gmail.send'), scopeErr);
console.log('PASS errors — rate limit / invalid_grant / scope mapped to advice');

// ---- 5. no sender
let threw = null;
try { await sendViaGmail(gmail, '', { to: ['a@b.com'], subject: 'x' }); } catch (e) { threw = e; }
assert.ok(threw && threw.code === 'GMAIL_NO_SENDER');
console.log('PASS guard — missing sender rejected before hitting the API');

console.log('\nALL GMAIL API CHECKS PASSED');
