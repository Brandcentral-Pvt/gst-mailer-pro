# GST Ledger · Vendor Mailer Pro

A **React + Node** rebuild of the GST Vendor Bulk Mailer with a rich, app-grade UI.

One 2-tab GST workbook in → matched vendors, Vendor ↔ Mail ID mapping, and a per‑vendor email with
the **actual transaction rows in the body** (not just totals) plus an **exact copy of the sheet as `.xlsx`**.

![Overview](docs/screens/01-overview.png)

| | |
|---|---|
| ![Import](docs/screens/02-import.png) | ![Matching](docs/screens/03-matching.png) |
| ![Mail ID mapping](docs/screens/05-mail-mapping.png) | ![Preview & send](docs/screens/06-preview-send.png) |
| ![Gmail API setup](docs/screens/10-gmail-api-settings.png) | ![Transaction rows](docs/screens/09-transaction-rows.png) |

Actually sent mail, transaction rows in the body (full-size preview inside the app):
![Transaction rows in the email](docs/screens/09-transaction-rows.png)

Vendor detail drawer (per-sheet totals, status pills, name variants, sample rows, attachment download):
![Vendor drawer](docs/screens/04-vendor-drawer.png)

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 · Vite · Tailwind CSS · Framer Motion · Recharts · lucide-react |
| Backend | Node 20 · Express 4 · multer · nodemailer · exceljs (streaming reader/writer) |
| Delivery | **Gmail API (OAuth 2.0)** *or* SMTP (Gmail / Workspace App Password, Outlook, Zoho, custom), switchable, with SSE live progress |
| Persistence | JSON files under `data/` (recipient mapping, settings, campaign history, session copy of the workbook) |

---

## Run

```bash
cd gst-mailer-pro
npm install            # also installs the web app
npm run dev            # API :8000 + Vite :5173 (proxied) — development
# …or production:
npm run build && npm start   # single server on :8000
```

Open **http://localhost:8000** (production) or **http://localhost:5173** (dev).

The last imported workbook is persisted in `data/workbook/` and restored on boot, so a restart
does not lose your dataset or the Vendor ↔ Mail ID mapping.

## Login & logout

The app is single-user and protected by a signed, HttpOnly session cookie (7-day expiry, rate-limited
logins). On first boot the server prints a generated `admin` password to its console — on the VPS run
`pm2 logs gst-mailer-pro` to see it. Sign in, then use **Change password** (sidebar or top bar) to set
your own; the first password must be changed before the workspace opens. **Sign out** is in both places.
Every `/api/*` route except `/api/health` and `/api/auth/*` requires the session cookie. Credentials and
session secrets live in `data/auth.json` (chmod 600 on Linux) — don't commit it.

---

## Screens

1. **Overview** — KPI strip, biggest vendors by rows, match-status donut, rows-per-sheet area chart,
   attention queue (fuzzy pairs, single-tab vendors, missing Mail IDs) and recent campaign history.
2. **Import workbook** — drag & drop a 2-tab `.xlsx` (or `.csv`). Auto-detects header rows, the
   Vendor Name column, GSTIN/status/date/amount columns per tab. Both tabs configurable side by side.
3. **Vendor matching** — 3-stage matcher (exact → legal suffix → guarded fuzzy). Suggested merges
   carousel, review filter, threshold slider, one-click merge/split, per-vendor detail drawer.
4. **Mail ID mapping** — inline edit, paste-list import, Excel/CSV mapping import, CSV template
   download, validation states. One Vendor Name ↔ one Mail ID (comma-separated recipients allowed).
5. **Preview & send** — audience picker, live HTML email preview with real data, dry run,
   live SSE progress console, stop, CSV log, campaign history, auto-tuned send pacing.

---

## Delivery: Gmail API or SMTP

Both transports send the **same message** — same template, same all-column body, same exact-copy
`.xlsx`. Only the pipe to Google changes, and you can flip between them without touching the template.

