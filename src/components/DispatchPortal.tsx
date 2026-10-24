import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  ListChecks,
  Siren,
  Users,
  Building2,
  LogOut,
  MoreVertical,
  ArrowUp,
  ArrowDown,
  X,
  MapPin,
  Phone,
  Truck,
  ChevronRight,
} from 'lucide-react';
import { User, IncidentReport, SosEntry, Responder, EvacuationCenter } from '../types';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import { relTime } from '../lib/util';
import { TriadEmblem, BrandLoader } from '../brand';

// Dispatch Team console. Initial draft of the layout: an icon rail on the left,
// the queue in the middle (each row its own card, the selected row lifted out in
// the accent colour), and the selected call's details on the right with the
// units that can take it. On tablets and phones the details open as a sheet.

type View = 'queue' | 'sos' | 'units' | 'shelters';
type QueueItem =
  | { kind: 'report'; id: string; report: IncidentReport }
  | { kind: 'sos'; id: string; sos: SosEntry };

const NAV: { id: View; label: string; icon: typeof ListChecks }[] = [
  { id: 'queue', label: 'Queue', icon: ListChecks },
  { id: 'sos', label: 'SOS Calls', icon: Siren },
  { id: 'units', label: 'Units', icon: Users },
  { id: 'shelters', label: 'Shelters', icon: Building2 },
];

const PRIORITY: Record<string, { label: string; rank: number }> = {
  emergency: { label: 'Critical', rank: 0 },
  warning: { label: 'High', rank: 1 },
  advisory: { label: 'Normal', rank: 2 },
};

const REPORT_STATUS: Record<string, { label: string; cls: string }> = {
  unverified: { label: 'Pending', cls: 'bg-[#E9B872]/90 text-white' },
  verified: { label: 'Verified', cls: 'bg-[#6BAED6] text-white' },
  dispatched: { label: 'En route', cls: 'bg-[#7C83C9] text-white' },
  resolved: { label: 'Resolved', cls: 'bg-[#73B386] text-white' },
  rejected: { label: 'Rejected', cls: 'bg-[#D9534F] text-white' },
};

const SOS_STATUS: Record<string, { label: string; cls: string }> = {
  sent: { label: 'New', cls: 'bg-[#D9534F] text-white' },
  acknowledged: { label: 'Acknowledged', cls: 'bg-[#6BAED6] text-white' },
  resolved: { label: 'Handled', cls: 'bg-[#73B386] text-white' },
};

const isOpen = (s: string) => s !== 'resolved' && s !== 'rejected';
const sameDay = (iso: string | undefined, day: Date) => {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate();
};

/** Small trend under a figure: up or down against yesterday. */
const Trend: React.FC<{ today: number; yesterday: number; goodWhenUp?: boolean }> = ({ today, yesterday, goodWhenUp = true }) => {
  const diff = today - yesterday;
  const up = diff >= 0;
  const good = up === goodWhenUp;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-neutral-400">
      <span className={`w-4 h-4 rounded-full flex items-center justify-center text-white ${good ? 'bg-[#73B386]' : 'bg-[#E57373]'}`}>
        {up ? <ArrowUp className="w-2.5 h-2.5" strokeWidth={3} /> : <ArrowDown className="w-2.5 h-2.5" strokeWidth={3} />}
      </span>
      {diff === 0 ? 'same as yesterday' : `${up ? '+' : ''}${diff} vs yesterday`}
    </span>
  );
};

interface DispatchPortalProps {
  currentUser: User;
  onSignOut: () => void;
}

