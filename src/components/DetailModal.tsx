import React, { useEffect } from 'react';
import { X } from 'lucide-react';

// The detail pop-up behind every "Details" / "View" in the reference build: a
// title, a few badges, the record as label · value rows, anything else the
// record needs (a map, a list), and its actions. Escape, the × and a tap on
// the backdrop close it. On a phone it rises from the bottom edge.

export type DetailTone = 'resident' | 'barangay' | 'staff';

const TONES: Record<DetailTone, { panel: string; title: string; label: string; value: string; line: string; close: string }> = {
  resident: {
    panel: 'border-neutral-100',
    title: 'text-neutral-900',
    label: 'text-neutral-500',
    value: 'text-neutral-900',
    line: 'border-neutral-100',
    close: 'bg-neutral-100 hover:bg-neutral-200 text-neutral-600',
  },
  barangay: {
    panel: 'border-[#7EA0C5]/40',
    title: 'text-[#011025]',
    label: 'text-[#5482B4]',
    value: 'text-[#011025]',
    line: 'border-[#7EA0C5]/20',
    close: 'bg-[#C2E8FF]/30 hover:bg-[#C2E8FF]/60 text-[#052659]',
  },
  staff: {
    panel: 'border-neutral-200/80',
    title: 'text-neutral-900',
    label: 'text-neutral-500',
    value: 'text-neutral-900',
    line: 'border-neutral-100',
    close: 'bg-neutral-100 hover:bg-neutral-200 text-neutral-600',
  },
};

/** One label · value row; an empty value shows a dash. */
export const DetailRow: React.FC<{ label: string; value?: React.ReactNode; tone?: DetailTone }> = ({ label, value, tone = 'staff' }) => {
  const t = TONES[tone];
  const empty = value === undefined || value === null || value === '';
  return (
    <div className={`flex items-start justify-between gap-4 py-2 border-b last:border-b-0 text-xs ${t.line}`}>
      <span className={`shrink-0 ${t.label}`}>{label}</span>
      <span className={`text-right font-semibold break-words min-w-0 max-w-[65%] ${t.value}`}>{empty ? '—' : value}</span>
    </div>
  );
};

export const DetailModal: React.FC<{
  title: string;
  subtitle?: React.ReactNode;
  tone?: DetailTone;
  onClose: () => void;
  /** badges and other content above the rows */
  children: React.ReactNode;
  /** the action buttons; Close is always added */
  actions?: React.ReactNode;
}> = ({ title, subtitle, tone = 'staff', onClose, children, actions }) => {
  const t = TONES[tone];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-neutral-950/50 p-0 sm:p-6 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`w-full sm:max-w-lg max-h-[92dvh] flex flex-col bg-white rounded-t-[24px] sm:rounded-[24px] border shadow-2xl ${t.panel}`}
      >
        <div className={`flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-3 border-b ${t.line}`}>
          <div className="min-w-0">
            <h3 className={`font-bold text-base leading-snug break-words ${t.title}`}>{title}</h3>
            {subtitle && <div className={`text-[11px] mt-0.5 ${t.label}`}>{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center cursor-pointer ${t.close}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 sm:px-6 py-4 overflow-y-auto space-y-3">{children}</div>
        <div className={`flex flex-wrap items-center justify-end gap-2 px-5 sm:px-6 py-4 border-t pb-[calc(1rem+env(safe-area-inset-bottom))] ${t.line}`}>
          {actions}
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-full text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 text-neutral-700 cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

/** A filled bar, e.g. occupancy or stock against its reorder point. */
export const DetailBar: React.FC<{ pct: number; color: string }> = ({ pct, color }) => (
  <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
    <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
  </div>
);
