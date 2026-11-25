import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Search, GitMerge, Split, Sparkles, SlidersHorizontal, CheckCheck, AlertCircle,
  ChevronRight, Users, Link2, ArrowRight, RotateCcw,
} from 'lucide-react';
import api from '../lib/api';
import { Card, Badge, Avatar, Segmented, Modal, Spinner } from '../components/ui';
import { fmtInt, cls } from '../lib/format';

export default function Matching({ state, onVendors, toast, openVendor }) {
  const vendors = state.vendors || [];
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [threshold, setThreshold] = useState(92);
  const [busy, setBusy] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(null); // vendor name
  const [mergeTarget, setMergeTarget] = useState('');

  const counts = useMemo(() => ({
    all: vendors.length,
    merged: vendors.filter((v) => v.match.variantCount > 1).length,
    review: vendors.filter((v) => v.match.kind === 'fuzzy').length,
    missing: vendors.filter((v) => !v.tab1Rows || !v.tab2Rows).length,
  }), [vendors]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return vendors.filter((v) => {
      if (filter === 'merged' && v.match.variantCount < 2) return false;
      if (filter === 'review' && v.match.kind !== 'fuzzy') return false;
      if (filter === 'missing' && v.tab1Rows && v.tab2Rows) return false;
      if (needle && !(`${v.vendor} ${(v.aliases || []).join(' ')}`.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [vendors, filter, q]);

  async function rematch() {
    setBusy(true);
    try {
      const res = await api.post('/api/rematch', { threshold });
      onVendors(res);
      toast({ tone: 'ok', title: 'Auto-match re-run', body: `${fmtInt(res.vendors.length)} vendors · ${res.vendors.filter((v) => v.match.kind === 'fuzzy').length} fuzzy pairs to review` });
    } catch (e) {
      toast({ tone: 'err', title: 'Re-match failed', body: e.message });
    } finally { setBusy(false); }
  }

  async function dropSuggestion(hit) {
    setBusy(true);
    try {
      const res = await api.post('/api/mapping/edits', { merge: [[hit.a, hit.b]] });
      onVendors(res);
      toast({ tone: 'ok', title: 'Vendors merged', body: `"${hit.a}" now rolls into "${hit.b}" (similarity ${hit.score}%)` });
    } catch (e) {
      toast({ tone: 'err', title: 'Merge failed', body: e.message });
    } finally { setBusy(false); }
  }

  async function doMerge() {
    if (!mergeOpen || !mergeTarget || mergeOpen === mergeTarget) return;
    setBusy(true);
    try {
      const res = await api.post('/api/mapping/edits', { merge: [[mergeOpen, mergeTarget]] });
      onVendors(res);
      toast({ tone: 'ok', title: 'Vendors merged', body: `All "${mergeOpen}" rows now sit under "${mergeTarget}".` });
      setMergeOpen(null);
    } catch (e) {
      toast({ tone: 'err', title: 'Merge failed', body: e.message });
    } finally { setBusy(false); }
  }

  async function split(vendor, raw) {
    setBusy(true);
    try {
      const res = await api.post('/api/mapping/edits', { split: [raw] });
      onVendors(res);
      toast({ tone: 'ok', title: 'Vendor split', body: `"${raw}" is now its own vendor with its own mail.` });
    } catch (e) {
      toast({ tone: 'err', title: 'Split failed', body: e.message });
    } finally { setBusy(false); }
  }

  if (!state.loaded) {
    return <Card><div className="p-10 text-center text-sm text-ink-400">Import a workbook first to review vendor matching.</div></Card>;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Users} label="Matched vendors" value={fmtInt(counts.all)} sub={`${fmtInt(state.stats.rawNameCount)} raw names collapsed`} />
        <KpiCard icon={GitMerge} label="Merged groups" value={fmtInt(counts.merged)} sub="case · spacing · dot · suffix" tone="teal" />
        <KpiCard icon={Sparkles} label="Fuzzy to review" value={fmtInt(counts.review)} sub="similar names auto-grouped" tone="amber" />
        <KpiCard icon={AlertCircle} label="Single-tab vendors" value={fmtInt(counts.missing)} sub="no rows on the other sheet" tone="rose" />
      </div>

      {(state.suggestions || []).length > 0 && (
        <Card>
          <div className="card-hd">
            <div>
              <p className="card-title inline-flex items-center gap-2"><Sparkles className="h-4 w-4 text-amber-500" /> Suggested merges</p>
              <p className="card-sub">Close-but-distinct names the guard did not auto-merge. Approve to consolidate.</p>
            </div>
          </div>
          <div className="flex gap-3 overflow-x-auto px-4 pb-4 pt-1">
            {(state.suggestions || []).slice(0, 12).map((hit, i) => (
              <motion.div key={`${hit.a}-${hit.b}-${i}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                className="w-[320px] shrink-0 rounded-xl border border-ink-100 bg-white p-3 shadow-sm">
                <div className="flex items-center gap-2 text-[12px] font-semibold text-ink-800">
                  <span className="truncate">{hit.a}</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-300" />
                  <span className="truncate">{hit.b}</span>
                  <Badge tone="amber" className="ml-auto shrink-0">{hit.score}%</Badge>
                </div>
                <div className="mt-2 flex gap-1.5">
                  <button className="btn btn-sm flex-1" onClick={() => dropSuggestion(hit)} disabled={busy}><CheckCheck className="h-3.5 w-3.5" /> Merge</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setQ(hit.a)}>Inspect</button>
                </div>
              </motion.div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="card-hd">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="relative min-w-[210px] flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
              <input className="input pl-9" placeholder="Search vendor or raw name…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Segmented value={filter} onChange={setFilter} options={[
              { value: 'all', label: 'All', count: counts.all },
              { value: 'merged', label: 'Merged', count: counts.merged },
              { value: 'review', label: 'Review', count: counts.review },
              { value: 'missing', label: 'One tab', count: counts.missing },
            ]} />
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-xl border border-ink-100 px-3 py-1.5 sm:flex">
              <SlidersHorizontal className="h-3.5 w-3.5 text-ink-400" />
              <span className="text-[11px] font-semibold text-ink-500">Fuzzy</span>
              <input type="range" min={80} max={100} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="w-24 accent-brand-600" />
              <span className="w-6 text-right font-mono text-[11px] font-bold text-ink-700">{threshold}</span>
            </div>
            <button className="btn btn-sm" onClick={rematch} disabled={busy}>
              {busy ? <Spinner /> : <RotateCcw className="h-3.5 w-3.5" />} Re-run auto-match
            </button>
          </div>
        </div>

        <div className="max-h-[62vh] overflow-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Vendor</th>
                <th className="th">Name variants</th>
                <th className="th text-right">Tab 1</th>
                <th className="th text-right">Tab 2</th>
                <th className="th text-right">Total</th>
                <th className="th">Match</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr key={v.vendor} className="row">
                  <td className="td">
                    <button className="flex items-center gap-2.5 text-left" onClick={() => openVendor(v.vendor)}>
                      <Avatar name={v.vendor} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink-900">{v.vendor}</p>
                        <p className="text-[10.5px] text-ink-400">{v.gstins?.[0] || 'no GSTIN'} · {v.dateRange}</p>
                      </div>
                    </button>
                  </td>
                  <td className="td">
                    <div className="flex max-w-[360px] flex-wrap gap-1">
                      {(v.aliases || []).slice(0, 4).map((a) => (
                        <span key={a} className="group inline-flex items-center gap-1 rounded-md bg-ink-50 px-1.5 py-0.5 text-[10.5px] font-medium text-ink-600 ring-1 ring-ink-100">
                          {a}
                          {a !== v.vendor && (
                            <button title="Split into its own vendor" onClick={() => split(v.vendor, a)}
                              className="text-ink-300 opacity-0 transition group-hover:opacity-100 hover:text-rose-500">
                              <Split className="h-3 w-3" />
                            </button>
                          )}
                        </span>
                      ))}
                      {(v.aliases || []).length > 4 && <span className="rounded-md bg-ink-50 px-1.5 py-0.5 text-[10.5px] text-ink-400">+{(v.aliases.length - 4)}</span>}
                    </div>
                  </td>
                  <td className="td text-right tabular-nums text-ink-500">{fmtInt(v.tab1Rows)}</td>
                  <td className="td text-right tabular-nums text-ink-500">{fmtInt(v.tab2Rows)}</td>
                  <td className="td text-right font-bold tabular-nums">{fmtInt(v.rows)}</td>
                  <td className="td">
                    {v.match.kind === 'fuzzy' ? <Badge tone="amber" dot>fuzzy {Math.round(v.match.score)}%</Badge>
                      : v.match.kind === 'suffix' ? <Badge tone="blue" dot>suffix</Badge>
                        : v.match.kind === 'manual' ? <Badge tone="teal" dot>manual</Badge>
                          : <Badge tone="green" dot>exact</Badge>}
                    {(!v.tab1Rows || !v.tab2Rows) && <Badge tone="gray" className="ml-1">1 tab</Badge>}
                  </td>
                  <td className="td">
                    <div className="flex justify-end gap-1">
                      <button className="btn btn-sm" onClick={() => openVendor(v.vendor)}>Details</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => { setMergeOpen(v.vendor); setMergeTarget(vendors.find((x) => x.vendor !== v.vendor)?.vendor || ''); }}>
                        Merge
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 text-[11.5px] text-ink-400">
          <span>Showing {fmtInt(filtered.length)} of {fmtInt(vendors.length)} vendors</span>
          <span className="inline-flex items-center gap-1"><Link2 className="h-3.5 w-3.5" /> Names are matched per vendor, never by shared GSTIN</span>
        </div>
      </Card>

      <Modal
        open={Boolean(mergeOpen)}
        onClose={() => setMergeOpen(null)}
        title="Merge vendor groups"
        subtitle="Every row from both groups will be attached to the target vendor's statement."
        footer={<>
          <button className="btn" onClick={() => setMergeOpen(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={doMerge} disabled={busy || !mergeTarget || mergeTarget === mergeOpen}>
            {busy ? <Spinner /> : <GitMerge className="h-4 w-4" />} Merge vendors
          </button>
        </>}
      >
        <div className="space-y-3">
          <div>
            <span className="label">Merge this vendor…</span>
            <div className="rounded-xl border border-ink-200 bg-ink-50/60 px-3 py-2 text-[13px] font-semibold text-ink-800">{mergeOpen}</div>
          </div>
          <div>
            <span className="label">…into this vendor</span>
            <select className="select" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
              {vendors.filter((v) => v.vendor !== mergeOpen).map((v) => (
                <option key={v.vendor} value={v.vendor}>{v.vendor} — {fmtInt(v.rows)} rows</option>
              ))}
            </select>
          </div>
          <div className="rounded-xl border border-brand-500/15 bg-brand-50/60 p-3 text-[12px] text-brand-800">
            The target name appears in the email header and in the Excel title. Rows from both groups are kept in full.
          </div>
        </div>
      </Modal>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, tone = 'brand' }) {
  const tones = {
    brand: 'text-brand-600 bg-brand-50 ring-brand-500/10',
    teal: 'text-teal-600 bg-teal-50 ring-teal-500/10',
    amber: 'text-amber-600 bg-amberish-100 ring-amber-500/10',
    rose: 'text-rose-500 bg-rose-100 ring-rose-500/10',
  };
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="stat-label">{label}</p>
          <p className="stat-value">{value}</p>
          <p className="stat-sub mt-0.5">{sub}</p>
        </div>
        <span className={cls('grid h-9 w-9 place-items-center rounded-xl ring-1', tones[tone])}><Icon className="h-4 w-4" /></span>
      </div>
    </Card>
  );
}
