import React, { useState } from 'react';
import { AlertTriangle, AtSign, History, Settings2, Trash2, UploadCloud } from 'lucide-react';
import api from '../lib/api';
import { Modal, Spinner } from './ui';
import { cls, fmtInt } from '../lib/format';

/** Small button that opens the workbook-removal confirmation. */
export function RemoveWorkbookButton({ onOpen, className, label = 'Remove workbook', disabled = false }) {
  return (
    <button type="button" onClick={onOpen} disabled={disabled} className={cls('btn btn-danger btn-sm', className)}>
      <Trash2 className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

export function RemoveWorkbookDialog({ open, onClose, state, toast, onRemoved }) {
  const [busy, setBusy] = useState(false);
  const running = (state.jobs || []).filter((j) => j.status === 'running').length;
  const vendors = (state.vendors || []).length;

  async function remove() {
    setBusy(true);
    try {
      const res = await api.del('/api/workbook');
      onRemoved?.(res);
      toast({
        tone: 'ok',
        title: 'Workbook removed',
        body: 'The dataset and its saved copy were cleared. Mail IDs, settings and history were kept.',
      });
      onClose();
    } catch (e) {
      toast({ tone: 'err', title: 'Could not remove workbook', body: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Remove this workbook?"
      subtitle="Clear the active dataset and start fresh."
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-danger" onClick={remove} disabled={busy}>
          {busy ? <Spinner /> : <Trash2 className="h-4 w-4" />} Yes, remove workbook
        </button>
      </>}
    >
      <div className="space-y-3 text-[12.5px] text-ink-600">
        {state.loaded && (
          <p className="rounded-xl border border-ink-100 bg-ink-50/70 p-3">
            Current dataset: <b className="text-ink-900">{state.stats?.filename || 'Imported workbook'}</b>
            {vendors > 0 && <> · {fmtInt(vendors)} vendors</>}
          </p>
        )}

        {running > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-amberish-500/25 bg-amberish-100/70 p-3 text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span><b>{running} campaign{running === 1 ? '' : 's'} still running.</b> Removing the workbook will stop {running === 1 ? 'it' : 'them'} first.</span>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-rose-500/20 bg-rose-100/40 p-3">
            <p className="flex items-center gap-1.5 font-bold text-rose-700"><Trash2 className="h-3.5 w-3.5" /> Will be removed</p>
            <ul className="mt-2 space-y-1 text-[11.5px] text-rose-700/90">
              <li>Parsed vendor rows and name groups</li>
              <li>Saved copy that loads on restart</li>
              <li>Generated per-vendor attachments</li>
            </ul>
          </div>
          <div className="rounded-xl border border-mint-500/25 bg-mint-100/50 p-3">
            <p className="font-bold text-emerald-800">Will be kept</p>
            <ul className="mt-2 space-y-1 text-[11.5px] text-emerald-800/85">
              <li className="flex items-center gap-1.5"><AtSign className="h-3 w-3" /> Mail IDs and CCs</li>
              <li className="flex items-center gap-1.5"><Settings2 className="h-3 w-3" /> Settings and template</li>
              <li className="flex items-center gap-1.5"><History className="h-3 w-3" /> Campaign history</li>
            </ul>
          </div>
        </div>

        <p className="flex items-center gap-1.5 text-[11.5px] text-ink-400">
          <UploadCloud className="h-3.5 w-3.5" /> You can import the same file again — nothing on your computer is deleted.
        </p>
      </div>
    </Modal>
  );
}
