import React, { useMemo } from 'react';
import {
  ArrowRight, Check, GitMerge, AtSign, Send, UploadCloud, Server, PlayCircle, Sparkles,
} from 'lucide-react';
import { cls, fmtInt } from '../lib/format';

/** One shared view of "where am I in the workflow?" — used by the nav and next-step cards. */
export function flowSummary(state = {}, done = new Set(), route = 'dashboard') {
  const doneSet = done instanceof Set ? done : new Set(done || []);
  const vendors = state.vendors || [];
  const history = state.history || [];
  const imported = Boolean(state.loaded);
  const mapped = vendors.filter((v) => v.recipients?.length && v.emailValid).length;
  const reviewCount = (state.suggestions || []).length
    + vendors.filter((v) => v.match?.kind === 'fuzzy').length;
  const settings = state.settings || {};
  const transportReady = settings.deliveryMode === 'gmail'
    ? Boolean(settings.gmail?.configured || settings.gmail?.refreshToken)
    : Boolean(settings.smtp?.configured);
  const hasHistory = history.length > 0;
  const total = vendors.length;
  const blocked = Math.max(0, total - mapped);

  const steps = [
    {
      key: 'upload', route: 'upload', label: 'Import',
      hint: imported ? 'Workbook ready' : 'Add your workbook',
      done: imported || doneSet.has('upload'),
      locked: false,
    },
    {
      key: 'matching', route: 'matching', label: 'Review names',
      hint: !imported ? 'After import' : reviewCount ? `${fmtInt(reviewCount)} to check` : 'Names grouped',
      done: imported && (reviewCount === 0 || doneSet.has('matching')),
      locked: !imported,
    },
    {
      key: 'mapping', route: 'mapping', label: 'Mail IDs',
      hint: !imported ? 'After review' : `${fmtInt(mapped)}/${fmtInt(total)} ready`,
      done: imported && total > 0 && blocked === 0,
      locked: !imported,
    },
    {
      key: 'campaign', route: 'campaign', label: 'Send',
      hint: hasHistory ? `${fmtInt(history.length)} run(s)` : 'Dry run first',
      done: hasHistory,
      locked: !imported,
    },
  ];

  const firstOpen = steps.findIndex((s) => !s.done);
  return {
    imported, mapped, total, blocked, reviewCount, transportReady, hasHistory,
    historyCount: history.length, done: doneSet, steps,
    currentStep: firstOpen < 0 ? 4 : firstOpen + 1,
    activeIndex: Math.max(0, steps.findIndex((s) => s.route === route)),
  };
}

