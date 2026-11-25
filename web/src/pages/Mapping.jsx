import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Upload, ClipboardPaste, Download, Save, AtSign, AlertTriangle, CircleCheck,
  Trash2, UserRound, Info,
} from 'lucide-react';
import api from '../lib/api';
import { Card, Badge, Avatar, Segmented, Modal, EmptyState, Spinner } from '../components/ui';
import { fmtInt, EMAIL_RE, cls } from '../lib/format';

export default function Mapping({ state, onVendors, toast, openVendor }) {
  const vendors = state.vendors || [];
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [edits, setEdits] = useState({});          // vendor -> { email, cc }
  const [busy, setBusy] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [importInfo, setImportInfo] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => { setEdits({}); }, [state.stats?.loadedAt]);

  const rowValue = (v) => edits[v.vendor] || { email: v.email || '', cc: v.cc || '' };
  const validEmail = (s) => {
    if (!s) return false;
    return s.split(/[,;\s]+/).filter(Boolean).every((e) => EMAIL_RE.test(e));
  };

  const counts = useMemo(() => {
    let mapped = 0; let invalid = 0; let missing = 0;
    vendors.forEach((v) => {
      const { email } = rowValue(v);
      if (!email) missing += 1;
      else if (!validEmail(email)) invalid += 1;
      else mapped += 1;
    });
    return { all: vendors.length, mapped, invalid, missing };
  }, [vendors, edits]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return vendors.filter((v) => {
      const { email } = rowValue(v);
      if (filter === 'missing' && email) return false;
      if (filter === 'invalid' && !(email && !validEmail(email))) return false;
      if (filter === 'mapped' && !(email && validEmail(email))) return false;
      if (needle && !v.vendor.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [vendors, q, filter, edits]);

  const dirtyCount = Object.keys(edits).length;

  function setField(vendor, field, value) {
    setEdits((prev) => {
      const base = prev[vendor] || { email: vendors.find((x) => x.vendor === vendor)?.email || '', cc: vendors.find((x) => x.vendor === vendor)?.cc || '' };
      return { ...prev, [vendor]: { ...base, [field]: value } };
    });
  }

  async function save() {
    if (!dirtyCount) { toast({ tone: 'info', title: 'Nothing to save', body: 'Edit a Mail ID first.' }); return; }
    setBusy(true);
    try {
      const entries = Object.entries(edits).map(([vendor, v]) => ({ vendor, email: v.email, cc: v.cc }));
      const res = await api.post('/api/recipients', { entries });
      onVendors(res);
      setEdits({});
      toast({ tone: 'ok', title: 'Mappings saved', body: `${res.saved} Vendor ↔ Mail ID relation(s) stored.` });
    } catch (e) {
      toast({ tone: 'err', title: 'Save failed', body: e.message });
    } finally { setBusy(false); }
  }

  async function pasteImport() {
    if (!pasteText.trim()) return;
    setBusy(true);
    try {
      const res = await api.post('/api/recipients/paste', { text: pasteText });
      onVendors(res);
      setPasteOpen(false); setPasteText('');
      toast({ tone: 'ok', title: 'Pasted list imported', body: `${res.imported} line(s) parsed · ${res.stored} mapping(s) active.` });
    } catch (e) {
      toast({ tone: 'err', title: 'Import failed', body: e.message });
    } finally { setBusy(false); }
  }

  async function uploadFile(file) {
    if (!file) return;
    setBusy(true);
    try {
      const res = await api.upload('/api/recipients/upload', file);
      if (res.error) throw new Error(res.error);
      onVendors(res);
      setImportInfo({ file: file.name, imported: res.imported, vendorCol: res.vendorCol, emailCol: res.emailCol });
      toast({ tone: 'ok', title: 'Mapping file imported', body: `${res.imported} vendor ↔ mail ID pairs (${res.vendorCol} → ${res.emailCol}).` });
    } catch (e) {
      setImportInfo({ file: file.name, error: e.message });
      toast({ tone: 'err', title: 'Mapping file not usable', body: e.message });
    } finally { setBusy(false); }
  }

  async function clearAll() {
    setBusy(true);
    try {
      const res = await api.del('/api/recipients');
      onVendors(res);
      setEdits({});
      setImportInfo(null);
      toast({ tone: 'info', title: 'Mappings cleared', body: 'All stored Vendor ↔ Mail ID relations were removed.' });
    } catch (e) {
      toast({ tone: 'err', title: 'Could not clear', body: e.message });
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile icon={CircleCheck} tone="green" label="Ready to send" value={fmtInt(counts.mapped)} sub="valid Mail ID mapped" />
        <Tile icon={AlertTriangle} tone="amber" label="Missing Mail ID" value={fmtInt(counts.missing)} sub="blocked from campaign" />
        <Tile icon={AlertTriangle} tone="rose" label="Invalid address" value={fmtInt(counts.invalid)} sub="fails email syntax" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <Card>
          <div className="card-hd"><p className="card-title">Bulk import</p></div>
          <div className="space-y-3 p-4">
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); uploadFile(e.dataTransfer.files?.[0]); }}
              className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-ink-200 bg-ink-50/50 px-3 py-6 text-center transition hover:border-brand-400 hover:bg-brand-50/40"
            >
              <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.csv" hidden onChange={(e) => uploadFile(e.target.files?.[0])} />
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-brand-600 ring-1 ring-ink-100"><Upload className="h-5 w-5" /></span>
              <p className="mt-2 text-[12.5px] font-bold text-ink-800">Upload mapping file</p>
              <p className="text-[11px] text-ink-400">Vendor Name + Mail ID columns (.xlsx / .csv)</p>
            </div>
            {importInfo && (
              <div className={cls('rounded-lg p-2.5 text-[11.5px]', importInfo.error ? 'bg-rose-100/60 text-rose-600' : 'bg-mint-100/70 text-emerald-700')}>
                {importInfo.error ? importInfo.error : `${importInfo.imported} rows imported · ${importInfo.vendorCol} → ${importInfo.emailCol}`}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button className="btn" onClick={() => setPasteOpen(true)}><ClipboardPaste className="h-4 w-4" /> Paste list</button>
              <a className="btn" href="/api/recipients/template.csv"><Download className="h-4 w-4" /> Template</a>
            </div>
            <button className="btn btn-danger w-full" onClick={clearAll} disabled={busy}><Trash2 className="h-4 w-4" /> Clear all mappings</button>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="bg-brand-sheen text-white">
            <div className="p-5">
              <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.09em] text-brand-200/80">
                <UserRound className="h-3.5 w-3.5" /> Relation rule
              </p>
              <p className="mt-2 font-display text-[17px] font-extrabold leading-snug">One Vendor Name ↔ one Mail ID</p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-brand-100/80">
                Multiple recipients are allowed inside a single Mail ID field (comma separated). The mapping follows
                the merged vendor, so all name variants share the same inbox.
              </p>
              <div className="mt-3 rounded-xl border border-white/15 bg-white/[.07] p-2.5 font-mono text-[11px] text-brand-100">
                DEELMO → accounts@deelmo.com<br />
                Store Tag → ap@storetag.in
              </div>
            </div>
          </Card>
          <Card>
            <div className="card-hd"><p className="card-title">Paste format</p></div>
            <div className="space-y-2 p-4 text-[12px] text-ink-500">
              <p>One vendor per line, tab/comma/pipe separated:</p>
              <pre className="rounded-lg bg-ink-950 p-3 font-mono text-[11px] leading-relaxed text-brand-100">{`DEELMO, accounts@deelmo.com
COLEBROOK, billing@colebrook.in, cc@me.com
STORE TAG\tap@storetag.in`}</pre>
              <button className="btn btn-sm w-full" onClick={() => setPasteOpen(true)}><ClipboardPaste className="h-3.5 w-3.5" /> Paste a list</button>
            </div>
          </Card>
        </div>
      </div>

      <Card className="flex flex-col">
          <div className="card-hd">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <div className="relative min-w-[180px] flex-1 max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
                <input className="input pl-9" placeholder="Search vendor…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <Segmented value={filter} onChange={setFilter} options={[
                { value: 'all', label: 'All', count: counts.all },
                { value: 'missing', label: 'Missing', count: counts.missing },
                { value: 'invalid', label: 'Invalid', count: counts.invalid },
                { value: 'mapped', label: 'Mapped', count: counts.mapped },
              ]} />
            </div>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={busy || !dirtyCount}>
              {busy ? <Spinner /> : <Save className="h-3.5 w-3.5" />} Save {dirtyCount ? `(${dirtyCount})` : 'all'}
            </button>
          </div>
          <div className="max-h-[58vh] flex-1 overflow-auto">
            <table className="w-full table-fixed min-w-[720px]">
              <colgroup>
                <col style={{ width: '36%' }} />
                <col style={{ width: '34%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '10%' }} />
              </colgroup>
              <thead><tr>
                <th className="th">Vendor</th>
                <th className="th">Mail ID (To)</th>
                <th className="th">CC</th>
                <th className="th">State</th>
              </tr></thead>
              <tbody>
                {filtered.map((v) => {
                  const { email, cc } = rowValue(v);
                  const invalid = email && !validEmail(email);
                  const dirty = Boolean(edits[v.vendor]);
                  return (
                    <tr key={v.vendor} className="row">
                      <td className="td">
                        <button onClick={() => openVendor(v.vendor)} className="flex items-center gap-2.5 text-left">
                          <Avatar name={v.vendor} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-ink-900">{v.vendor}</p>
                            <p className="text-[10.5px] text-ink-400">{fmtInt(v.rows)} rows · {v.match.variantCount} variant(s)</p>
                          </div>
                        </button>
                      </td>
                      <td className="td">
                        <input
                          className={cls('input w-full !py-1.5 !text-[12px]', invalid && '!border-rose-400 !bg-rose-50/50')}
                          value={email} placeholder="vendor@example.com" spellCheck={false}
                          onChange={(e) => setField(v.vendor, 'email', e.target.value)}
                        />
                      </td>
                      <td className="td">
                        <input className="input w-full !py-1.5 !text-[12px]" value={cc} placeholder="cc@yourcompany.com" spellCheck={false}
                          onChange={(e) => setField(v.vendor, 'cc', e.target.value)} />
                      </td>
                      <td className="td">
                        {invalid ? <Badge tone="red" dot>invalid</Badge>
                          : email ? <Badge tone="green" dot>mapped</Badge>
                          : <Badge tone="amber" dot>missing</Badge>}
                        {dirty && <Badge tone="blue" className="ml-1">edited</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!filtered.length && <EmptyState icon={AtSign} title="No vendors here" hint="Adjust the search or filter." />}
          </div>
      </Card>

      <Modal
        open={pasteOpen} onClose={() => setPasteOpen(false)}
        title="Paste Vendor ↔ Mail ID list"
        subtitle="Tab, comma, semicolon or pipe separated. Extra @ values are treated as additional recipients."
        footer={<>
          <button className="btn" onClick={() => setPasteOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={pasteImport} disabled={busy || !pasteText.trim()}>
            {busy ? <Spinner /> : <ClipboardPaste className="h-4 w-4" />} Import list
          </button>
        </>}
      >
        <textarea className="textarea min-h-[220px]" value={pasteText} onChange={(e) => setPasteText(e.target.value)}
          placeholder={'DEELMO, accounts@deelmo.com\nCOLEBROOK, billing@colebrook.in, cc@yourcompany.com'} />
      </Modal>
    </div>
  );
}

function Tile({ icon: Icon, tone, label, value, sub }) {
  const tones = {
    green: 'text-emerald-600 bg-mint-100 ring-emerald-500/10',
    amber: 'text-amber-600 bg-amberish-100 ring-amber-500/10',
    rose: 'text-rose-500 bg-rose-100 ring-rose-500/10',
  };
  return (
    <Card className="flex items-center gap-3.5 p-4">
      <span className={cls('grid h-11 w-11 place-items-center rounded-xl ring-1', tones[tone])}><Icon className="h-5 w-5" /></span>
      <div>
        <p className="stat-label">{label}</p>
        <p className="font-display text-2xl font-extrabold text-ink-900">{value}</p>
        <p className="text-[11px] text-ink-400">{sub}</p>
      </div>
    </Card>
  );
}
