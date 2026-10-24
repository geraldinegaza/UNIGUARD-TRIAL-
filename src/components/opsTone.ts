// Class strings for the Phase 3 operations screens, copied from the existing
// console screens so new panels match them: navy for a barangay official,
// charcoal for the LDRRMO (gold for the Super Admin via the ug-admin-ops layer).
export function opsTone(isBarangay: boolean) {
  return isBarangay
    ? {
        card: 'bg-white rounded-[24px] border border-[#7EA0C5]/30 shadow-[0_2px_12px_rgba(1,16,37,0.03)] overflow-hidden',
        head: 'px-5 sm:px-6 py-4 bg-[#C2E8FF]/10 border-b border-[#7EA0C5]/20',
        h1: 'text-xl sm:text-2xl font-semibold tracking-tight text-[#011025]',
        h2: 'text-sm font-semibold uppercase tracking-wide text-[#011025]',
        sub: 'text-xs sm:text-sm text-[#5482B4]',
        ink: 'text-[#011025]',
        muted: 'text-[#5482B4]',
        faint: 'text-[#7EA0C5]',
        divide: 'divide-[#7EA0C5]/20',
        border: 'border-[#7EA0C5]/20',
        label: 'block text-[10px] font-semibold uppercase tracking-wider mb-1.5 text-[#5482B4]',
        input:
          'w-full text-xs font-medium p-3 rounded-xl focus:outline-hidden transition-all shadow-2xs border border-[#7EA0C5]/30 bg-[#C2E8FF]/10 hover:bg-[#C2E8FF]/20 focus:bg-white text-[#011025] placeholder-[#5482B4]/60 focus:border-[#052659] focus:ring-2 focus:ring-[#C2E8FF]',
        primary:
          'inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[36px] text-xs font-medium rounded-full shadow-xs transition-colors cursor-pointer bg-[#052659] hover:bg-[#031c42] text-white border border-[#011025]/20 disabled:opacity-60',
        ghost:
          'inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[36px] text-xs font-medium rounded-full transition-colors cursor-pointer bg-white hover:bg-[#C2E8FF]/30 text-[#052659] border border-[#7EA0C5]/40 disabled:opacity-60',
        pill: 'px-3 py-1 rounded-full text-xs font-mono font-medium bg-[#C2E8FF]/60 text-[#052659] border border-[#7EA0C5]/40',
        tabs: 'bg-[#C2E8FF]/20 border-[#7EA0C5]/30',
        tabOn: 'bg-[#052659] text-white shadow-2xs',
        tabOff: 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/40',
        stat: 'bg-[#052659] border-[#011025]/30',
        statSub: 'text-[#C2E8FF]',
        bar: 'bg-[#052659]',
        track: 'bg-[#C2E8FF]/20 border-[#7EA0C5]/30',
        modalBack: 'bg-[#011025]/40',
        modal: 'border-[#7EA0C5]/40',
      }
    : {
        card: 'bg-white rounded-[24px] border border-neutral-200/70 shadow-xs overflow-hidden',
        head: 'px-5 sm:px-6 py-4 bg-neutral-50/50 border-b border-neutral-100',
        h1: 'text-xl sm:text-2xl font-semibold tracking-tight text-neutral-900',
        h2: 'text-sm font-semibold uppercase tracking-wide text-neutral-900',
        sub: 'text-xs sm:text-sm text-neutral-500',
        ink: 'text-neutral-900',
        muted: 'text-neutral-500',
        faint: 'text-neutral-400',
        divide: 'divide-neutral-100',
        border: 'border-neutral-100',
        label: 'block text-[10px] font-semibold uppercase tracking-wider mb-1.5 text-neutral-500',
        input:
          'w-full text-xs font-medium p-3 rounded-xl focus:outline-hidden transition-all shadow-2xs border border-neutral-200 bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white text-neutral-800 placeholder-neutral-400 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50',
        primary:
          'inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[36px] text-xs font-medium rounded-full shadow-xs transition-colors cursor-pointer bg-[#18181b] hover:bg-neutral-800 text-white disabled:opacity-60',
        ghost:
          'inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[36px] text-xs font-medium rounded-full transition-colors cursor-pointer bg-white hover:bg-neutral-50 text-neutral-700 border border-neutral-200 disabled:opacity-60',
        pill: 'px-3 py-1 rounded-full text-xs font-mono font-medium bg-neutral-100 text-neutral-800 border border-neutral-200/80',
        tabs: 'bg-neutral-100/60 border-neutral-200/60',
        tabOn: 'bg-[#2A2A2A] text-white shadow-2xs',
        tabOff: 'text-neutral-600 hover:text-neutral-900 hover:bg-white/60',
        stat: 'bg-[#18181b] border-neutral-800',
        statSub: 'text-neutral-400',
        bar: 'bg-[#18181b]',
        track: 'bg-neutral-100 border-neutral-200/60',
        modalBack: 'bg-black/40',
        modal: 'border-neutral-200/80',
      };
}

export type OpsTone = ReturnType<typeof opsTone>;

export const phpText = (v: number) =>
  'PHP ' + (Number(v) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const shortWhen = (iso: string | null | undefined) => {
  if (!iso) return '';
  const t = Date.parse(iso);
  return isNaN(t) ? '' : new Date(t).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
