import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  UploadCloud, FileSpreadsheet, Check, ArrowRight, Layers, Wand2, Info, X, Sparkles,
  Loader2, FileText,
} from 'lucide-react';
import api from '../lib/api';
import { Card, Badge, Spinner } from '../components/ui';
import { StepCta } from '../components/Flow';
import { fmtInt, cls } from '../lib/format';

const VENDOR_HINTS = [
  'vendor name', 'supplier name', 'party name', 'trade/legal name', 'trade name',
  'legal name', 'name of supplier', 'vendor', 'supplier', 'party', 'account name',
  'ledger name', 'name',
];
const NEVER_VENDOR = /status|period|section|date|gstin|invoice|remark|type|amount|value|cess|igst|cgst|sgst/i;

/** Best guess at the vendor-name column: prefer header hints, never pick a status/amount column. */
export function guessVendorCol(columns = []) {
  const lower = columns.map((c) => String(c).toLowerCase().trim());
  for (const hint of VENDOR_HINTS) {
    const exact = lower.indexOf(hint);
    if (exact >= 0) return columns[exact];
  }
  for (const hint of VENDOR_HINTS) {
    const part = lower.findIndex((c) => c.includes(hint) && !NEVER_VENDOR.test(c));
    if (part >= 0) return columns[part];
  }
  const fallback = columns.find((c) => !NEVER_VENDOR.test(c));
  return fallback || columns[0];
}