export const DispatchPortal: React.FC<DispatchPortalProps> = ({ currentUser, onSignOut }) => {
  const data = useRepo();
  const [view, setView] = useState<View>('queue');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    repo.loadSos();
    repo.loadResponders();
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const q = query.trim().toLowerCase();
  const matches = (...fields: (string | undefined)[]) => !q || fields.some((f) => (f || '').toLowerCase().includes(q));

  const reportItems: QueueItem[] = useMemo(
    () =>
      data.reports
        .filter((r) => matches(r.code, r.hazard_type, r.barangay_name, r.description))
        .sort(
          (a, b) =>
            Number(isOpen(b.status)) - Number(isOpen(a.status)) ||
            (PRIORITY[a.severity]?.rank ?? 3) - (PRIORITY[b.severity]?.rank ?? 3) ||
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
        .map((r) => ({ kind: 'report' as const, id: 'r:' + r.id, report: r })),
    [data.reports, q]
  );
  const sosItems: QueueItem[] = useMemo(
    () =>
      data.sosLog
        .filter((s) => matches(s.profile_name, s.barangay, s.note, s.profile_phone))
        .sort((a, b) => Number(b.status !== 'resolved') - Number(a.status !== 'resolved'))
        .map((s) => ({ kind: 'sos' as const, id: 's:' + s.id, sos: s })),
    [data.sosLog, q]
  );
  const items = view === 'sos' ? sosItems : reportItems;
  const selected = items.find((i) => i.id === selectedId) || items[0] || null;

  // figures for the summary strip
  const today = now;
  const yesterday = new Date(now.getTime() - 86400000);
  const openCalls = data.reports.filter((r) => isOpen(r.status)).length + data.sosLog.filter((s) => s.status !== 'resolved').length;
  const unitsOut = data.reports.reduce((n, r) => n + (isOpen(r.status) ? r.assigned_units : 0), 0);
  const resolvedOn = (d: Date) => data.reports.filter((r) => r.status === 'resolved' && sameDay(r.resolved_at, d)).length;
  const callsOn = (d: Date) =>
    data.reports.filter((r) => sameDay(r.created_at, d)).length + data.sosLog.filter((s) => sameDay(s.created_at, d)).length;
  const latestSos = data.sosLog.find((s) => s.status !== 'resolved');

  const select = (item: QueueItem) => {
    setSelectedId(item.id);
    setUnitId(null);
    setNotice(null);
    setSheetOpen(true);
  };

  const assign = async () => {
    if (!selected || selected.kind !== 'report' || !unitId || assigning) return;
    setAssigning(true);
    setNotice(null);
    try {
      await repo.assignResponder(selected.report.id, unitId);
      setNotice('Unit assigned.');
    } catch (err: any) {
      setNotice(err.message || 'Could not assign the unit.');
    } finally {
      setAssigning(false);
    }
  };

  const initial = (currentUser.full_name || 'D').trim().charAt(0).toUpperCase();
  const clock = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });

  /* ------------------------------------------------------------ pieces */

  const statusPill = (item: QueueItem) => {
    const s = item.kind === 'report' ? REPORT_STATUS[item.report.status] : SOS_STATUS[item.sos.status];
    return (
      <span className={`inline-flex items-center justify-center min-w-[78px] h-6 px-2.5 rounded-md text-[11px] font-semibold ${s?.cls || 'bg-neutral-300 text-white'}`}>
        {s?.label || '—'}
      </span>
    );
  };

  const row = (item: QueueItem) => {
    const active = selected?.id === item.id;
    const code = item.kind === 'report' ? item.report.code : 'SOS';
    const what = item.kind === 'report' ? item.report.hazard_type : item.sos.profile_name || 'Resident';
    const priority = item.kind === 'report' ? PRIORITY[item.report.severity]?.label || 'Normal' : 'Critical';
    const units = item.kind === 'report' ? item.report.assigned_units : 0;
    const place = item.kind === 'report' ? item.report.barangay_name : item.sos.barangay;
    const when = item.kind === 'report' ? item.report.created_at : item.sos.created_at;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => select(item)}
        aria-current={active ? 'true' : undefined}
        className={`w-full text-left grid grid-cols-[1fr_auto] md:grid-cols-[1.3fr_1.1fr_0.5fr_1.2fr_auto_24px] items-center gap-x-4 gap-y-1 rounded-xl px-4 md:px-5 py-3.5 transition-all duration-200 cursor-pointer ${
          active
            ? 'bg-gradient-to-r from-[#F07A4A] to-[#E2552B] text-white shadow-[0_14px_30px_-12px_rgba(226,85,43,0.7)] md:-mx-3 md:px-8 relative z-10'
            : 'bg-white text-neutral-700 shadow-[0_2px_10px_-6px_rgba(120,60,30,0.25)] hover:shadow-[0_6px_18px_-10px_rgba(120,60,30,0.35)]'
        }`}
      >
        <span className="min-w-0">
          <span className={`block text-[13px] font-semibold truncate ${active ? 'text-white' : 'text-neutral-800'}`}>{code}</span>
          <span className={`block text-[11px] truncate md:hidden ${active ? 'text-white/80' : 'text-neutral-400'}`}>
            {what} · {place || 'No barangay'} · {relTime(when)}
          </span>
          <span className={`hidden md:block text-[11px] truncate ${active ? 'text-white/80' : 'text-neutral-400'}`}>{relTime(when)}</span>
        </span>
        <span className={`hidden md:block text-[13px] truncate ${active ? 'text-white' : ''}`}>
          {what}
          <span className={`block text-[11px] ${active ? 'text-white/80' : 'text-neutral-400'}`}>{priority}</span>
        </span>
        <span className="hidden md:block text-[13px] text-center">{units}</span>
        <span className="hidden md:block text-[13px] truncate">{place || '—'}</span>
        <span className="justify-self-end">
          {active ? (
            <span className="inline-flex items-center justify-center min-w-[78px] h-6 px-2.5 rounded-md text-[11px] font-semibold bg-white text-[#E2552B]">
              {(item.kind === 'report' ? REPORT_STATUS[item.report.status] : SOS_STATUS[item.sos.status])?.label}
            </span>
          ) : (
            statusPill(item)
          )}
        </span>
        <MoreVertical className={`hidden md:block w-4 h-4 justify-self-end ${active ? 'text-white' : 'text-neutral-300'}`} />
      </button>
    );
  };

  const unitCard = (r: Responder) => {
    const picked = unitId === r.id;
    return (
      <button
        key={r.id}
        type="button"
        onClick={() => setUnitId(picked ? null : r.id)}
        aria-pressed={picked}
        className={`snap-start shrink-0 w-[132px] rounded-2xl p-3.5 text-left cursor-pointer transition-all border ${
          picked ? 'bg-[#FFF1EA] border-[#F07A4A] shadow-[0_8px_20px_-12px_rgba(226,85,43,0.6)]' : 'bg-[#F7F4F2] border-transparent'
        }`}
      >
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${picked ? 'bg-[#E2552B] text-white' : 'bg-white text-[#E2552B]'}`}>
          <Truck className="w-5 h-5" />
        </span>
        <span className="block text-[13px] font-bold text-neutral-800 truncate">{r.name}</span>
        <span className="block text-[11px] text-neutral-400 truncate mt-0.5">{r.unit || 'Responder'}</span>
      </button>
    );
  };

  const detailRow = (label: string, value: React.ReactNode) => (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="text-[13px] font-medium text-neutral-700 shrink-0">{label}</span>
      <span className="text-[13px] text-neutral-400 text-right min-w-0 break-words">{value}</span>
    </div>
  );

  const shelterFor = (barangay: string | undefined): EvacuationCenter | undefined =>
    data.centers.find((c) => c.status === 'open' && c.barangay_name === barangay) || data.centers.find((c) => c.status === 'open');

  const details = selected ? (
    <>
      <section className="bg-white rounded-[22px] p-5">
        <h3 className="text-[15px] font-semibold text-neutral-800 mb-4">Available Units</h3>
        {data.responders.length ? (
          <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x -mx-1 px-1 pb-1">{data.responders.map(unitCard)}</div>
        ) : (
          <p className="text-[12px] text-neutral-400">No responder units are listed yet.</p>
        )}
        <div className="flex gap-1 mt-4" aria-hidden="true">
          <span className="w-4 h-1 rounded-full bg-neutral-300" />
          <span className="w-1 h-1 rounded-full bg-neutral-200" />
          <span className="w-1 h-1 rounded-full bg-neutral-200" />
        </div>
      </section>

      <section className="bg-white rounded-[22px] px-5 py-3">
        {selected.kind === 'report' ? (
          <>
            {detailRow('Report Code', selected.report.code)}
            {detailRow('Hazard', selected.report.hazard_type)}
            {detailRow('Priority', PRIORITY[selected.report.severity]?.label || 'Normal')}
            {detailRow('Barangay', selected.report.barangay_name || '—')}
            {detailRow('Confirmations', `${selected.report.corroboration_count}`)}
            {detailRow('Units Assigned', `${selected.report.assigned_units}`)}
          </>
        ) : (
          <>
            {detailRow('Caller', selected.sos.profile_name || 'Resident')}
            {detailRow('Contact', selected.sos.profile_phone || '—')}
            {detailRow('Barangay', selected.sos.barangay || '—')}
            {detailRow('Location', selected.sos.lat != null && selected.sos.lng != null ? `${selected.sos.lat.toFixed(4)}, ${selected.sos.lng.toFixed(4)}` : 'No GPS fix')}
            {detailRow('Received', relTime(selected.sos.created_at))}
          </>
        )}
      </section>

      <section className="bg-white rounded-[22px] p-5 flex-1 flex flex-col">
        <h3 className="text-[15px] font-semibold text-neutral-800 mb-4">Nearest Open Shelter</h3>
        {(() => {
          const c = shelterFor(selected.kind === 'report' ? selected.report.barangay_name : selected.sos.barangay);
          return c ? (
            <div className="rounded-2xl bg-[#F6EDE6] p-5 text-center">
              <span className="mx-auto w-14 h-14 rounded-2xl bg-white text-[#E2552B] flex items-center justify-center shadow-sm mb-3">
                <Building2 className="w-7 h-7" />
              </span>
              <p className="text-[14px] font-bold text-[#8A5A3C]">{c.name}</p>
              <p className="text-[11px] text-neutral-500 mt-1">
                <span className="font-semibold text-neutral-700">Capacity</span> {c.current_occupancy} / {c.capacity}
              </p>
            </div>
          ) : (
            <p className="text-[12px] text-neutral-400">No open shelter on record.</p>
          );
        })()}

        <div className="mt-auto pt-5">
          {notice && <p className="text-[12px] text-center text-neutral-500 mb-2">{notice}</p>}
          <button
            type="button"
            onClick={assign}
            disabled={selected.kind !== 'report' || !unitId || assigning}
            className="w-full h-12 rounded-xl text-white text-sm font-bold bg-gradient-to-r from-[#F07A4A] to-[#E2552B] shadow-[0_12px_24px_-12px_rgba(226,85,43,0.8)] disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {assigning ? (
              <BrandLoader mode="inline" portal="dispatch" process="submit" variant="reverse" />
            ) : selected.kind !== 'report' ? (
              'Units are assigned to reports'
            ) : unitId ? (
              'Assign This Unit'
            ) : (
              'Pick a unit to assign'
            )}
          </button>
        </div>
      </section>
    </>
  ) : (
    <section className="bg-white rounded-[22px] p-6 text-center text-[13px] text-neutral-400">Nothing in the queue.</section>
  );

  /* ------------------------------------------------------------ views */

  const listView = (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mt-7 mb-3">
        <h2 className="text-[22px] font-semibold text-neutral-700">{view === 'sos' ? 'SOS Calls' : 'Dispatch Queue'}</h2>
        <span className="text-[12px] text-neutral-400">{items.length} {items.length === 1 ? 'call' : 'calls'}</span>
      </div>
      <div className="hidden md:grid grid-cols-[1.3fr_1.1fr_0.5fr_1.2fr_auto_24px] gap-x-4 px-5 pb-2 text-[12px] font-medium text-neutral-500">
        <span>Code</span>
        <span>{view === 'sos' ? 'Caller' : 'Hazard / Priority'}</span>
        <span className="text-center">Units</span>
        <span>Barangay</span>
        <span className="min-w-[78px] text-center">Status</span>
        <span />
      </div>
      <div className="space-y-3 pb-6">
        {items.length ? items.map(row) : <p className="text-center text-[13px] text-neutral-400 py-10">No calls match.</p>}
      </div>
    </>
  );

  const unitsView = (
    <div className="mt-7">
      <h2 className="text-[22px] font-semibold text-neutral-700 mb-4">Responder Units</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {data.responders.map((r) => (
          <div key={r.id} className="bg-white rounded-2xl p-4 flex items-center gap-3 shadow-[0_2px_10px_-6px_rgba(120,60,30,0.25)]">
            <span className="w-11 h-11 rounded-xl bg-[#FFF1EA] text-[#E2552B] flex items-center justify-center shrink-0">
              <Truck className="w-5 h-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-bold text-neutral-800 truncate">{r.name}</span>
              <span className="block text-[12px] text-neutral-400 truncate">{r.unit || 'Responder'}</span>
            </span>
            {r.contact && (
              <a href={`tel:${r.contact}`} className="ml-auto w-9 h-9 rounded-full bg-[#F7F4F2] text-neutral-600 flex items-center justify-center shrink-0" aria-label={`Call ${r.name}`}>
                <Phone className="w-4 h-4" />
              </a>
            )}
          </div>
        ))}
        {!data.responders.length && <p className="text-[13px] text-neutral-400">No responder units are listed yet.</p>}
      </div>
    </div>
  );

  const sheltersView = (
    <div className="mt-7">
      <h2 className="text-[22px] font-semibold text-neutral-700 mb-4">Evacuation Shelters</h2>
      <div className="space-y-3">
        {data.centers.map((c) => {
          const pct = c.capacity ? Math.min(100, Math.round((c.current_occupancy / c.capacity) * 100)) : 0;
          return (
            <div key={c.id} className="bg-white rounded-xl px-5 py-4 shadow-[0_2px_10px_-6px_rgba(120,60,30,0.25)]">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-neutral-800 truncate">{c.name}</span>
                  <span className="flex items-center gap-1 text-[12px] text-neutral-400 truncate">
                    <MapPin className="w-3 h-3 shrink-0" /> {c.barangay_name}
                  </span>
                </span>
                <span className="text-[12px] font-semibold text-neutral-600 shrink-0">
                  {c.current_occupancy} / {c.capacity}
                </span>
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-[#F3ECE7] overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-[#F07A4A] to-[#E2552B]" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const hasDetails = view === 'queue' || view === 'sos';

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#FBEFEA] font-sans antialiased text-neutral-800">
      {/* soft colour shapes behind the frame */}
      <div aria-hidden="true" className="pointer-events-none absolute -top-40 -left-40 w-[520px] h-[520px] rounded-full bg-[#F9C9B6]/60 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-48 right-[-120px] w-[620px] h-[620px] rounded-full bg-[#F6B9A2]/50 blur-3xl" />

      <div className="relative h-full w-full p-0 sm:p-3 lg:p-6 flex items-center justify-center">
        <div className="h-full w-full max-w-[1500px] flex overflow-hidden sm:rounded-[28px] bg-[#FDF6F3]/80 backdrop-blur-xl sm:border border-white shadow-[0_30px_80px_-30px_rgba(160,70,40,0.35)]">
          {/* ---------------- left rail (tablet and desktop) */}
          <aside className="hidden md:flex w-[96px] shrink-0 flex-col">
            <div className="h-[84px] flex items-center justify-center">
              <TriadEmblem portal="dispatch" size={34} />
            </div>
            <nav
              aria-label="Dispatch sections"
              className="flex-1 flex flex-col items-center gap-3 pt-8 pb-6 rounded-tr-[56px] bg-gradient-to-b from-[#F07A4A] via-[#E2552B] to-[#C2410C]"
            >
              <span className="w-12 h-12 rounded-full bg-white/20 ring-2 ring-white/70 flex items-center justify-center text-white font-black text-lg mb-6">
                {initial}
              </span>
              {NAV.map((item) => {
                const Icon = item.icon;
                const active = view === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setView(item.id)}
                    aria-label={item.label}
                    aria-current={active ? 'page' : undefined}
                    title={item.label}
                    className={`relative w-12 h-12 rounded-xl flex items-center justify-center cursor-pointer transition-colors ${
                      active ? 'bg-white/20 text-white' : 'text-white/75 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <Icon className="w-[22px] h-[22px]" strokeWidth={1.8} />
                    {active && <span className="absolute -right-[22px] top-2.5 bottom-2.5 w-[3px] rounded-full bg-white" />}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={onSignOut}
                aria-label="Sign out"
                title="Sign out"
                className="mt-auto w-11 h-11 rounded-xl bg-white/20 text-white flex items-center justify-center cursor-pointer hover:bg-white/30"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </nav>
          </aside>

          {/* ---------------- middle column */}
          <main className="flex-1 min-w-0 flex flex-col">
            {/* phone header */}
            <div className="md:hidden flex items-center gap-3 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-2">
              <TriadEmblem portal="dispatch" size={28} />
              <span className="text-[15px] font-extrabold text-neutral-800">Dispatch</span>
              <span className="ml-auto text-[12px] font-semibold text-neutral-500">{clock}</span>
              <span className="w-9 h-9 rounded-full bg-gradient-to-br from-[#F07A4A] to-[#C2410C] text-white font-black flex items-center justify-center">
                {initial}
              </span>
              <button
                type="button"
                onClick={onSignOut}
                aria-label="Sign out"
                className="w-9 h-9 rounded-full bg-white text-[#C2410C] flex items-center justify-center shadow-sm cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 pt-2 md:pt-7">
              {/* search + clock */}
              <div className="flex gap-3">
                <label className="flex-1 min-w-0 h-12 flex items-center gap-2 pl-5 pr-1.5 rounded-xl bg-white/80 shadow-[0_2px_10px_-6px_rgba(120,60,30,0.25)]">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search calls, hazards or barangays"
                    className="flex-1 min-w-0 bg-transparent text-[13px] placeholder:text-neutral-400 focus:outline-none"
                  />
                  <span className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#F07A4A] to-[#E2552B] text-white flex items-center justify-center shrink-0">
                    <Search className="w-4 h-4" />
                  </span>
                </label>
                <div className="hidden sm:flex h-12 items-center gap-4 px-5 rounded-xl bg-white/80 shadow-[0_2px_10px_-6px_rgba(120,60,30,0.25)] text-[13px] whitespace-nowrap">
                  <span className="text-neutral-500">{clock}</span>
                  <span className="font-semibold text-neutral-700">{date}</span>
                </div>
              </div>

              {/* summary strip + latest SOS */}
              <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_minmax(0,240px)] gap-4">
                <div className="bg-white rounded-2xl px-5 py-5 grid grid-cols-3 divide-x divide-neutral-100 shadow-[0_6px_24px_-14px_rgba(120,60,30,0.35)]">
                  {[
                    { label: 'Calls today', value: callsOn(today), trend: <Trend today={callsOn(today)} yesterday={callsOn(yesterday)} goodWhenUp={false} /> },
                    { label: 'Open calls', value: openCalls, trend: <span className="text-[11px] font-semibold text-neutral-400">{unitsOut} units out</span> },
                    { label: 'Resolved today', value: resolvedOn(today), trend: <Trend today={resolvedOn(today)} yesterday={resolvedOn(yesterday)} /> },
                  ].map((s, i) => (
                    <div key={s.label} className={`min-w-0 ${i ? 'pl-4 sm:pl-6' : ''}`}>
                      <p className="text-[11px] sm:text-[12px] text-neutral-400 truncate">{s.label}</p>
                      <p className="text-[22px] sm:text-[26px] font-semibold text-neutral-800 mt-1 tabular-nums">{s.value}</p>
                      <div className="mt-1 hidden sm:block">{s.trend}</div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setView('sos')}
                  className="text-left rounded-2xl p-5 bg-gradient-to-br from-[#F07A4A] to-[#D9481F] text-white shadow-[0_14px_30px_-14px_rgba(217,72,31,0.8)] cursor-pointer"
                >
                  <span className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider">Latest SOS</span>
                    <ChevronRight className="w-4 h-4 opacity-80" />
                  </span>
                  <span className="block mt-3 text-[13px] leading-snug text-white/90">
                    {latestSos
                      ? `${latestSos.profile_name || 'A resident'} in ${latestSos.barangay || 'an unknown barangay'}, ${relTime(latestSos.created_at)}.`
                      : 'No open SOS calls right now.'}
                  </span>
                </button>
              </div>

              {/* phone section switch */}
              <div className="md:hidden mt-5 flex gap-2 overflow-x-auto no-scrollbar">
                {NAV.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setView(item.id)}
                    className={`shrink-0 h-9 px-4 rounded-full text-[13px] font-semibold cursor-pointer ${
                      view === item.id ? 'bg-[#E2552B] text-white' : 'bg-white text-neutral-500'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {hasDetails ? listView : view === 'units' ? unitsView : sheltersView}
            </div>
          </main>

          {/* ---------------- right panel (desktop) */}
          {hasDetails && (
            <aside aria-label="Call details" className="hidden lg:flex w-[340px] shrink-0 flex-col gap-3 p-3 bg-[#F7F1EE] overflow-y-auto">
              {details}
            </aside>
          )}
        </div>
      </div>

      {/* ---------------- details as a sheet (tablet and phone) */}
      {hasDetails && selected && (
        <div className={`lg:hidden fixed inset-0 z-40 ${sheetOpen ? '' : 'pointer-events-none'}`}>
          <div
            className={`absolute inset-0 bg-[#3B1607]/40 transition-opacity duration-300 ${sheetOpen ? 'opacity-100' : 'opacity-0'}`}
            onClick={() => setSheetOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-label="Call details"
            inert={!sheetOpen}
            className={`absolute inset-x-0 bottom-0 max-h-[88vh] flex flex-col gap-3 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] rounded-t-[28px] bg-[#F7F1EE] overflow-y-auto transition-transform duration-300 ease-out ${
              sheetOpen ? 'translate-y-0' : 'translate-y-full'
            }`}
          >
            <div className="sticky -top-3 z-10 -mx-3 -mt-3 px-5 pt-3 pb-1 flex items-center justify-between bg-[#F7F1EE]">
              <span className="w-10 h-1 rounded-full bg-neutral-300 mx-auto absolute left-1/2 -translate-x-1/2 top-2" aria-hidden="true" />
              <h3 className="text-[15px] font-bold text-neutral-800 mt-2">
                {selected.kind === 'report' ? selected.report.code : 'SOS call'}
              </h3>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="Close details"
                className="mt-2 w-9 h-9 rounded-full bg-white text-neutral-600 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {details}
          </div>
        </div>
      )}

    </div>
  );
};