| | Gmail API (OAuth 2.0) | SMTP (App Password) |
|---|---|---|
| Credential | OAuth token — revoke the app any time in your Google Account | 16-character App Password |
| Works when the org blocks app passwords | yes | no |
| Setup | Google Cloud project + OAuth client (one time) | create an App Password (2 min) |
| Quota | Google-enforced and reported: **500/day** consumer, **2,000/day** Workspace, 100 or 1,800 per minute | provider-enforced, errors are vaguer |
| Error detail | `RATE_LIMIT_EXCEEDED`, `QUOTA_EXCEEDED`, `invalid_grant`… mapped to plain-English advice in the vendor log | `EAUTH`, `ETIMEDOUT`… |
| Speed | no SMTP handshake per mail, so a run is a little faster | one connection, pooled off |

**Pick it in Settings → Gmail API.** One-time Google Cloud setup (also listed inside the app):

1. [Google Cloud Console → Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com) → **Enable**.
2. **OAuth consent screen** → External → add your own address as a **Test user**
   (or *Internal* on Workspace, which skips verification).
3. **Credentials → Create credentials → OAuth client ID → Web application**.
4. Authorised redirect URI — copy it from the app (it auto-detects the host):
   `http://localhost:8000/api/oauth/google/callback`
5. Paste the Client ID + Secret → **Save** → **Connect Gmail** → approve → you land back in the app
   with the settings drawer already on the Gmail tab.
6. **Test connection** → **Send test email** → then dry run → live send.

What happens underneath:

- `server/gmail.js` builds the RFC 2822 message by hand (multipart/mixed: base64 text + HTML and the
  `.xlsx` as base64), base64url-encodes it and calls `gmail.users.messages.send` with scope `gmail.send`.
- Non-ASCII subjects and display names are RFC 2047 encoded (the ₹ sign in a subject survives).
- The refresh token is stored in `data/settings.json`; the client secret and token are never returned
  to the browser (they come back masked, and a blank field keeps the saved value).
- `deliveryMode: 'gmail' | 'smtp'` decides the path in `server/campaign.js`; SMTP stays fully wired as
  a fallback, and the sidebar/top-bar chip plus the campaign header show which one is live.
- Attachments over 25 MB are rejected by Google — the error is surfaced per vendor, not swallowed.

Verified without credentials by `scripts/test-gmail-api.mjs` (MIME structure, byte-identical
attachment, OAuth URL, quota maths, error mapping) and `scripts/test-campaign-gmail.mjs` (real
workbook → 1 sent through a stubbed Gmail API with a **1,464.8 KB** attachment, SMTP untouched in gmail
mode and vice versa, dry runs never call a transport).

---

## Email & attachment

**Body** (Gmail/Outlook safe): vendor header, KPI strip, per-sheet totals table, status pills, then
**the real transaction rows with EVERY column from the uploaded sheet, in the sheet's own order**
(all 17 columns of `FINAL GST DATA`, all 21 of `GST 2B DATA`), plus a `+ N more rows in <attachment>` line.

How the wide table is made to fit without clipping:

- fixed table layout with `<col>` widths in percentages that always sum to 100%, so no column can be
  pushed off-screen — verified 0 overflowing cells at 1200 px and 760 px viewports
- widths weighted by each column's real character budget (a 15-char GSTIN gets ~3× the room of a
  `23.18` amount), with a hard minimum per kind (money / number / date / GSTIN / status / text)
- cells carry **no** inline CSS — a single `<style>` block uses short class names and per-table
  `nth-child` rules for right-alignment and code wrapping (Gmail clips above ~102 KB)
- the message byte budget is measured and the row count auto-fits: DEELMO with all 38 columns sends at
  **78.5 KB** with 92 rows per sheet (a `Row limit reduced` note appears when it has to trim)

Plain-text alternative carries the same rows, `|`-separated, with the sheet's original headers.

**Attachment** `GST_Statement_<VENDOR>.xlsx` — an **exact copy of the uploaded sheet**:
- the sheet's own worksheet names, column names and column order (including repeated `Remark` headers
  and structurally empty columns)
- every row for that vendor, in **source order** (rows are re-sorted by original position after name
  matching, so a merged name variant cannot shuffle them)
- no banner, no TOTAL row, no Summary sheet — nothing added or removed

Verified on the real workbook: DEELMO → 10,778 + 5,639 rows, **0 value mismatches** against the source
sheet, identical headers and column count. A tab with no rows for a vendor is omitted.