export function FlowSteps({ state, route, setRoute, done }) {
  const flow = useMemo(() => flowSummary(state, done, route), [state, done, route]);
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-0.5" role="navigation" aria-label="Workflow steps">
      {flow.steps.map((step, i) => {
        const active = step.route === route;
        return (
          <button
            key={step.key}
            type="button"
            disabled={step.locked}
            aria-current={active ? 'step' : undefined}
            title={step.hint}
            onClick={() => setRoute(step.route)}
            className={cls(
              'flex shrink-0 items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition',
              active ? 'border-brand-400 bg-brand-50/80 shadow-sm' : 'border-transparent hover:bg-ink-50',
              step.locked && 'cursor-not-allowed opacity-45 hover:bg-transparent',
            )}
          >
            <span className={cls(
              'grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-extrabold',
              step.done ? 'bg-mint-500 text-white' : active ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-500',
            )}>
              {step.done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className={cls('block text-[11.5px] font-bold leading-tight', active ? 'text-brand-800' : 'text-ink-700')}>
                {step.label}
              </span>
              <span className="block max-w-[130px] truncate text-[10px] leading-tight text-ink-400">{step.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function NextStepCard({ state, done, setRoute, openSettings }) {
  const flow = useMemo(() => flowSummary(state, done), [state, done]);

  const action = useMemo(() => {
    if (!flow.imported) return {
      step: 1, icon: UploadCloud, title: 'Start with your GST workbook',
      body: 'Import both tabs — the purchase register and the GSTR-2B export. Header rows and vendor-name columns are detected for you.',
      cta: 'Import workbook', onClick: () => setRoute('upload'),
    };
    if (flow.reviewCount > 0 && !flow.done.has('matching')) return {
      step: 2, icon: GitMerge, title: `Review ${fmtInt(flow.reviewCount)} close name match${flow.reviewCount === 1 ? '' : 'es'}`,
      body: 'Suggested merges and fuzzy pairs are waiting. Approve the ones that belong together, or just continue if the current grouping is right.',
      cta: 'Review names', onClick: () => setRoute('matching'),
    };
    if (flow.blocked > 0) return {
      step: 3, icon: AtSign, title: `${fmtInt(flow.blocked)} vendor${flow.blocked === 1 ? '' : 's'} still need a Mail ID`,
      body: 'Only vendors with a valid Mail ID can receive statements. Upload a mapping file or paste a list to finish this step quickly.',
      cta: 'Map Mail IDs', onClick: () => setRoute('mapping'),
    };
    if (!flow.transportReady) return {
      step: 4, icon: Server, title: 'Set up how emails are delivered',
      body: 'Add an SMTP app password, or connect Gmail through OAuth. You can still run a dry run without it.',
      cta: 'Open settings', onClick: openSettings,
    };
    if (!flow.hasHistory) return {
      step: 4, icon: PlayCircle, title: 'Run a dry run before you send',
      body: 'A dry run builds every attachment and shows exactly what would be delivered — without sending a single email.',
      cta: 'Preview & send', onClick: () => setRoute('campaign'),
    };
    return {
      step: 4, icon: Send, title: 'Everything is ready to send',
      body: `${fmtInt(flow.mapped)} vendors have valid Mail IDs and delivery is configured. Open Preview & send to start another campaign.`,
      cta: 'Open sending', onClick: () => setRoute('campaign'),
    };
  }, [flow, setRoute, openSettings]);

  const Icon = action.icon;
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-brand-sheen p-5 text-white shadow-lift sm:p-6">
      <div className="absolute inset-0 bg-grid-fade opacity-60" />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <span className="pill bg-white/10 text-brand-100 ring-1 ring-white/15">
            <span className="grid h-4 w-4 place-items-center rounded-full bg-white/20 text-[9px] font-extrabold">{action.step}</span>
            Step {action.step} of 4
          </span>
          <h2 className="mt-3 font-display text-[21px] font-extrabold leading-tight tracking-tight sm:text-[26px]">{action.title}</h2>
          <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-brand-100/85">{action.body}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button onClick={action.onClick} className="btn btn-lg border-0 bg-white text-brand-800 hover:bg-brand-50">
            <Icon className="h-4 w-4" /> {action.cta} <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

const CTA_TONES = {
  brand: 'border-brand-500/20 bg-brand-50/70 text-brand-900',
  amber: 'border-amberish-500/25 bg-amberish-100/70 text-amber-900',
  green: 'border-emerald-500/25 bg-mint-100/60 text-emerald-800',
};
const ICON_TONES = {
  brand: 'bg-brand-100 text-brand-700',
  amber: 'bg-amberish-100 text-amber-700',
  green: 'bg-mint-100 text-emerald-700',
};

export function StepCta({ icon: Icon = Sparkles, title, body, cta, onClick, tone = 'brand' }) {
  return (
    <div className={cls('flex flex-wrap items-center gap-3 rounded-2xl border p-3.5', CTA_TONES[tone] || CTA_TONES.brand)}>
      <span className={cls('grid h-9 w-9 shrink-0 place-items-center rounded-xl', ICON_TONES[tone] || ICON_TONES.brand)}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-bold">{title}</p>
        {body && <p className="mt-0.5 text-[11.5px] leading-relaxed opacity-80">{body}</p>}
      </div>
      <button type="button" onClick={onClick} className="btn btn-primary btn-sm">
        {cta} <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
