import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  ListChecks,
  Users,
  Wrench,
  Inbox,
  HeartPulse,
  LogOut,
  MoreVertical,
  X,
  Phone,
  Truck,
  ChevronRight,
  Plus,
  Check,
} from 'lucide-react';
import { User, Dispatch, DispatchStage, UnitEquipment, UnitPersonnel } from '../types';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import { relTime } from '../lib/util';
import { TriadEmblem, BrandLoader } from '../brand';

// Dispatch Team console. A dispatch account belongs to one unit (BFP, PNP,
// Rescue or Hospital) and sees only the dispatches addressed to that unit.
// Layout: an icon rail, the dispatch queue in the middle (each row its own
// card, the selected row lifted out in the accent colour), and the selected
// dispatch on the right with its stage, the next action and the crew on duty.
// On tablets and phones the details open as a sheet. Every write goes through
// the server's checked RPCs (migrations 139/140).

type View = 'queue' | 'roster' | 'equipment' | 'requests' | 'hospital';

const STAGES: { id: DispatchStage; label: string }[] = [
  { id: 'sent', label: 'Sent' },
  { id: 'acknowledged', label: 'Acknowledged' },
  { id: 'en_route', label: 'En route' },
  { id: 'on_scene', label: 'On scene' },
  { id: 'done', label: 'Done' },
];
const STAGE_PILL: Record<DispatchStage, string> = {
  sent: 'bg-[#D9534F] text-white',
  acknowledged: 'bg-[#E9B872] text-white',
  en_route: 'bg-[#7C83C9] text-white',
  on_scene: 'bg-[#6BAED6] text-white',
  done: 'bg-[#73B386] text-white',
};
// the action that moves a dispatch to its next stage
const NEXT_ACTION: Partial<Record<DispatchStage, { to: 'acknowledged' | 'en_route' | 'on_scene' | 'done'; label: string }>> = {
  sent: { to: 'acknowledged', label: 'Acknowledge' },
  acknowledged: { to: 'en_route', label: 'Mark en route' },
  en_route: { to: 'on_scene', label: 'Mark on scene' },
  on_scene: { to: 'done', label: 'Mark done' },
};
const PRIORITY: Record<string, { label: string; rank: number }> = {
  emergency: { label: 'Critical', rank: 0 },
  warning: { label: 'High', rank: 1 },
  advisory: { label: 'Normal', rank: 2 },
};
const EQUIP_PILL: Record<UnitEquipment['status'], string> = {
  available: 'bg-[#73B386] text-white',
  deployed: 'bg-[#7C83C9] text-white',
  maintenance: 'bg-[#E9B872] text-white',
  unavailable: 'bg-[#D9534F] text-white',
};
const KIND_LABEL: Record<string, string> = { fuel: 'Fuel', personnel: 'Personnel', equipment: 'Equipment', mutual_aid: 'Mutual aid', other: 'Other' };

const isOpenStage = (s: DispatchStage) => s !== 'done';
const sameDay = (iso: string | null | undefined, day: Date) => {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate();
};

const panel = 'bg-white rounded-[22px]';
const field =
  'w-full h-11 rounded-xl bg-[#F7F4F2] border border-transparent px-3.5 text-[13px] focus:outline-none focus:bg-white focus:border-[#F07A4A]';
const accentBtn =
  'h-11 px-5 rounded-xl text-white text-[13px] font-bold bg-gradient-to-r from-[#F07A4A] to-[#E2552B] shadow-[0_12px_24px_-12px_rgba(226,85,43,0.8)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2';

interface DispatchPortalProps {
  currentUser: User;
  onSignOut: () => void;
}

