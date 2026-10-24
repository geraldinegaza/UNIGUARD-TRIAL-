import React, { useEffect, useState } from 'react';
import { AlarmClock, ChevronDown, ChevronUp, MapPin, ShieldCheck } from 'lucide-react';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import { hazardDisplayLabel } from '../lib/hazards';

// Reports a barangay has not verified within an hour of submission
// (migrations 147 and 151). The LDRRMO can verify them here; the barangay
// official can still verify later. The Super Admin sees the list without the
// Verify button, and the server refuses it as well.
const waited = (minutes: number) => {
  if (minutes < 120) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return h < 48 ? `${h} h ${minutes % 60} min` : `${Math.floor(h / 24)} days`;
};

export const OverdueQueuePanel: React.FC<{ canVerify: boolean; onVerified?: () => void }> = ({ canVerify, onVerified }) => {
  const { overdue } = useRepo();
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const load = () => repo.loadOverdue().catch(() => {});
    load();
    // the hour passes without any write, so the list refreshes on its own
    const t = window.setInterval(load, 60000);
    return () => window.clearInterval(t);
  }, []);

  if (!overdue.length) return null;

  const verify = async (id: string, code: string) => {
    setBusy(id);
    try {
      await repo.verifyOverdue(id);
      setNotice(`${code || 'Report'} verified by the LDRRMO`);
      onVerified?.();
    } catch (e: any) {
      setNotice(e.message || 'Could not verify the report');
    } finally {
      setBusy(null);
      setTimeout(() => setNotice(null), 4000);
    }
  };

  return (
    <section className="rounded-[22px] border border-amber-200 bg-amber-50/70 overflow-hidden" aria-label="Overdue verification">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 text-left cursor-pointer"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 shrink-0 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center">
            <AlarmClock className="w-4 h-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-neutral-900">
              {overdue.length} {overdue.length === 1 ? 'report' : 'reports'} unverified for over an hour
            </span>
            <span className="block text-[11px] text-amber-900/80 truncate">
              {canVerify
                ? 'The barangay has not verified these. You can verify them now.'
                : 'Monitoring only: the Super Admin does not verify reports.'}
            </span>
          </span>
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-amber-800 shrink-0" /> : <ChevronDown className="w-4 h-4 text-amber-800 shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-amber-200/80 divide-y divide-amber-200/60 bg-white/60">
          {notice && <div className="px-4 sm:px-5 py-2 text-xs font-medium text-neutral-800 bg-white">{notice}</div>}
          {overdue.map((r) => (
            <div key={r.id} className="px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <span className="font-mono font-semibold text-neutral-900">{r.code || r.id.slice(0, 8)}</span>
                  <span className="font-medium text-neutral-800">{hazardDisplayLabel(r.hazard_type)}</span>
                  <span className="inline-flex items-center gap-1 text-neutral-500">
                    <MapPin className="w-3 h-3" />
                    {r.barangay || 'No barangay'}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-200">
                    waiting {waited(r.minutes)}
                  </span>
                </div>
                {r.description && <p className="mt-1 text-[11px] text-neutral-600 line-clamp-2 break-words">{r.description}</p>}
              </div>
              {canVerify && (
                <button
                  onClick={() => verify(r.id, r.code)}
                  disabled={busy === r.id}
                  className="self-start sm:self-auto inline-flex items-center gap-1.5 px-4 py-2 min-h-[36px] rounded-full bg-[#18181b] hover:bg-black text-white text-xs font-medium cursor-pointer disabled:opacity-60 shrink-0"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {busy === r.id ? 'Verifying…' : 'Verify'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