### Switches (Settings → Email template)

| Option | Default | Meaning |
|---|---|---|
| Show the actual rows | on | put the transaction table in the mail body |
| Rows per sheet in the mail | 100 | 25 / 50 / 100 / 200 / 500 — auto-reduced if the message would exceed ~96 KB; the rest is always in the attachment |
| Columns in the mail | all | every column from the sheet, in sheet order — no curation |
| Excel attachment | Exact copy | or *Formatted statement* (banner + totals + Summary sheet) |

Measured: DEELMO (16,417 rows across both sheets, 38 columns total) → mail HTML **78.5 KB**,
attachment 1.4 MB, built in ~1.6 s.

---

## API surface

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/upload` | read workbook, list tabs/columns |
| POST | `/api/configure` | load 2 tabs → vendors, suggestions |
| POST | `/api/rematch` | re-run matching with a fuzzy threshold |
| POST | `/api/mapping/edits` | merge / split / rename vendors |
| GET | `/api/vendor/:name` | summary, sheet break-up, samples, recipient |
| GET | `/api/vendor/:name/attachment` | generated `.xlsx` |
| GET/POST/DELETE | `/api/recipients` | Vendor ↔ Mail ID store |
| POST | `/api/recipients/paste` · `/upload` | bulk mapping import |
| GET/POST | `/api/settings` | delivery mode, Gmail credentials, SMTP + email template |
| POST | `/api/smtp/test` · `/test-email` | SMTP connection + real test mail |
| GET | `/api/oauth/google/url` | consent URL for the connected Cloud project |
| GET | `/api/oauth/google/callback` | exchanges the code for a refresh token, returns to the app |
| POST | `/api/gmail/test` · `/test-email` | Gmail API auth check (returns quota) + real test mail |
| POST | `/api/gmail/disconnect` | drop the token and fall back to SMTP |
| POST | `/api/preview` | rendered email HTML + subject |
| POST | `/api/send` | start dry run or live campaign |
| GET | `/api/send/:id/stream` | SSE progress |
| GET | `/api/send/:id/log.csv` | per-vendor delivery log |

---

## Gmail checklist

**Option A — Gmail API (recommended).** Settings → Gmail API → follow the five steps above →
**Connect Gmail** → **Test connection**. No app password involved.

**Option B — SMTP with an App Password.**

1. Google Account → Security → **2-Step Verification** → **App passwords** → create one.
2. In the app: **Settings → SMTP** → Gmail preset, your address, the 16-character password.
3. **Test connection** → **Send test email to me** → check inbox/spam.
4. **Dry run** the campaign (builds every attachment, sends nothing) → then **Send**.

Any SMTP relay works — choose **Custom SMTP** and set host/port/encryption. Live mode is refused
until credentials are saved; dry runs always work.

---

## Sample data

`sample/FINAL_GST_2TAB_SAMPLE.xlsx` — 2 tabs (Purchase Register 62,553 rows + GSTR-2B Portal 38,783 rows,
101,336 total, 332 raw vendor names → 275 matched vendors, 56 merged groups, 19 single-tab vendors).

Real-world shape handled: a 2B sheet whose supplier column is `Supplier Name` (not `Vendor Name`) and
whose first column is `Match Status`. The importer now auto-detects the supplier column and refuses to
treat a status/amount column as the vendor name.
`sample/vendor_email_mapping_sample.csv` — mapping for every detected name (one blank + one invalid on purpose).
`sample/vendor_email_mapping_demo30.csv` — 30-vendor subset for a fast pass.

---

## Notes & limits

- Single workspace / single user by design (JSON store, one active dataset).
- The OAuth refresh token lives in `data/settings.json` in plain text — this is a local single-user
  tool; restrict file permissions if the machine is shared. Revoking the app in your Google Account
  kills it immediately.
- Attachments are rebuilt per send and cached in `data/attachments/` (safe to delete).
- ExcelJS streams both read and write, so 100k-row workbooks stay within normal memory.
- Every row from both tabs is always included — there is no status filter anywhere in the pipeline.
- The vendor column is auto-detected (Vendor Name / Supplier Name / Party Name / …). A status, date or
  amount column is never accepted as the vendor name, even if chosen by hand.