export const DispatchPortal: React.FC<DispatchPortalProps> = ({ currentUser, onSignOut }) => {
  const data = useRepo();
  const unit = data.myUnit;
  const isUnitAdmin = currentUser.unit_role === 'unit_admin';
  const isHospital = unit?.unit_type === 'Hospital';
  const [view, setView] = useState<View>('queue');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [afterAction, setAfterAction] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    repo
      .loadMyUnit()
      .catch((e: any) => setLoadError(e?.message || 'Could not load your unit.'))
      .finally(() => setLoaded(true));
    const t = setInterval(() => setNow(new Date()), 30000);
    // new dispatches arrive through realtime; refresh the unit data now and then too
    const r = setInterval(() => repo.loadMyUnit().catch(() => undefined), 60000);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, []);

  const NAV: { id: View; label: string; icon: typeof ListChecks }[] = [
    { id: 'queue', label: 'Dispatches', icon: ListChecks },
    { id: 'roster', label: 'Roster', icon: Users },
    { id: 'equipment', label: 'Equipment', icon: Wrench },
    { id: 'requests', label: 'Requests', icon: Inbox },
    ...(isHospital ? [{ id: 'hospital' as View, label: 'Hospital', icon: HeartPulse }] : []),
  ];

  const run = async (fn: () => Promise<void>, ok: string) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      setNotice(ok);
    } catch (e: any) {
      setNotice(e?.message || 'Something went wrong.');
    } finally {
      setBusy(false);
      setTimeout(() => setNotice(null), 4500);
    }
  };

  const q = query.trim().toLowerCase();
  const items = useMemo(
    () =>
      data.dispatches
        .filter((d) => !q || [d.report?.code, d.report?.hazard_type, d.report?.barangay, d.team, d.instructions].some((f) => (f || '').toLowerCase().includes(q)))
        .sort(
          (a, b) =>
            Number(isOpenStage(b.dispatch_status)) - Number(isOpenStage(a.dispatch_status)) ||
            (PRIORITY[a.report?.severity || '']?.rank ?? 3) - (PRIORITY[b.report?.severity || '']?.rank ?? 3) ||
            new Date(b.dispatched_at).getTime() - new Date(a.dispatched_at).getTime()
        ),
    [data.dispatches, q]
  );
  const selected = items.find((i) => i.id === selectedId) || items[0] || null;

  const today = now;
  const activeCount = data.dispatches.filter((d) => isOpenStage(d.dispatch_status)).length;
  const crewOnDuty = data.personnel.filter((p) => p.on_duty).length;
  const doneToday = data.dispatches.filter((d) => sameDay(d.done_at, today)).length;
  const newest = data.dispatches.find((d) => d.dispatch_status === 'sent');

  const select = (d: Dispatch) => {
    setSelectedId(d.id);
    setAfterAction('');
    setNotice(null);
    setSheetOpen(true);
  };

  const initial = (currentUser.full_name || 'D').trim().charAt(0).toUpperCase();
  const clock = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });

  /* ------------------------------------------------------------ pieces */

  const stagePill = (s: DispatchStage, onAccent = false) => (
    <span
      className={`inline-flex items-center justify-center min-w-[88px] h-6 px-2.5 rounded-md text-[11px] font-semibold ${
        onAccent ? 'bg-white text-[#E2552B]' : STAGE_PILL[s]
      }`}
    >
      {STAGES.find((x) => x.id === s)?.label}
    </span>
  );

  const row = (d: Dispatch) => {
    const active = selected?.id === d.id;
    const priority = PRIORITY[d.report?.severity || '']?.label || 'Normal';
    return (
      <button
        key={d.id}
        type="button"
        onClick={() => select(d)}
        aria-current={active ? 'true' : undefined}
        className={`w-full text-left grid grid-cols-[1fr_auto] md:grid-cols-[1.2fr_1.2fr_1fr_1.1fr_auto_24px] items-center gap-x-4 gap-y-1 rounded-xl px-4 md:px-5 py-3.5 transition-all duration-200 cursor-pointer ${
          active
            ? 'bg-gradient-to-r from-[#F07A4A] to-[#E2552B] text-white shadow-[0_14px_30px_-12px_rgba(226,85,43,0.7)] md:-mx-3 md:px-8 relative z-10'
            : 'bg-white text-neutral-700 shadow-[0_2px_10px_-6px_rgba(120,60,30,0.25)] hover:shadow-[0_6px_18px_-10px_rgba(120,60,30,0.35)]'
        }`}
      >
        <span className="min-w-0">
          <span className={`block text-[13px] font-semibold truncate ${active ? 'text-white' : 'text-neutral-800'}`}>{d.report?.code || 'Dispatch'}</span>
          <span className={`block text-[11px] truncate md:hidden ${active ? 'text-white/80' : 'text-neutral-400'}`}>
            {d.report?.hazard_type} · {d.report?.barangay || 'No barangay'} · {relTime(d.dispatched_at)}
          </span>
          <span className={`hidden md:block text-[11px] truncate ${active ? 'text-white/80' : 'text-neutral-400'}`}>{relTime(d.dispatched_at)}</span>
        </span>
        <span className={`hidden md:block text-[13px] truncate ${active ? 'text-white' : ''}`}>
          {d.report?.hazard_type}
          <span className={`block text-[11px] ${active ? 'text-white/80' : 'text-neutral-400'}`}>{priority}</span>
        </span>
        <span className="hidden md:block text-[13px] truncate">{d.team}</span>
        <span className="hidden md:block text-[13px] truncate">{d.report?.barangay || '—'}</span>
        <span className="justify-self-end">{stagePill(d.dispatch_status, active)}</span>
        <MoreVertical className={`hidden md:block w-4 h-4 justify-self-end ${active ? 'text-white' : 'text-neutral-300'}`} />
      </button>
    );
  };

  const crewCard = (p: UnitPersonnel) => (
    <div key={p.id} className="snap-start shrink-0 w-[132px] rounded-2xl p-3.5 bg-[#F7F4F2]">
      <span className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 bg-white text-[#E2552B]">
        <Truck className="w-5 h-5" />
      </span>
      <span className="block text-[13px] font-bold text-neutral-800 truncate">{p.name}</span>
      <span className="block text-[11px] text-neutral-400 truncate mt-0.5">{p.role || 'Crew'}</span>
    </div>
  );

  const detailRow = (label: string, value: React.ReactNode) => (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="text-[13px] font-medium text-neutral-700 shrink-0">{label}</span>
      <span className="text-[13px] text-neutral-400 text-right min-w-0 break-words">{value}</span>
    </div>
  );

  const stageIndex = selected ? STAGES.findIndex((s) => s.id === selected.dispatch_status) : 0;
  const next = selected ? NEXT_ACTION[selected.dispatch_status] : undefined;
  const onDuty = data.personnel.filter((p) => p.on_duty);

  const details = selected ? (
    <>
      <section className={`${panel} p-5`}>
        <h3 className="text-[15px] font-semibold text-neutral-800 mb-4">Crew on Duty</h3>
        {onDuty.length ? (
          <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x -mx-1 px-1 pb-1">{onDuty.map(crewCard)}</div>
        ) : (
          <p className="text-[12px] text-neutral-400">Nobody is marked on duty. Set the roster under Roster.</p>
        )}
        <div className="flex gap-1 mt-4" aria-hidden="true">
          <span className="w-4 h-1 rounded-full bg-neutral-300" />
          <span className="w-1 h-1 rounded-full bg-neutral-200" />
          <span className="w-1 h-1 rounded-full bg-neutral-200" />
        </div>
      </section>

      <section className={`${panel} px-5 py-3`}>
        {detailRow('Report', selected.report?.code || '—')}
        {detailRow('Hazard', selected.report?.hazard_type || '—')}
        {detailRow('Priority', PRIORITY[selected.report?.severity || '']?.label || 'Normal')}
        {detailRow('Barangay', selected.report?.barangay || '—')}
        {detailRow('Team', selected.team)}
        {detailRow('ETA', selected.eta ? new Date(selected.eta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—')}
        {detailRow('Dispatched by', `${selected.dispatched_by_name || '—'} · ${relTime(selected.dispatched_at)}`)}
        {selected.instructions && <p className="mt-2 mb-1 text-[13px] text-neutral-700 bg-[#FFF4EC] rounded-xl px-3.5 py-2.5">{selected.instructions}</p>}
      </section>

      <section className={`${panel} p-5 flex-1 flex flex-col`}>
        <h3 className="text-[15px] font-semibold text-neutral-800 mb-4">Progress</h3>
        {/* one bar per stage, in the reference's three-step style */}
        <div className="grid grid-cols-5 gap-1.5" aria-label={`Stage: ${STAGES[stageIndex]?.label}`}>
          {STAGES.map((s, i) => (
            <div key={s.id} className="min-w-0">
              <div className={`h-1.5 rounded-full ${i <= stageIndex ? 'bg-gradient-to-r from-[#F07A4A] to-[#E2552B]' : 'bg-[#F3ECE7]'}`} />
              <span className={`block mt-1.5 text-[10px] font-semibold truncate ${i <= stageIndex ? 'text-[#C2410C]' : 'text-neutral-400'}`}>{s.label}</span>
            </div>
          ))}
        </div>

        {selected.dispatch_status === 'done' && (
          <div className="mt-5">
            <h4 className="text-[13px] font-semibold text-neutral-700 mb-2">After-action report</h4>
            {selected.after_action ? (
              <p className="text-[13px] text-neutral-600 bg-[#F7F4F2] rounded-xl px-3.5 py-2.5 whitespace-pre-wrap">{selected.after_action}</p>
            ) : (
              <>
                <textarea
                  rows={3}
                  value={afterAction}
                  onChange={(e) => setAfterAction(e.target.value)}
                  placeholder="What was done, casualties, equipment used, follow-up needed"
                  className="w-full rounded-xl bg-[#F7F4F2] border border-transparent px-3.5 py-2.5 text-[13px] resize-none focus:outline-none focus:bg-white focus:border-[#F07A4A]"
                />
                <button
                  type="button"
                  disabled={busy || !afterAction.trim()}
                  onClick={() => run(() => repo.submitAfterAction(selected.id, afterAction.trim()), 'After-action report saved')}
                  className={`${accentBtn} w-full mt-2`}
                >
                  Save report
                </button>
              </>
            )}
          </div>
        )}

        <div className="mt-auto pt-5">
          {notice && <p className="text-[12px] text-center text-neutral-500 mb-2">{notice}</p>}
          {next ? (
            <button type="button" onClick={() => run(() => repo.respondToDispatch(selected.id, next.to), `Dispatch is now ${(STAGES.find((x) => x.id === next.to)?.label || '').toLowerCase()}`)} disabled={busy} className={`${accentBtn} w-full h-12`}>
              {busy ? <BrandLoader mode="inline" portal="dispatch" process="refresh" variant="reverse" /> : next.label}
            </button>
          ) : (
            <p className="text-center text-[12px] text-neutral-400">This dispatch is complete.</p>
          )}
        </div>
      </section>
    </>
  ) : (
    <section className={`${panel} p-6 text-center text-[13px] text-neutral-400`}>No dispatches for your unit yet.</section>
  );

  /* ------------------------------------------------------------ views */

  const heading = (title: string, sub?: string, right?: React.ReactNode) => (
    <div className="flex flex-wrap items-end justify-between gap-3 mt-7 mb-3">
      <div>
        <h2 className="text-[22px] font-semibold text-neutral-700">{title}</h2>
        {sub && <p className="text-[12px] text-neutral-400 mt-0.5">{sub}</p>}
      </div>
      {right}
    </div>
  );

  const queueView = (
    <>
      {heading('Dispatch Queue', undefined, <span className="text-[12px] text-neutral-400">{items.length} {items.length === 1 ? 'dispatch' : 'dispatches'}</span>)}
      <div className="hidden md:grid grid-cols-[1.2fr_1.2fr_1fr_1.1fr_auto_24px] gap-x-4 px-5 pb-2 text-[12px] font-medium text-neutral-500">
        <span>Report</span>
        <span>Hazard / Priority</span>
        <span>Team</span>
        <span>Barangay</span>
        <span className="min-w-[88px] text-center">Stage</span>
        <span />
      </div>
      <div className="space-y-3 pb-6">
        {items.length ? (
          items.map(row)
        ) : (
          <p className="text-center text-[13px] text-neutral-400 py-10">{q ? 'No dispatches match.' : 'No dispatches for your unit yet. They appear here the moment one is sent.'}</p>
        )}
      </div>
    </>
  );

  // roster: unit admins add crew; anyone in the unit sets who is on duty
  const [crewForm, setCrewForm] = useState({ name: '', role: '', phone: '' });
  const rosterView = (
    <div className="pb-6">
      {heading('Roster', `${crewOnDuty} of ${data.personnel.length} on duty`)}
      <div className="space-y-3">
        {data.personnel.map((p) => (
          <div key={p.id} className="bg-white rounded-xl px-5 py-3.5 flex items-center gap-3 shadow-[0_2px_10px_-6px_rgba(120,60,30,0.25)]">
            <span className="w-10 h-10 rounded-xl bg-[#FFF1EA] text-[#E2552B] font-bold flex items-center justify-center shrink-0">{p.name.charAt(0).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-neutral-800 truncate">{p.name}</span>
              <span className="block text-[12px] text-neutral-400 truncate">{[p.role, p.phone].filter(Boolean).join(' · ') || 'Crew'}</span>
            </span>
            {p.phone && (
              <a href={`tel:${p.phone}`} aria-label={`Call ${p.name}`} className="w-9 h-9 rounded-full bg-[#F7F4F2] text-neutral-600 flex items-center justify-center shrink-0">
                <Phone className="w-4 h-4" />
              </a>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => repo.setPersonnelDuty(p.id, !p.on_duty), p.on_duty ? `${p.name} is off duty` : `${p.name} is on duty`)}
              className={`shrink-0 h-9 px-3.5 rounded-full text-[12px] font-semibold cursor-pointer ${p.on_duty ? 'bg-[#73B386] text-white' : 'bg-[#F7F4F2] text-neutral-500'}`}
            >
              {p.on_duty ? 'On duty' : 'Off duty'}
            </button>
          </div>
        ))}
        {!data.personnel.length && <p className="text-[13px] text-neutral-400 py-6 text-center">No crew listed yet.</p>}
      </div>
      {isUnitAdmin && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!crewForm.name.trim()) return;
            run(async () => {
              await repo.addPersonnel(crewForm);
              setCrewForm({ name: '', role: '', phone: '' });
            }, 'Crew member added');
          }}
          className={`${panel} mt-4 p-4 grid grid-cols-1 sm:grid-cols-[1.2fr_1fr_1fr_auto] gap-2`}
        >
          <input className={field} placeholder="Name" value={crewForm.name} onChange={(e) => setCrewForm({ ...crewForm, name: e.target.value })} />
          <input className={field} placeholder="Role (driver, medic…)" value={crewForm.role} onChange={(e) => setCrewForm({ ...crewForm, role: e.target.value })} />
          <input className={field} placeholder="Phone" value={crewForm.phone} onChange={(e) => setCrewForm({ ...crewForm, phone: e.target.value })} />
          <button type="submit" disabled={busy} className={accentBtn}>
            <Plus className="w-4 h-4" /> Add
          </button>
        </form>
      )}
    </div>
  );

  const [equipForm, setEquipForm] = useState({ label: '', identifier: '' });
  const equipmentView = (
    <div className="pb-6">
      {heading('Equipment & Readiness', `${data.equipment.filter((e) => e.status === 'available').length} of ${data.equipment.length} available`)}
      <div className="space-y-3">
        {data.equipment.map((e) => (
          <div key={e.id} className="bg-white rounded-xl px-5 py-3.5 shadow-[0_2px_10px_-6px_rgba(120,60,30,0.25)]">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-[#FFF1EA] text-[#E2552B] flex items-center justify-center shrink-0">
                <Wrench className="w-5 h-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-neutral-800 truncate">{e.label}</span>
                <span className="block text-[12px] text-neutral-400 truncate">
                  {[e.identifier, e.last_checked_at ? `checked ${relTime(e.last_checked_at)}` : 'never checked'].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className={`shrink-0 inline-flex items-center justify-center h-6 px-2.5 rounded-md text-[11px] font-semibold capitalize ${EQUIP_PILL[e.status]}`}>{e.status}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => run(() => repo.recordEquipmentCheck(e.id, 'ready'), `${e.label} checked: ready`)} className="h-8 px-3 rounded-full text-[12px] font-semibold bg-[#F7F4F2] text-neutral-600 cursor-pointer">
                <Check className="w-3.5 h-3.5 inline mr-1" />
                Checked, ready
              </button>
              <button type="button" disabled={busy} onClick={() => run(() => repo.recordEquipmentCheck(e.id, 'needs_repair'), `${e.label} flagged for repair`)} className="h-8 px-3 rounded-full text-[12px] font-semibold bg-[#F7F4F2] text-neutral-600 cursor-pointer">
                Needs repair
              </button>
              {e.status !== 'available' && (
                <button type="button" disabled={busy} onClick={() => run(() => repo.setEquipmentStatus(e.id, 'available'), `${e.label} available`)} className="h-8 px-3 rounded-full text-[12px] font-semibold bg-[#F7F4F2] text-neutral-600 cursor-pointer">
                  Mark available
                </button>
              )}
            </div>
          </div>
        ))}
        {!data.equipment.length && <p className="text-[13px] text-neutral-400 py-6 text-center">No equipment listed yet.</p>}
      </div>
      {isUnitAdmin && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!equipForm.label.trim()) return;
            run(async () => {
              await repo.addEquipment(equipForm);
              setEquipForm({ label: '', identifier: '' });
            }, 'Equipment added');
          }}
          className={`${panel} mt-4 p-4 grid grid-cols-1 sm:grid-cols-[1.4fr_1fr_auto] gap-2`}
        >
          <input className={field} placeholder="Equipment (e.g. Fire truck, rubber boat)" value={equipForm.label} onChange={(e) => setEquipForm({ ...equipForm, label: e.target.value })} />
          <input className={field} placeholder="Plate or tag number" value={equipForm.identifier} onChange={(e) => setEquipForm({ ...equipForm, identifier: e.target.value })} />
          <button type="submit" disabled={busy} className={accentBtn}>
            <Plus className="w-4 h-4" /> Add
          </button>
        </form>
      )}
    </div>
  );

  const [reqForm, setReqForm] = useState({ kind: 'fuel', details: '' });
  const requestsView = (
    <div className="pb-6">
      {heading('Support Requests', 'Fuel, personnel, equipment or mutual aid from the LGU')}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!reqForm.details.trim()) return;
          run(async () => {
            await repo.createUnitRequest(reqForm.kind, reqForm.details.trim());
            setReqForm({ kind: 'fuel', details: '' });
          }, 'Request sent to the LGU');
        }}
        className={`${panel} p-4 grid grid-cols-1 sm:grid-cols-[160px_1fr_auto] gap-2`}
      >
        <select className={field} value={reqForm.kind} onChange={(e) => setReqForm({ ...reqForm, kind: e.target.value })}>
          {Object.entries(KIND_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input className={field} placeholder="What do you need, and where?" value={reqForm.details} onChange={(e) => setReqForm({ ...reqForm, details: e.target.value })} />
        <button type="submit" disabled={busy} className={accentBtn}>
          Send
        </button>
      </form>
      <div className="space-y-3 mt-4">
        {data.unitRequests.map((r) => (
          <div key={r.id} className="bg-white rounded-xl px-5 py-3.5 flex items-center gap-3 shadow-[0_2px_10px_-6px_rgba(120,60,30,0.25)]">
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-neutral-800 truncate">{KIND_LABEL[r.kind] || r.kind}</span>
              <span className="block text-[12px] text-neutral-400 truncate">
                {r.details} · {relTime(r.created_at)}
              </span>
            </span>
            <span
              className={`shrink-0 inline-flex items-center justify-center h-6 px-2.5 rounded-md text-[11px] font-semibold capitalize ${
                r.status === 'approved' || r.status === 'done' ? 'bg-[#73B386] text-white' : r.status === 'declined' ? 'bg-[#D9534F] text-white' : 'bg-[#E9B872] text-white'
              }`}
            >
              {r.status}
            </span>
          </div>
        ))}
        {!data.unitRequests.length && <p className="text-[13px] text-neutral-400 py-6 text-center">No requests sent yet.</p>}
      </div>
    </div>
  );

  const cap = data.capacity;
  const [capForm, setCapForm] = useState({ er_beds: 0, icu_beds: 0, available: 0, accepting: true });
  useEffect(() => {
    if (cap) setCapForm({ er_beds: cap.er_beds, icu_beds: cap.icu_beds, available: cap.available, accepting: cap.accepting });
  }, [cap?.updated_at]);
  const hospitalView = (
    <div className="pb-6">
      {heading('Hospital Capacity', cap?.updated_at ? `Last updated ${relTime(cap.updated_at)}` : 'Not reported yet')}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(() => repo.setHospitalCapacity({ ...capForm, updated_at: null }), 'Capacity updated');
        }}
        className={`${panel} p-5 grid grid-cols-1 sm:grid-cols-3 gap-4`}
      >
        {(
          [
            ['er_beds', 'ER beds'],
            ['icu_beds', 'ICU beds'],
            ['available', 'Available now'],
          ] as const
        ).map(([k, l]) => (
          <label key={k} className="block">
            <span className="block text-[12px] text-neutral-400 mb-1.5">{l}</span>
            <input type="number" min={0} className={field} value={capForm[k]} onChange={(e) => setCapForm({ ...capForm, [k]: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
        ))}
        <label className="sm:col-span-2 flex items-center gap-2 text-[13px] text-neutral-700">
          <input type="checkbox" checked={capForm.accepting} onChange={(e) => setCapForm({ ...capForm, accepting: e.target.checked })} className="w-4 h-4 accent-[#E2552B]" />
          Accepting patients
        </label>
        <button type="submit" disabled={busy} className={accentBtn}>
          Save capacity
        </button>
      </form>
    </div>
  );

  const hasDetails = view === 'queue';

  // a dispatch account must belong to a unit; without one there is nothing to show
  if (loaded && !currentUser.dispatch_unit_id) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-[#FBEFEA] p-6">
        <div className="max-w-sm text-center bg-white rounded-[28px] p-8 shadow-[0_30px_80px_-30px_rgba(160,70,40,0.35)]">
          <TriadEmblem portal="dispatch" size={48} className="mx-auto" />
          <h1 className="mt-4 text-[18px] font-bold text-neutral-800">No unit assigned</h1>
          <p className="mt-2 text-[13px] text-neutral-500">This dispatch account is not part of a unit yet. Ask the Super Admin to add you to your unit.</p>
          <button type="button" onClick={onSignOut} className={`${accentBtn} mt-6 w-full`}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

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
            <nav aria-label="Dispatch sections" className="flex-1 flex flex-col items-center gap-3 pt-8 pb-6 rounded-tr-[56px] bg-gradient-to-b from-[#F07A4A] via-[#E2552B] to-[#C2410C]">
              <span className="w-12 h-12 rounded-full bg-white/20 ring-2 ring-white/70 flex items-center justify-center text-white font-black text-lg mb-6">{initial}</span>
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
              <button type="button" onClick={onSignOut} aria-label="Sign out" title="Sign out" className="mt-auto w-11 h-11 rounded-xl bg-white/20 text-white flex items-center justify-center cursor-pointer hover:bg-white/30">
                <LogOut className="w-5 h-5" />
              </button>
            </nav>
          </aside>

          {/* ---------------- middle column */}
          <main className="flex-1 min-w-0 flex flex-col">
            {/* phone header */}
            <div className="md:hidden flex items-center gap-3 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-2">
              <TriadEmblem portal="dispatch" size={28} />
              <span className="min-w-0 text-[15px] font-extrabold text-neutral-800 truncate">{unit?.name || 'Dispatch'}</span>
              <span className="ml-auto text-[12px] font-semibold text-neutral-500">{clock}</span>
              <span className="w-9 h-9 shrink-0 rounded-full bg-gradient-to-br from-[#F07A4A] to-[#C2410C] text-white font-black flex items-center justify-center">{initial}</span>
              <button type="button" onClick={onSignOut} aria-label="Sign out" className="w-9 h-9 shrink-0 rounded-full bg-white text-[#C2410C] flex items-center justify-center shadow-sm cursor-pointer">
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
                    placeholder="Search reports, hazards or barangays"
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

              {loadError && <p className="mt-4 text-[12px] text-red-700 bg-red-50 rounded-xl px-4 py-2">{loadError}</p>}

              {/* summary strip + newest dispatch */}
              <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_minmax(0,240px)] gap-4">
                <div className="bg-white rounded-2xl px-5 py-5 grid grid-cols-3 divide-x divide-neutral-100 shadow-[0_6px_24px_-14px_rgba(120,60,30,0.35)]">
                  {[
                    { label: 'Active dispatches', value: activeCount, sub: unit?.name || '' },
                    { label: 'Crew on duty', value: crewOnDuty, sub: `of ${data.personnel.length}` },
                    { label: 'Done today', value: doneToday, sub: 'completed' },
                  ].map((s, i) => (
                    <div key={s.label} className={`min-w-0 ${i ? 'pl-4 sm:pl-6' : ''}`}>
                      <p className="text-[11px] sm:text-[12px] text-neutral-400 truncate">{s.label}</p>
                      <p className="text-[22px] sm:text-[26px] font-semibold text-neutral-800 mt-1 tabular-nums">{s.value}</p>
                      <p className="mt-1 hidden sm:block text-[11px] font-semibold text-neutral-400 truncate">{s.sub}</p>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setView('queue');
                    if (newest) select(newest);
                  }}
                  className="text-left rounded-2xl p-5 bg-gradient-to-br from-[#F07A4A] to-[#D9481F] text-white shadow-[0_14px_30px_-14px_rgba(217,72,31,0.8)] cursor-pointer"
                >
                  <span className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider">New dispatch</span>
                    <ChevronRight className="w-4 h-4 opacity-80" />
                  </span>
                  <span className="block mt-3 text-[13px] leading-snug text-white/90">
                    {newest
                      ? `${newest.report?.hazard_type || 'Incident'} in ${newest.report?.barangay || 'Lingayen'}, ${relTime(newest.dispatched_at)}. Waiting for acknowledgement.`
                      : 'Nothing waiting for acknowledgement.'}
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
                    className={`shrink-0 h-9 px-4 rounded-full text-[13px] font-semibold cursor-pointer ${view === item.id ? 'bg-[#E2552B] text-white' : 'bg-white text-neutral-500'}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {notice && !hasDetails && <p className="mt-4 text-[12px] text-[#9A3412] bg-[#FFF4EC] rounded-xl px-4 py-2">{notice}</p>}

              {view === 'queue' ? queueView : view === 'roster' ? rosterView : view === 'equipment' ? equipmentView : view === 'requests' ? requestsView : hospitalView}
            </div>
          </main>

          {/* ---------------- right panel (desktop) */}
          {hasDetails && (
            <aside aria-label="Dispatch details" className="hidden lg:flex w-[340px] shrink-0 flex-col gap-3 p-3 bg-[#F7F1EE] overflow-y-auto">
              {details}
            </aside>
          )}
        </div>
      </div>

      {/* ---------------- details as a sheet (tablet and phone) */}
      {hasDetails && selected && (
        <div className={`lg:hidden fixed inset-0 z-40 ${sheetOpen ? '' : 'pointer-events-none'}`}>
          <div className={`absolute inset-0 bg-[#3B1607]/40 transition-opacity duration-300 ${sheetOpen ? 'opacity-100' : 'opacity-0'}`} onClick={() => setSheetOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label="Dispatch details"
            inert={!sheetOpen}
            className={`absolute inset-x-0 bottom-0 max-h-[88vh] flex flex-col gap-3 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] rounded-t-[28px] bg-[#F7F1EE] overflow-y-auto transition-transform duration-300 ease-out ${
              sheetOpen ? 'translate-y-0' : 'translate-y-full'
            }`}
          >
            <div className="sticky -top-3 z-10 -mx-3 -mt-3 px-5 pt-3 pb-1 flex items-center justify-between bg-[#F7F1EE]">
              <span className="w-10 h-1 rounded-full bg-neutral-300 mx-auto absolute left-1/2 -translate-x-1/2 top-2" aria-hidden="true" />
              <h3 className="text-[15px] font-bold text-neutral-800 mt-2">{selected.report?.code || 'Dispatch'}</h3>
              <button type="button" onClick={() => setSheetOpen(false)} aria-label="Close details" className="mt-2 w-9 h-9 rounded-full bg-white text-neutral-600 flex items-center justify-center cursor-pointer">
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
