import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Users, Rows3, BadgeIndianRupee, AtSign, GitMerge, AlertTriangle, ArrowUpRight,
  UploadCloud, Send, Sparkles, ChevronRight,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
  PieChart, Pie,
} from 'recharts';
import { Card, Badge, Avatar, EmptyState } from '../components/ui';
import { NextStepCard } from '../components/Flow';
import { fmtInt, fmtINR, compactINR, timeAgo } from '../lib/format';

const STATUS_COLORS = { Matched: '#19c37d', Unmatched: '#ef4444', 'Value Mismatch': '#f59e0b' };

export default function Dashboard({ state, setRoute, openVendor, openSettings, done }) {
  const vendors = state.vendors || [];
  const stats = state.stats;

  const totals = useMemo(() => {
    const rows = vendors.reduce((a, v) => a + v.rows, 0);
    const gst = vendors.reduce((a, v) => a + v.gst, 0);
    const mapped = vendors.filter((v) => v.recipients?.length && v.emailValid).length;
    const statuses = {};
    vendors.forEach((v) => Object.entries(v.statusCounts || {}).forEach(([k, n]) => { statuses[k] = (statuses[k] || 0) + n; }));
    return { rows, gst, mapped, statuses };
  }, [vendors]);

  const topVendors = useMemo(() => vendors.slice(0, 8).map((v) => ({
    name: v.vendor.length > 18 ? `${v.vendor.slice(0, 17)}…` : v.vendor,
    full: v.vendor,
    rows: v.rows,
    gst: Math.abs(v.gst),
  })), [vendors]);

  const statusData = Object.entries(totals.statuses)
    .filter(([k]) => k !== '—')
    .map(([name, value]) => ({ name, value }));

  const mergeGroups = vendors.filter((v) => v.match.variantCount > 1).length;
  const reviewCount = vendors.filter((v) => v.match.kind === 'fuzzy').length;
  const missingTab = vendors.filter((v) => !v.tab1Rows || !v.tab2Rows).length;

  const tabsRows = (stats?.tabs || []).map((t) => ({
    name: t.label.length > 16 ? `${t.label.slice(0, 15)}…` : t.label,
    rows: t.rows,
  }));

  if (!state.loaded) {
    return (
      <div className="space-y-5">
        <NextStepCard state={state} done={done} setRoute={setRoute} openSettings={openSettings} />
        <div className="grid gap-4 lg:grid-cols-3">
          {[
            { icon: UploadCloud, title: '1 · Import a 2-tab workbook', body: 'Purchase register + GSTR-2B portal export. Vendor names, GSTINs and ₹ amounts are detected automatically.', cta: 'Import workbook', route: 'upload' },
            { icon: GitMerge, title: '2 · Match vendor names', body: 'Casing, spacing, dots and Ltd/Limited variants collapse into one vendor. Fuzzy pairs wait for your approval.', cta: 'Review matching', route: 'matching' },
            { icon: Send, title: '3 · Map mail IDs & send', body: 'One Mail ID per vendor, a GST summary in the body and the full 2-tab Excel attached. Dry-run first, then send.', cta: 'Open sending', route: 'campaign' },
          ].map((s, i) => (
            <motion.div key={s.title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
              <Card className="group h-full p-5 transition hover:-translate-y-0.5 hover:shadow-lift">
                <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-500/10">
                  <s.icon className="h-5 w-5" />
                </div>
                <p className="font-display text-[14px] font-bold text-ink-900">{s.title}</p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-500">{s.body}</p>
                <button onClick={() => setRoute(s.route)} className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-brand-600 group-hover:gap-2 transition-all">
                  {s.cta} <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <NextStepCard state={state} done={done} setRoute={setRoute} openSettings={openSettings} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Users} label="Matched vendors" value={fmtInt(stats.vendorCount)} sub={`from ${fmtInt(stats.rawNameCount)} raw names`} tone="brand" />
        <Stat icon={Rows3} label="Records in scope" value={fmtInt(totals.rows)} sub={`${stats.tabs.map((t) => fmtInt(t.rows)).join(' + ')} rows`} tone="ink" />
        <Stat icon={BadgeIndianRupee} label="Total GST" value={compactINR(totals.gst)} sub={fmtINR(totals.gst)} tone="mint" />
        <Stat icon={AtSign} label="Mail-ready vendors" value={`${fmtInt(totals.mapped)}/${fmtInt(vendors.length)}`} sub={`${fmtInt(vendors.length - totals.mapped)} missing / invalid`} tone="amber" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="card-hd">
            <div>
              <p className="card-title">Biggest vendors by rows</p>
              <p className="card-sub">All rows are attached — bar length is record count</p>
            </div>
            <button className="btn btn-sm ml-auto" onClick={() => setRoute('matching')}>Open matching <ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
          <div className="h-[290px] px-2 pb-2 pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topVendors} margin={{ left: 4, right: 12, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e6eef4" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: '#6e8ba0' }} interval={0} angle={-18} textAnchor="end" height={52} />
                <YAxis tick={{ fontSize: 10.5, fill: '#6e8ba0' }} tickFormatter={(v) => fmtInt(v)} width={48} />
                <Tooltip
                  cursor={{ fill: 'rgba(34,167,192,.06)' }}
                  formatter={(v) => [fmtInt(v), 'Rows']}
                  labelFormatter={(l) => topVendors.find((t) => t.name === l)?.full || l}
                  contentStyle={{ borderRadius: 12, border: '1px solid #e6eef4', fontSize: 12, boxShadow: '0 12px 30px -14px rgba(10,30,46,.3)' }}
                />
                <Bar dataKey="rows" radius={[7, 7, 0, 0]}>
                  {topVendors.map((_, i) => (
                    <Cell key={_} fill={i === 0 ? '#0b7285' : i < 3 ? '#22a7c0' : '#5fc6da'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <div className="card-hd">
            <div>
              <p className="card-title">Match status split</p>
              <p className="card-sub">Every status is included in the mail</p>
            </div>
          </div>
          <div className="h-[210px] pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={3} strokeWidth={2}>
                  {statusData.map((s) => <Cell key={s.name} fill={STATUS_COLORS[s.name] || '#9db2c2'} />)}
                </Pie>
                <Tooltip formatter={(v, n) => [fmtInt(v), n]} contentStyle={{ borderRadius: 12, border: '1px solid #e6eef4', fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5 px-5 pb-5">
            {statusData.map((s) => (
              <div key={s.name} className="flex items-center gap-2 text-[12px]">
                <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLORS[s.name] || '#9db2c2' }} />
                <span className="text-ink-500">{s.name}</span>
                <span className="ml-auto font-semibold text-ink-800">{fmtInt(s.value)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="card-hd">
            <div>
              <p className="card-title">Vendor leaderboard</p>
              <p className="card-sub">Click a vendor for the full breakdown</p>
            </div>
            <Badge tone="teal" className="ml-auto">{fmtInt(vendors.length)} vendors</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Vendor</th>
                  <th className="th text-right">Tab 1</th>
                  <th className="th text-right">Tab 2</th>
                  <th className="th text-right">Total rows</th>
                  <th className="th text-right">Total GST</th>
                  <th className="th">Mail ID</th>
                </tr>
              </thead>
              <tbody>
                {vendors.slice(0, 7).map((v) => (
                  <tr key={v.vendor} className="row cursor-pointer" onClick={() => openVendor(v.vendor)}>
                    <td className="td">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={v.vendor} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink-900">{v.vendor}</p>
                          <p className="text-[10.5px] text-ink-400">{v.match.variantCount} name variant{v.match.variantCount > 1 ? 's' : ''}</p>
                        </div>
                      </div>
                    </td>
                    <td className="td text-right tabular-nums text-ink-500">{fmtInt(v.tab1Rows)}</td>
                    <td className="td text-right tabular-nums text-ink-500">{fmtInt(v.tab2Rows)}</td>
                    <td className="td text-right font-bold tabular-nums">{fmtInt(v.rows)}</td>
                    <td className="td text-right tabular-nums font-semibold text-brand-700">{compactINR(v.gst)}</td>
                    <td className="td">
                      {v.recipients?.length
                        ? <span className="truncate text-[11.5px] text-ink-500">{v.recipients[0]}{v.recipients.length > 1 ? ` +${v.recipients.length - 1}` : ''}</span>
                        : <Badge tone="amber">missing</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="card-hd"><p className="card-title">Needs your attention</p></div>
            <div className="space-y-2 p-4">
              <AttentionRow icon={GitMerge} tone="teal" label="Merged name groups" value={mergeGroups} hint="auto-collapsed variants" onClick={() => setRoute('matching')} />
              <AttentionRow icon={Sparkles} tone="amber" label="Fuzzy pairs to review" value={reviewCount} hint="similar but unconfirmed" onClick={() => setRoute('matching')} />
              <AttentionRow icon={AlertTriangle} tone="red" label="Vendors in one tab only" value={missingTab} hint="no rows on the other sheet" onClick={() => setRoute('matching')} />
              <AttentionRow icon={AtSign} tone="amber" label="Vendors without Mail ID" value={vendors.length - totals.mapped} hint="blocked from sending" onClick={() => setRoute('mapping')} />
            </div>
          </Card>

          <Card>
            <div className="card-hd"><p className="card-title">Rows per sheet</p></div>
            <div className="h-[150px] px-2 pb-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tabsRows} margin={{ left: 0, right: 8, top: 8, bottom: 4 }} barCategoryGap="32%">
                  <CartesianGrid stroke="#eef3f7" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6e8ba0' }} tickLine={false} axisLine={false} />
                  <YAxis hide domain={[0, 'dataMax']} />
                  <Tooltip formatter={(v) => [fmtInt(v), 'Rows']} contentStyle={{ borderRadius: 12, border: '1px solid #e6eef4', fontSize: 12 }} />
                  <Bar dataKey="rows" radius={[8, 8, 2, 2]} maxBarSize={64}>
                    {tabsRows.map((_, i) => (
                      <Cell key={i} fill={i % 2 ? '#22a7c0' : '#0b7285'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <div className="card-hd">
          <div>
            <p className="card-title">Recent send runs</p>
            <p className="card-sub">Dry runs build the attachments without delivering mail</p>
          </div>
          <button className="btn btn-sm ml-auto" onClick={() => setRoute('campaign')}><Send className="h-3.5 w-3.5" /> Open sending</button>
        </div>
        {(state.history || []).length ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>
                <th className="th">Started</th><th className="th">Mode</th><th className="th text-right">Total</th>
                <th className="th text-right">Sent</th><th className="th text-right">Failed</th><th className="th">Status</th>
              </tr></thead>
              <tbody>
                {(state.history || []).slice(0, 5).map((h) => (
                  <tr key={h.jobId} className="row">
                    <td className="td text-ink-500">{timeAgo(h.startedAt)}</td>
                    <td className="td">{h.dryRun ? <Badge tone="blue">dry run</Badge> : <Badge tone="teal">live</Badge>}</td>
                    <td className="td text-right tabular-nums">{fmtInt(h.total)}</td>
                    <td className="td text-right font-semibold tabular-nums text-emerald-600">{fmtInt(h.sent)}</td>
                    <td className="td text-right font-semibold tabular-nums text-rose-500">{fmtInt(h.failed)}</td>
                    <td className="td"><Badge tone={h.failed ? 'amber' : 'green'} dot>{h.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={Send} title="No campaigns yet" hint="Run a dry run from Preview & send to validate attachments before delivering mail." />
        )}
      </Card>
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub, tone }) {
  const tones = {
    brand: 'text-brand-600 bg-brand-50 ring-brand-500/10',
    ink: 'text-ink-600 bg-ink-100 ring-ink-400/10',
    mint: 'text-emerald-600 bg-mint-100 ring-emerald-500/10',
    amber: 'text-amber-600 bg-amberish-100 ring-amber-500/10',
  };
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="stat-label">{label}</p>
          <p className="stat-value">{value}</p>
          <p className="stat-sub mt-0.5">{sub}</p>
        </div>
        <span className={`grid h-9 w-9 place-items-center rounded-xl ring-1 ${tones[tone] || tones.brand}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </Card>
  );
}

function AttentionRow({ icon: Icon, tone, label, value, hint, onClick }) {
  const tones = { teal: 'text-brand-600 bg-brand-50', amber: 'text-amber-600 bg-amberish-100', red: 'text-rose-500 bg-rose-100' };
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl border border-ink-100 px-3 py-2.5 text-left transition hover:border-brand-200 hover:bg-brand-50/40">
      <span className={`grid h-8 w-8 place-items-center rounded-lg ${tones[tone]}`}><Icon className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-semibold text-ink-800">{label}</p>
        <p className="text-[11px] text-ink-400">{hint}</p>
      </div>
      <span className="font-display text-[15px] font-extrabold text-ink-900">{fmtInt(value)}</span>
      <ChevronRight className="h-3.5 w-3.5 text-ink-300" />
    </button>
  );
}
