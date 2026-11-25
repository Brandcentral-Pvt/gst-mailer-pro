# Quick start (what's inside this zip)

Extract, then from inside `gst-mailer-pro/`:

```bash
npm install                 # installs the API + the React app (postinstall handles web/)
npm run build && npm start  # production: one server on http://localhost:8000
```

Development with hot reload instead:

```bash
npm run dev                 # API :8000, Vite :5173 (proxied)
```

Requirements: **Node 18+** (Node 20 recommended). No database — everything is JSON in `data/`.

## Included

| Path | What it is |
|---|---|
| `web/src/` | React 18 frontend (Vite + Tailwind + Recharts + Framer Motion) |
| `server/` | Express API — workbook parsing, matching, email rendering, SMTP + Gmail API |
| `dist/` | Pre-built frontend, so `npm start` works even before you run `npm run build` |
| `sample/` | 2-tab sample workbook + two Vendor↔Mail-ID CSVs |
| `scripts/` | Offline proofs: `test-gmail-api.mjs`, `test-campaign-gmail.mjs` |
| `data/workbook/session.xlsx` | Your workbook, so the app boots with 315 vendors already loaded |
| `docs/screens/` | Screenshots used in the README |

Not included: `node_modules/` (run `npm install`), `uploads/` temp files, and generated attachments.

## First run

1. `npm install && npm run build && npm start`
2. Open http://localhost:8000 — the workbook restores automatically (315 vendors, 82,963 rows).
3. **Settings → Gmail API** (OAuth) or **Settings → SMTP** (App Password) → test → dry run → send.

State lives in `data/settings.json` (delivery mode + credentials), `data/recipients.json`
(Vendor ↔ Mail ID), `data/history.json` (campaign log). Delete them to start clean.
