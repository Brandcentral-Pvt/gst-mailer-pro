import React, { useEffect, useState } from 'react';
import { Download, Mail, Layers, FileSpreadsheet, BadgeIndianRupee, Rows3, CalendarRange, Fingerprint } from 'lucide-react';
import api from '../lib/api';
import { Drawer, Badge, Avatar, Spinner } from './ui';
import { fmtInt, fmtINR, cls } from '../lib/format';

export default function VendorDrawer({ vendor, onClose, toast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!vendor) { setData(null); return; }
    setLoading(true);
    api.get(`/api/vendor/${encodeURIComponent(vendor)}`)
      .then(setData)
      .catch((e) => toast({ tone: 'err', title: 'Could not load vendor', body: e.message }))
      .finally(() => setLoading(false));
  }, [vendor]);

  const summary = data?.summary;

  return (
    <Drawer
      open={Boolean(vendor)} onClose={onClose} width="max-w-3xl"
      title={vendor || 'Vendor'}
      subtitle={summary ? `${fmtInt(summary.totalRows)} rows · ${fmtINR(summary.totalGst)} total GST` : 'Loading vendor detail…'}
      footer={vendor && (
        <a className="btn btn-primary" href={`/api/vendor/${encodeURIComponent(vendor)}/attachment`}>
          <Download className="h-4 w-4" /> Download Excel attachment
        </a>
      )}
    >
      {loading && !data && <div className="grid place-items-center py-16"><Spinner className="h-6 w-6 text-brand-600" /></div>}
      {summary && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl border border-ink-100 bg-ink-50/60 p-3.5">
            <Avatar name={vendor} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[15px] font-extrabold text-ink-900">{vendor}</p>
              <p className="text-[11.5px] text-ink-400">
                {summary.aliases.length > 1 ? `${summary.aliases.length} name variants merged` : 'single name variant'} · {summary.dateRange}
              </p>
            </div>
            <Badge tone={data.recipient.email ? 'green' : 'amber'}>{data.recipient.email || 'no mail id'}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Metric icon={Rows3} label="Total rows" value={fmtInt(summary.totalRows)} />
            <Metric icon={BadgeIndianRupee} label="Total GST" value={fmtINR(summary.totalGst)} small />
            <Metric icon={Fingerprint} label="GSTINs" value={summary.gstins.length} />
            <Metric icon={CalendarRange} label="Period" value={summary.dateRange} small />
          </div>

          <div>
            <p className="label">Sheet break-up</p>
            <div className="overflow-hidden rounded-xl border border-ink-100">
              <table className="w-full">
                <thead><tr>
                  <th className="th">Sheet</th><th className="th text-right">Rows</th><th className="th text-right">CGST</th>
                  <th className="th text-right">SGST</th><th className="th text-right">IGST</th><th className="th text-right">Total GST</th>
                </tr></thead>
                <tbody>
                  {summary.tabs.map((t) => (
                    <tr key={t.key} className="row">
                      <td className="td font-semibold text-ink-800">{t.label}</td>
                      <td className="td text-right tabular-nums">{fmtInt(t.rows)}</td>
                      <td className="td text-right tabular-nums text-ink-500">{fmtINR(t.cgst)}</td>
                      <td className="td text-right tabular-nums text-ink-500">{fmtINR(t.sgst)}</td>
                      <td className="td text-right tabular-nums text-ink-500">{fmtINR(t.igst)}</td>
                      <td className="td text-right font-bold tabular-nums text-brand-700">{fmtINR(t.totalGst)}</td>
                    </tr>
                  ))}
                  <tr className="bg-brand-50/60">
                    <td className="td font-bold text-ink-900">TOTAL</td>
                    <td className="td text-right font-bold tabular-nums">{fmtInt(summary.totalRows)}</td>
                    <td className="td text-right tabular-nums">{fmtINR(summary.cgst)}</td>
                    <td className="td text-right tabular-nums">{fmtINR(summary.sgst)}</td>
                    <td className="td text-right tabular-nums">{fmtINR(summary.igst)}</td>
                    <td className="td text-right font-bold tabular-nums text-brand-700">{fmtINR(summary.totalGst)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {Object.keys(summary.statusCounts || {}).length > 0 && (
            <div>
              <p className="label">Match status</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(summary.statusCounts).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
                  <Badge key={s} tone={/unmatch/i.test(s) ? 'red' : /mismatch/i.test(s) ? 'amber' : /match/i.test(s) ? 'green' : 'gray'}>
                    {s}: {fmtInt(n)}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="label">Name variants</p>
            <div className="flex flex-wrap gap-1.5">
              {summary.aliases.map((a) => (
                <span key={a} className={cls('rounded-md px-2 py-1 text-[11px] font-medium ring-1',
                  a === vendor ? 'bg-brand-50 text-brand-700 ring-brand-500/20' : 'bg-ink-50 text-ink-600 ring-ink-100')}>
                  {a}
                </span>
              ))}
            </div>
          </div>

          {data.tabs.map((t) => t.sample.length > 0 && (
            <div key={t.label}>
              <p className="label inline-flex items-center gap-1.5"><Layers className="h-3.5 w-3.5" /> {t.label} · sample rows</p>
              <div className="overflow-x-auto rounded-xl border border-ink-100">
                <table className="w-full text-[11px]">
                  <thead><tr>{t.columns.slice(0, 6).map((c) => <th key={c} className="th !text-[10px]">{c}</th>)}</tr></thead>
                  <tbody>
                    {t.sample.map((r, i) => (
                      <tr key={i} className="row">
                        {t.columns.slice(0, 6).map((c) => <td key={c} className="td !py-1.5 !text-[11px] max-w-[160px] truncate">{r[c]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <div className="flex items-center gap-2 rounded-xl border border-brand-500/15 bg-brand-50/60 p-3 text-[11.5px] text-brand-800">
            <FileSpreadsheet className="h-4 w-4 shrink-0" />
            Attachment <b className="mx-1 font-mono text-[11px]">{data.attachment.name}</b> contains a Summary sheet plus every row
            from both tabs, with autofilter, frozen header and money formats.
          </div>
        </div>
      )}
    </Drawer>
  );
}

function Metric({ icon: Icon, label, value, small }) {
  return (
    <div className="rounded-xl border border-ink-100 p-2.5">
      <span className="mb-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-ink-400">
        <Icon className="h-3 w-3" /> {label}
      </span>
      <p className={cls('font-bold text-ink-900', small ? 'text-[11.5px] leading-snug' : 'font-display text-lg')}>{value}</p>
    </div>
  );
}
