import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Send, PlayCircle, Square, Download, RefreshCw, Mail, CheckCircle2, XCircle, Clock,
  Search, ChevronRight, Paperclip, Terminal, History, MailCheck, MailX, Sparkles, FileDown,
  Maximize2, X,
} from 'lucide-react';
import api from '../lib/api';
import { Card, Badge, Avatar, Progress, EmptyState, Spinner, Segmented } from '../components/ui';
import { fmtInt, fmtINR, cls } from '../lib/format';

export default function Campaign({ state, openVendor, openSettings, toast, refreshState }) {
  const vendors = state.vendors || [];
  const sendable = useMemo(() => vendors.filter((v) => v.recipients?.length && v.emailValid), [vendors]);
  const [selected, setSelected] = useState(() => new Set());
  const [q, setQ] = useState('');
  const [previewVendor, setPreviewVendor] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fullPreview, setFullPreview] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [job, setJob] = useState(null);
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(false);
  const streamRef = useRef(null);
  const logRef = useRef(null);

  useEffect(() => {
    if (!selected.size) setSelected(new Set(sendable.map((v) => v.vendor)));
  }, [sendable.length]);

  useEffect(() => {
    if (sendable.length && !previewVendor) loadPreview(sendable[0].vendor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendable.length]);

  useEffect(() => () => { streamRef.current?.close?.(); }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  async function loadPreview(vendor) {
    setPreviewVendor(vendor);
    setPreviewLoading(true);
    try {
      const res = await api.post('/api/preview', { vendor });
      setPreview(res);
    } catch (e) {
      toast({ tone: 'err', title: 'Preview failed', body: e.message });
    } finally { setPreviewLoading(false); }
  }

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return vendors.filter((v) => !n || v.vendor.toLowerCase().includes(n));
  }, [vendors, q]);

  const totals = useMemo(() => ({
    ready: sendable.length,
    rows: sendable.reduce((a, v) => a + v.rows, 0),
    blocked: vendors.length - sendable.length,
    gst: sendable.reduce((a, v) => a + v.gst, 0),
  }), [vendors, sendable]);

  async function start(dryRun) {
    const list = [...selected].filter((name) => sendable.some((v) => v.vendor === name));
    if (!list.length) {
      toast({ tone: 'err', title: 'No vendors selected', body: 'Pick at least one vendor with a valid Mail ID.' });
      return;
    }
    setLog([]); setJob(null); setRunning(true);
    try {
      const res = await api.post('/api/send', { vendors: list, dryRun, delaySeconds: state.settings?.smtp?.delaySeconds });
      setJob({ id: res.id, total: res.total, dryRun, processed: 0, sent: 0, failed: 0, skipped: 0, status: 'running', entries: [] });
      if (res.skippedNoEmail?.length) {
        setLog((l) => [...l, { kind: 'warn', text: `Skipped (no Mail ID): ${res.skippedNoEmail.slice(0, 6).join(', ')}${res.skippedNoEmail.length > 6 ? '…' : ''}` }]);
      }
      streamJob(res.id);
    } catch (e) {
      setRunning(false);
      toast({ tone: 'err', title: 'Could not start sending', body: e.message });
    }
  }

  function streamJob(id) {
    streamRef.current?.close?.();
    const es = new EventSource(`/api/send/${id}/stream`);
    streamRef.current = es;
    es.onmessage = (evt) => {
      const data = JSON.parse(evt.data);
      setJob(data);
      if (data.type === 'entry' && data.entry) {
        setLog((l) => [...l, { kind: data.entry.status, text: formatEntry(data.entry), entry: data.entry }]);
      }
      if (data.type === 'current' && data.current) {
        if (data.current !== previewVendor) loadPreview(data.current);
      }
      if (data.type === 'done') {
        setRunning(false);
        es.close();
        refreshState?.();
        toast({
          tone: data.failed ? 'err' : 'ok',
          title: data.dryRun ? 'Dry run complete' : 'Bulk send complete',
          body: `${fmtInt(data.sent)} sent · ${fmtInt(data.failed)} failed · ${fmtInt(data.skipped)} dry-run`,
        });
      }
    };
    es.onerror = () => {
      es.close();
      // fall back to polling once
      api.get(`/api/send/${id}`).then((snap) => {
        setJob(snap);
        if (snap.status !== 'running') setRunning(false);
      }).catch(() => {});
    };
  }

  async function cancel() {
    if (!job) return;
    try { await api.post(`/api/send/${job.id}/cancel`); toast({ tone: 'info', title: 'Stopping', body: 'Cancelling after the current vendor…' }); }
    catch (e) { toast({ tone: 'err', title: 'Cancel failed', body: e.message }); }
  }

  const progress = job?.total ? Math.round((job.processed / job.total) * 100) : 0;

  if (!state.loaded) {
    return <Card><div className="p-10 text-center text-sm text-ink-400">Import a workbook and map Mail IDs to start sending.</div></Card>;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat icon={MailCheck} label="Vendors ready" value={`${fmtInt(totals.ready)}/${fmtInt(vendors.length)}`} sub="valid Mail ID" tone="green" />
        <MiniStat icon={FileDown} label="Rows in attachments" value={fmtInt(totals.rows)} sub="both tabs, all statuses" tone="brand" />
        <MiniStat icon={MailX} label="Blocked" value={fmtInt(totals.blocked)} sub="missing / invalid Mail ID" tone="amber" />
        <MiniStat icon={Clock} label="Pace" value={`${state.settings?.smtp?.delaySeconds ?? 1.2}s`} sub="auto-tuned after a run" tone="ink" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        {/* ---------------- vendor picker ---------------- */}
        <Card className="flex max-h-[720px] flex-col">
          <div className="card-hd">
            <div className="min-w-0">
              <p className="card-title">Audience</p>
              <p className="card-sub">{fmtInt(selected.size)} selected</p>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <button className="btn btn-sm" onClick={() => setSelected(new Set(sendable.map((v) => v.vendor)))}>All</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>None</button>
            </div>
          </div>
          <div className="border-b border-ink-100 px-3 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-300" />
              <input className="input !py-1.5 !pl-8 !text-[12px]" placeholder="Filter vendors…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {filtered.map((v) => {
              const ready = v.recipients?.length && v.emailValid;
              const checked = selected.has(v.vendor);
              return (
                <div key={v.vendor}
                  className={cls('flex cursor-pointer items-center gap-2.5 border-b border-ink-100/70 px-3 py-2.5 transition',
                    previewVendor === v.vendor ? 'bg-brand-50/70' : 'hover:bg-ink-50/60')}
                  onClick={() => loadPreview(v.vendor)}>
                  <input type="checkbox" checked={checked} disabled={!ready}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(v.vendor); else next.delete(v.vendor);
                        return next;
                      });
                    }}
                    className="h-4 w-4 rounded border-ink-300 accent-brand-600" />
                  <Avatar name={v.vendor} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold text-ink-900">{v.vendor}</p>
                    <p className="truncate text-[10.5px] text-ink-400">{fmtInt(v.rows)} rows · {v.recipients?.[0] || 'no mail id'}</p>
                  </div>
                  <Badge tone={v.match.kind === 'fuzzy' ? 'amber' : 'green'} className="shrink-0">{v.match.kind}</Badge>
                </div>
              );
            })}
            {!filtered.length && <EmptyState icon={Search} title="No vendors" hint="Clear the filter." />}
          </div>
        </Card>

        {/* ---------------- preview + actions ---------------- */}
        <div className="space-y-4">
          <Card>
            <div className="card-hd">
              <div className="min-w-0">
                <p className="card-title">Email preview</p>
                <p className="card-sub truncate">{preview ? preview.subject : 'Select a vendor'}</p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {preview?.to ? <Badge tone="green">{preview.to}</Badge> : <Badge tone="amber">no recipient</Badge>}
                {previewVendor && (
                  <a className="btn btn-sm" href={`/api/vendor/${encodeURIComponent(previewVendor)}/attachment`}>
                    <Paperclip className="h-3.5 w-3.5" /> Attachment
                  </a>
                )}
                {preview && (
                  <button className="btn btn-sm btn-ghost" onClick={() => setFullPreview(true)}>
                    <Maximize2 className="h-3.5 w-3.5" /> Full view
                  </button>
                )}
                <button className="btn btn-sm btn-ghost" onClick={openSettings}>Edit template</button>
              </div>
            </div>
            <div className="relative bg-ink-100/70 p-3">
              {previewLoading && (
                <div className="absolute inset-0 z-10 grid place-items-center bg-white/70 backdrop-blur-sm">
                  <Spinner className="h-5 w-5 text-brand-600" />
                </div>
              )}
              <iframe
                title="Email preview"
                className="h-[560px] w-full rounded-xl border border-ink-100 bg-white"
                sandbox=""
                srcDoc={preview?.html || '<div style="font-family:sans-serif;padding:40px;color:#94a3b8">Email preview appears here.</div>'}
              />
            </div>
            {preview && (
              <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 px-4 py-3 text-[11.5px] text-ink-500">
                <Badge tone="teal">{fmtInt(preview.attachment.rows)} rows attached</Badge>
                <span>{preview.attachment.name}</span>
                <span className="text-ink-300">·</span>
                <span>{fmtInt(preview.attachment.tab1Rows)} + {fmtInt(preview.attachment.tab2Rows)} across both tabs</span>
              </div>
            )}
          </Card>

          <Card>
            <div className="card-hd">
              <div>
                <p className="card-title">Run campaign</p>
                <p className="card-sub">Dry run builds every attachment without sending — safest first step.</p>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <button className="btn btn-sm" onClick={() => start(true)} disabled={running}>
                  <PlayCircle className="h-4 w-4" /> Dry run
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => start(false)} disabled={running}>
                  <Send className="h-4 w-4" /> Send {fmtInt(selected.size)} mails
                </button>
              </div>
            </div>

            {(job || log.length > 0) && (
              <div className="space-y-3 px-4 py-4">
                <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-500">
                  <span className="font-semibold text-ink-800">{fmtInt(job?.processed || 0)} / {fmtInt(job?.total || 0)}</span>
                  <Badge tone="green" dot>sent {fmtInt(job?.sent || 0)}</Badge>
                  <Badge tone="red" dot>failed {fmtInt(job?.failed || 0)}</Badge>
                  <Badge tone="gray" dot>dry {fmtInt(job?.skipped || 0)}</Badge>
                  <Badge tone="blue" dot>{(job?.transport || (state.settings?.deliveryMode === 'gmail' ? 'gmail-api' : 'smtp')) === 'gmail-api' ? 'Gmail API' : 'SMTP'}</Badge>
                  {job?.current && <span className="ml-2 inline-flex items-center gap-1.5 text-brand-700"><Spinner className="h-3 w-3" /> {job.current}</span>}
                  <div className="ml-auto flex items-center gap-1.5">
                    {running && <button className="btn btn-sm btn-danger" onClick={cancel}><Square className="h-3.5 w-3.5" /> Stop</button>}
                    {job?.id && (
                      <a className="btn btn-sm" href={`/api/send/${job.id}/log.csv`}><Download className="h-3.5 w-3.5" /> Log CSV</a>
                    )}
                  </div>
                </div>
                <Progress value={progress} tone={job?.failed ? 'red' : running ? 'brand' : 'green'} />
                <div ref={logRef} className="max-h-[240px] overflow-auto rounded-xl bg-ink-950 p-3 font-mono text-[11px] leading-relaxed text-brand-100/90">
                  {log.length === 0 && <p className="text-brand-200/50">Waiting for the first vendor…</p>}
                  {log.map((l, i) => (
                    <p key={i} className={cls(
                      l.kind === 'sent' ? 'text-emerald-300' : l.kind === 'failed' ? 'text-rose-300' : l.kind === 'dry_run' ? 'text-brand-200/70' : 'text-amber-200',
                    )}>
                      <span className="mr-1 text-brand-200/40">[{l.kind === 'sent' ? 'SENT' : l.kind === 'failed' ? 'FAIL' : l.kind === 'dry_run' ? 'DRY ' : 'INFO'}]</span>
                      {l.text}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card>
        <div className="card-hd">
          <p className="card-title inline-flex items-center gap-2"><History className="h-4 w-4 text-ink-400" /> Campaign history</p>
          <button className="btn btn-sm ml-auto" onClick={refreshState}><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
        </div>
        {(state.history || []).length ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>
                <th className="th">Started</th><th className="th">Mode</th><th className="th text-right">Total</th>
                <th className="th text-right">Sent</th><th className="th text-right">Failed</th><th className="th text-right">Dry</th><th className="th">Status</th>
              </tr></thead>
              <tbody>
                {(state.history || []).map((h) => (
                  <tr key={h.jobId} className="row">
                    <td className="td text-ink-500">{new Date(h.startedAt).toLocaleString('en-IN')}</td>
                    <td className="td">{h.dryRun ? <Badge tone="blue">dry run</Badge> : <Badge tone="teal">live</Badge>}</td>
                    <td className="td text-right tabular-nums">{fmtInt(h.total)}</td>
                    <td className="td text-right font-semibold tabular-nums text-emerald-600">{fmtInt(h.sent)}</td>
                    <td className="td text-right font-semibold tabular-nums text-rose-500">{fmtInt(h.failed)}</td>
                    <td className="td text-right tabular-nums text-ink-400">{fmtInt(h.skipped)}</td>
                    <td className="td"><Badge tone={h.failed ? 'amber' : 'green'} dot>{h.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon={Send} title="No campaigns yet" hint="Start with a dry run to validate every attachment." />}
      </Card>

      {fullPreview && preview && (
        <div className="fixed inset-0 z-50 flex flex-col bg-ink-950/70 p-4 backdrop-blur-sm" onClick={() => setFullPreview(false)}>
          <div className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-ink-100 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-display text-[14px] font-bold text-ink-900">{preview.subject}</p>
                <p className="text-[11.5px] text-ink-400">Full email preview - {fmtInt(preview.attachment.rows)} rows attached - {preview.attachment.name}</p>
              </div>
              <button className="btn btn-sm ml-auto" onClick={() => setFullPreview(false)}>
                <X className="h-3.5 w-3.5" /> Close
              </button>
            </div>
            <iframe title="Full email preview" className="w-full flex-1 bg-white" sandbox="" srcDoc={preview.html} />
          </div>
        </div>
      )}

    </div>
  );
}

function formatEntry(e) {
  const target = (e.to || []).join(', ') || '—';
  const size = e.attachmentKb ? ` · ${e.attachmentKb} KB` : '';
  const message = e.status === 'failed' ? ` · ${e.message}` : '';
  return `${e.vendor} → ${target}${size}${message}`;
}

function MiniStat({ icon: Icon, label, value, sub, tone }) {
  const tones = {
    green: 'text-emerald-600 bg-mint-100 ring-emerald-500/10',
    brand: 'text-brand-600 bg-brand-50 ring-brand-500/10',
    amber: 'text-amber-600 bg-amberish-100 ring-amber-500/10',
    ink: 'text-ink-600 bg-ink-100 ring-ink-400/10',
  };
  return (
    <Card className="flex items-center gap-3.5 p-4">
      <span className={cls('grid h-11 w-11 place-items-center rounded-xl ring-1', tones[tone])}><Icon className="h-5 w-5" /></span>
      <div>
        <p className="stat-label">{label}</p>
        <p className="font-display text-xl font-extrabold text-ink-900">{value}</p>
        <p className="text-[11px] text-ink-400">{sub}</p>
      </div>
    </Card>
  );
}