export default function Upload({ state, onLoaded, toast, setRoute, openSettings }) {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState(null);
  const [selected, setSelected] = useState([]);
  const [config, setConfig] = useState({});
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  async function handleFile(file) {
    if (!file) return;
    if (!/\.(xlsx|xlsm|csv)$/i.test(file.name)) {
      toast({ tone: 'err', title: 'Unsupported file', body: 'Upload an .xlsx workbook with 2 tabs, or a .csv file.' });
      return;
    }
    setBusy(true); setError(null);
    try {
      const res = await api.upload('/api/upload', file);
      setUpload(res);
      setSelected(res.sheets.slice(0, 2).map((s) => s.name));
      const cfg = {};
      res.sheets.forEach((s) => {
        cfg[s.name] = { headerRow: s.headerRow, vendorCol: guessVendorCol(s.columns) };
      });
      setConfig(cfg);
      toast({ tone: 'ok', title: 'Workbook read', body: `${res.sheets.length} tab(s) detected · ${(res.sizeKb / 1024).toFixed(2)} MB` });
    } catch (e) {
      setError(e.message);
      toast({ tone: 'err', title: 'Could not read workbook', body: e.message });
    } finally {
      setBusy(false);
    }
  }

  function toggleSheet(name) {
    setSelected((prev) => {
      if (prev.includes(name)) return prev.filter((s) => s !== name);
      const next = [...prev, name];
      return next.length > 2 ? next.slice(1) : next;
    });
  }

  async function configure() {
    if (!upload) return;
    if (!upload.isCsv && selected.filter((s, i, a) => a.indexOf(s) === i).length < 2) {
      toast({ tone: 'err', title: 'Select 2 different tabs', body: 'Both tabs are needed to reconcile every vendor.' });
      return;
    }
    setBusy(true);
    try {
      const res = await api.post('/api/configure', {
        fileId: upload.fileId,
        tabs: selected.map((name) => {
          const s = upload.sheets.find((x) => x.name === name);
          return { sheetName: name, label: name, headerRow: config[name]?.headerRow ?? s?.headerRow ?? 0, vendorCol: config[name]?.vendorCol };
        }),
      });
      onLoaded(res);
      toast({ tone: 'ok', title: 'Vendors extracted', body: `${fmtInt(res.stats.vendorCount)} vendors · ${fmtInt(res.stats.totalRows)} rows · ${res.stats.rawNameCount} raw names` });
      setRoute('matching');
    } catch (e) {
      toast({ tone: 'err', title: 'Could not configure', body: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {state.loaded && (
        <StepCta
          icon={ArrowRight}
          tone="green"
          title="A workbook is already loaded"
          body={`${state.stats.filename} · ${fmtInt(state.stats.vendorCount)} vendors. Continue from where you left off.`}
          cta="Continue to review"
          onClick={() => setRoute('matching')}
        />
      )}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="relative overflow-hidden">
          <div className="card-hd">
            <div>
              <p className="card-title">Step 1 · Import a 2-tab GST workbook</p>
              <p className="card-sub">Example: Purchase Register + GSTR-2B Portal. Header rows and the Vendor Name column are auto-detected.</p>
            </div>
            {upload && <Badge tone="teal" className="ml-auto">{upload.filename}</Badge>}
          </div>
          <div className="p-5">
            {!upload && (
              <motion.div
                initial={{ opacity: 0.9 }}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files?.[0]); }}
                onClick={() => fileRef.current?.click()}
                className={cls(
                  'group relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition',
                  drag ? 'border-brand-500 bg-brand-50/70 shadow-glow' : 'border-ink-200 bg-gradient-to-b from-white to-ink-50/60 hover:border-brand-400 hover:bg-brand-50/40',
                )}
              >
                <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.csv" hidden onChange={(e) => handleFile(e.target.files?.[0])} />
                <div className="relative">
                  <div className="grid h-16 w-16 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-500/10 transition group-hover:scale-105">
                    {busy ? <Spinner className="h-7 w-7" /> : <UploadCloud className="h-7 w-7" />}
                  </div>
                  <span className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full bg-mint-500 text-white shadow">
                    <Sparkles className="h-3 w-3" />
                  </span>
                </div>
                <p className="mt-4 font-display text-[15px] font-bold text-ink-900">
                  {busy ? 'Reading workbook…' : 'Drop the workbook here, or click to browse'}
                </p>
                <p className="mt-1 max-w-md text-[12.5px] text-ink-500">
                  Every row from both tabs is read — no status filtering. ₹ values, <span className="font-mono">(₹53.62)</span> credits and
                  duplicate Remark columns are handled.
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
                  <Badge tone="gray">.xlsx · 2 tabs</Badge>
                  <Badge tone="gray">.xlsm</Badge>
                  <Badge tone="gray">.csv</Badge>
                  <Badge tone="green">₹ Indian formatting</Badge>
                </div>
              </motion.div>
            )}

            {error && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-100/50 p-3 text-[12.5px] text-rose-600">
                <X className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </div>
            )}

            {upload && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 rounded-xl border border-ink-100 bg-ink-50/60 px-3.5 py-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-brand-600 ring-1 ring-ink-100">
                    <FileSpreadsheet className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-ink-900">{upload.filename}</p>
                    <p className="text-[11.5px] text-ink-400">
                      {upload.sheets.length} tab(s) · {(upload.sizeKb / 1024).toFixed(2)} MB ·{' '}
                      {upload.isCsv ? 'single CSV (mirrored as both tabs)' : 'Excel workbook'}
                    </p>
                  </div>
                  <button className="btn btn-sm" onClick={() => { setUpload(null); setSelected([]); setConfig({}); fileRef.current?.click(); }}>
                    Replace
                  </button>
                </div>

                <div>
                  <p className="label">Choose the 2 tabs to reconcile</p>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {upload.sheets.map((s) => {
                      const pos = selected.indexOf(s.name);
                      const active = pos >= 0;
                      return (
                        <button
                          key={s.name}
                          onClick={() => toggleSheet(s.name)}
                          className={cls(
                            'relative rounded-xl border p-3 text-left transition',
                            active ? 'border-brand-500 bg-brand-50/60 shadow-[0_0_0_3px_rgba(14,139,163,.08)]' : 'border-ink-100 bg-white hover:border-brand-200',
                          )}
                        >
                          <div className="flex items-center gap-2">
                            {active && <span className="grid h-5 w-5 place-items-center rounded-md bg-brand-600 text-[10px] font-bold text-white">{pos + 1}</span>}
                            <p className="truncate text-[13px] font-bold text-ink-900">{s.name}</p>
                            <span className="ml-auto">{active ? <Badge tone="teal">Tab {pos + 1}</Badge> : <Badge tone="gray">not used</Badge>}</span>
                          </div>
                          <p className="mt-1 text-[11px] text-ink-400">{s.columns.length} columns · header on row {s.headerRow + 1}</p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {s.columns.slice(0, 5).map((c) => (
                              <span key={c} className="rounded-md bg-white px-1.5 py-0.5 text-[10.5px] font-medium text-ink-500 ring-1 ring-ink-100">{c}</span>
                            ))}
                            {s.columns.length > 5 && <span className="rounded-md bg-white px-1.5 py-0.5 text-[10.5px] text-ink-400 ring-1 ring-ink-100">+{s.columns.length - 5}</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {selected.length > 0 && (
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {selected.map((name, idx) => {
                      const s = upload.sheets.find((x) => x.name === name);
                      if (!s) return null;
                      return (
                        <div key={name} className="rounded-xl border border-ink-100 bg-white p-3">
                          <div className="mb-2 flex items-center gap-2">
                            <span className="grid h-5 w-5 place-items-center rounded-md bg-brand-600 text-[10px] font-bold text-white">{idx + 1}</span>
                            <p className="truncate text-[12.5px] font-bold text-ink-800">{name}</p>
                            <Badge tone={idx === 0 ? 'teal' : 'blue'} className="ml-auto">Tab {idx + 1}</Badge>
                          </div>
                          <div className="grid grid-cols-[1fr_88px] gap-2">
                            <label className="block">
                              <span className="label !mb-1">Vendor Name column</span>
                              <select className="select !py-1.5 !text-[12px]"
                                value={config[name]?.vendorCol || guessVendorCol(s.columns)}
                                onChange={(e) => setConfig((c) => ({ ...c, [name]: { ...c[name], vendorCol: e.target.value } }))}>
                                {s.columns.map((col) => <option key={col} value={col}>{col}</option>)}
                              </select>
                            </label>
                            <label className="block">
                              <span className="label !mb-1">Header row</span>
                              <input type="number" min={1} className="input !py-1.5 !text-[12px]"
                                value={(config[name]?.headerRow ?? s.headerRow) + 1}
                                onChange={(e) => setConfig((c) => ({ ...c, [name]: { ...c[name], headerRow: Math.max(0, Number(e.target.value) - 1) } }))} />
                            </label>
                          </div>
                          {/status|period|section/i.test(config[name]?.vendorCol || '') && (
                            <p className="mt-1.5 rounded-md bg-amber-50 px-2 py-1 text-[10.5px] text-amber-700">
                              This looks like a status column — pick the column that holds the supplier name.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn btn-primary btn-lg" onClick={configure} disabled={busy || !selected.length}>
                    {busy ? <Spinner /> : <Wand2 className="h-4 w-4" />} Read workbook & extract vendors
                  </button>
                  <button className="btn" onClick={() => fileRef.current?.click()}>Choose different file</button>
                  {state.loaded && <span className="text-[11.5px] text-ink-400">A new import replaces the current dataset.</span>}
                </div>
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="bg-brand-sheen text-white">
            <div className="p-5">
              <span className="pill bg-white/10 text-brand-100 ring-1 ring-white/15"><Info className="h-3.5 w-3.5" /> Before you import</span>
              <ul className="mt-3 space-y-2.5 text-[12.5px] text-brand-100/85">
                {[
                  'Both tabs live in one .xlsx file — no need to merge sheets manually.',
                  'Header can sit below title rows; detection scans the first 20 rows.',
                  'Vendor Name must be a real column — not a merged cell.',
                  'GST amounts like (₹53.62), ₹2,495.06 or "-" all parse correctly.',
                ].map((t) => (
                  <li key={t} className="flex gap-2">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint-500" /> <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          <Card>
            <div className="card-hd"><p className="card-title">No file handy?</p></div>
            <div className="space-y-3 p-4 text-[12.5px] text-ink-500">
              <p>A demo workbook built from a real GST export ships with the app.</p>
              <div className="rounded-xl border border-ink-100 bg-ink-50/60 p-3 font-mono text-[11px] leading-relaxed text-ink-600">
                sample/FINAL_GST_2TAB_SAMPLE.xlsx<br />
                sample/vendor_email_mapping_sample.csv
              </div>
              <p className="text-[11.5px] text-ink-400">2 tabs · 101,336 rows · 332 raw vendor names → 275 vendors.</p>
            </div>
          </Card>

          <Card>
            <div className="card-hd"><p className="card-title">Workflow</p></div>
            <ol className="space-y-2 p-4 text-[12px] text-ink-500">
              {[
                ['Import & configure tabs', 'upload'],
                ['Review vendor matching', 'matching'],
                ['Map Vendor ↔ Mail ID', 'mapping'],
                ['Dry run, then send', 'campaign'],
              ].map(([t, r], i) => (
                <li key={t}>
                  <button onClick={() => setRoute(r)} className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-brand-50/60">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-ink-100 text-[10px] font-bold text-ink-500">{i + 1}</span>
                    <span className="font-medium text-ink-700">{t}</span>
                    <ArrowRight className="ml-auto h-3.5 w-3.5 text-ink-300" />
                  </button>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      {state.loaded && (
        <Card>
          <div className="card-hd">
            <div>
              <p className="card-title">Current dataset</p>
              <p className="card-sub">{state.stats.filename} · loaded {new Date(state.stats.loadedAt).toLocaleString('en-IN')}</p>
            </div>
            <Badge tone="green" className="ml-auto" dot>active</Badge>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
            <MiniStat label="Vendors" value={fmtInt(state.stats.vendorCount)} sub={`${fmtInt(state.stats.rawNameCount)} raw names`} />
            <MiniStat label="Rows" value={fmtInt(state.stats.totalRows)} sub="all statuses included" />
            {state.stats.tabs.map((t) => (
              <div key={t.key} className="rounded-xl border border-ink-100 p-3">
                <div className="flex items-center gap-2">
                  <Layers className="h-3.5 w-3.5 text-brand-500" />
                  <p className="truncate text-[12px] font-bold text-ink-800">{t.label}</p>
                  <Badge tone="gray" className="ml-auto">{fmtInt(t.rows)}</Badge>
                </div>
                <p className="mt-1.5 text-[11px] text-ink-400">
                  Vendor col <b className="text-ink-600">{t.vendorCol}</b> · status <b className="text-ink-600">{t.statusCol || 'none'}</b>
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {t.amountCols.map((c) => <span key={c} className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">{c}</span>)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function MiniStat({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-ink-100 p-3">
      <p className="stat-label">{label}</p>
      <p className="font-display text-xl font-extrabold text-ink-900">{value}</p>
      <p className="text-[11px] text-ink-400">{sub}</p>
    </div>
  );
}
