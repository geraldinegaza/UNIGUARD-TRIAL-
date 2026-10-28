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
  BarChart3,
  BookUser,
  Bell,
  RefreshCw,
  Download,
  UserPlus,
  AlertTriangle,
} from 'lucide-react';
import { User, Dispatch, DispatchAction, DispatchStage, HelpRequest, UnitEquipment, UnitPersonnel } from '../types';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import { relTime, download, toCSV, telHref } from '../lib/util';
import { CONFIG } from '../lib/config';
import { TriadEmblem, BrandLoader } from '../brand';

// Dispatch Team console. A dispatch account belongs to one unit (BFP, PNP,
// Rescue or Hospital) and sees only what is addressed to that unit. The
// screens follow the reference build: Incoming Dispatches (with the dispatch
// detail, its status trail and the after-action report), Equipment &
// Readiness, Roster & Shifts, Hospital (hospital units), Support Requests,
// Unit Analytics, Directory and Notifications. The frame keeps the approved
// orange layout: an icon rail, the main column, and the selected dispatch on
// the right (a sheet on tablets and phones). Every write goes through the
// server's checked functions.

type View = 'queue' | 'equipment' | 'roster' | 'hospital' | 'requests' | 'analytics' | 'contacts' | 'notifications';

const STAGE_LABEL: Record<DispatchStage, string> = {
  sent: 'Sent',
  acknowledged: 'Acknowledged',
  en_route: 'En route',
  on_scene: 'On scene',
  under_control: 'Under control',
  fire_out: 'Fire out',
  on_hold: 'On hold',
  transporting: 'Transporting',
  arrived_hospital: 'At hospital',
  done: 'Done',
  declined: 'Declined',
};
const STAGE_PILL: Record<DispatchStage, string> = {
  sent: 'bg-[#D9534F] text-white',
  acknowledged: 'bg-[#E9B872] text-white',
  en_route: 'bg-[#7C83C9] text-white',
  on_scene: 'bg-[#6BAED6] text-white',
  under_control: 'bg-[#E08A4F] text-white',
  fire_out: 'bg-[#8CBF6E] text-white',
  on_hold: 'bg-[#B98A8A] text-white',
  transporting: 'bg-[#7C83C9] text-white',
  arrived_hospital: 'bg-[#6BAED6] text-white',
  done: 'bg-[#73B386] text-white',
  declined: 'bg-[#F3EFEC] text-neutral-500',
};
// The steps after on scene depend on the team (migration 155):
//   BFP       on scene -> under control -> fire out -> done
//   Ambulance on scene -> transporting -> at hospital -> done
//   Rescue    en route / on scene -> on hold (with a reason) -> resume -> on scene
const isRescueTeam = (team: string) => team === 'Rescue Unit' || team === 'MDRRMO Rescue';
const teamFlow = (team: string): { id: DispatchStage; label: string }[] => {
  // the seven-step flows use short labels so each fits its segment
  const head = (ack: string): { id: DispatchStage; label: string }[] => [
    { id: 'sent', label: 'Sent' },
    { id: 'acknowledged', label: ack },
    { id: 'en_route', label: 'En route' },
    { id: 'on_scene', label: 'On scene' },
  ];
  if (team === 'BFP') return [...head('Ack'), { id: 'under_control', label: 'Control' }, { id: 'fire_out', label: 'Fire out' }, { id: 'done', label: 'Done' }];
  if (team === 'Ambulance') return [...head('Ack'), { id: 'transporting', label: 'Transit' }, { id: 'arrived_hospital', label: 'Arrived' }, { id: 'done', label: 'Done' }];
  return [...head('Acknowledged'), { id: 'done', label: 'Done' }];
};
// the actions that move a dispatch on; the first is the main button
const nextSteps = (d: Dispatch): { to: DispatchAction; label: string }[] => {
  const rescue = isRescueTeam(d.team);
  const hold = rescue ? [{ to: 'on_hold' as const, label: 'On hold' }] : [];
  switch (d.dispatch_status) {
    case 'sent':
      return [{ to: 'acknowledged', label: 'Acknowledge' }];
    case 'acknowledged':
      return [{ to: 'en_route', label: 'En route' }];
    case 'en_route':
      return [{ to: 'on_scene', label: 'On scene' }, ...hold];
    case 'on_scene':
      if (d.team === 'BFP') return [{ to: 'under_control', label: 'Under control' }];
      if (d.team === 'Ambulance') return [{ to: 'transporting', label: 'Transporting' }];
      return [{ to: 'done', label: 'Done' }, ...hold];
    case 'under_control':
      return [{ to: 'fire_out', label: 'Fire out' }];
    case 'fire_out':
      return [{ to: 'done', label: 'Done' }];
    case 'on_hold':
      return [{ to: 'resume', label: 'Resume' }];
    case 'transporting':
      return [{ to: 'arrived_hospital', label: 'Arrived at hospital' }];
    case 'arrived_hospital':
      return [{ to: 'done', label: 'Done' }];
    default:
      return [];
  }
};
const ACTION_LABEL: Record<string, string> = { ...STAGE_LABEL, arrived_hospital: 'Arrived at hospital', resume: 'Resumed' };
// field data can be saved once the dispatch is acknowledged and until it closes
const FIELD_OPEN: DispatchStage[] = ['acknowledged', 'en_route', 'on_scene', 'under_control', 'fire_out', 'on_hold', 'transporting', 'arrived_hospital'];
const HELP_KIND: Record<HelpRequest['kind'], string> = {
  general: 'General',
  water_tanker: 'Water tanker',
  extra_personnel: 'Extra personnel',
  beyond_capacity: 'Beyond capacity',
};
const HELP_PILL: Record<HelpRequest['status'], string> = {
  sent: 'bg-[#E9B872] text-white',
  acknowledged: 'bg-[#7C83C9] text-white',
  resolved: 'bg-[#73B386] text-white',
};
const NOTICE_PILL: Record<string, string> = {
  sent: 'bg-[#E9B872] text-white',
  acknowledged: 'bg-[#7C83C9] text-white',
  arrived: 'bg-[#73B386] text-white',
  cancelled: 'bg-[#F3EFEC] text-neutral-500',
};
const PRIORITY: Record<string, { label: string; rank: number }> = {
  emergency: { label: 'Critical', rank: 0 },
  warning: { label: 'High', rank: 1 },
  advisory: { label: 'Normal', rank: 2 },
};
const EQUIP_STATUS: UnitEquipment['status'][] = ['available', 'deployed', 'maintenance', 'unavailable'];
const EQUIP_PILL: Record<string, string> = {
  available: 'bg-[#73B386] text-white',
  deployed: 'bg-[#7C83C9] text-white',
  maintenance: 'bg-[#E9B872] text-white',
  unavailable: 'bg-[#D9534F] text-white',
};
const CONDITIONS = ['ready', 'needs_repair', 'missing', 'out_of_service', 'unknown'];
const COND_PILL: Record<string, string> = {
  ready: 'bg-[#E7F4EA] text-[#2F6B3F]',
  needs_repair: 'bg-[#FDF0DC] text-[#8A5A12]',
  missing: 'bg-[#FBE3E2] text-[#9B2C2C]',
  out_of_service: 'bg-[#FBE3E2] text-[#9B2C2C]',
  unknown: 'bg-[#F3EFEC] text-neutral-500',
};
const KIND_LABEL: Record<string, string> = { fuel: 'Fuel', personnel: 'Personnel', equipment: 'Equipment', mutual_aid: 'Mutual aid', other: 'Other' };
const UNIT_TYPE_LABEL: Record<string, string> = { BFP: 'Fire (BFP)', PNP: 'Police (PNP)', Rescue: 'Rescue Unit', Hospital: 'Hospital' };
const pretty = (s: string) => (s || '').replace(/_/g, ' ');

const isOpenStage = (s: DispatchStage) => s !== 'done' && s !== 'declined';
const DAY_MS = 86400000;
const overdue = (e: UnitEquipment) => !e.last_checked_at || Date.now() - Date.parse(e.last_checked_at) > DAY_MS;
const absTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

const panel = 'bg-white rounded-[22px]';
const field =
  'w-full h-11 rounded-xl bg-[#F7F4F2] border border-transparent px-3.5 text-[13px] focus:outline-none focus:bg-white focus:border-[#F07A4A]';
const accentBtn =
  'h-11 px-5 rounded-xl text-white text-[13px] font-bold bg-gradient-to-r from-[#F07A4A] to-[#E2552B] shadow-[0_12px_24px_-12px_rgba(226,85,43,0.8)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2';
const softBtn = 'h-9 px-3.5 rounded-full text-[12px] font-semibold bg-[#F7F4F2] text-neutral-600 hover:bg-[#F1E8E3] cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5';
const card = 'bg-white rounded-xl px-5 py-3.5 shadow-[0_2px_10px_-6px_rgba(120,60,30,0.25)]';

interface DispatchPortalProps {
  currentUser: User;
  onSignOut: () => void;
}

// Pop-up in the console's style, used by the reference build's dialogs
const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }> = ({ title, onClose, children, footer }) => (
  <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
    <div className="absolute inset-0 bg-[#3B1607]/40" onClick={onClose} aria-hidden="true" />
    <div className="relative w-full sm:max-w-md max-h-[90dvh] overflow-y-auto bg-[#FDF6F3] rounded-t-[26px] sm:rounded-[26px] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5 shadow-[0_30px_80px_-30px_rgba(160,70,40,0.5)]">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-[16px] font-bold text-neutral-800">{title}</h3>
        <button type="button" onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full bg-white text-neutral-600 flex items-center justify-center cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="space-y-3">{children}</div>
      <div className="mt-5 flex justify-end gap-2">{footer}</div>
    </div>
  </div>
);

const Label: React.FC<{ text: string; children: React.ReactNode }> = ({ text, children }) => (
  <label className="block">
    <span className="block text-[12px] font-medium text-neutral-500 mb-1.5">{text}</span>
    {children}
  </label>
);

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
  const [noticeMain, setNoticeMain] = useState(false);
  const [afterAction, setAfterAction] = useState('');
  const [stepNote, setStepNote] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // pop-ups from the reference build
  const [checkFor, setCheckFor] = useState<UnitEquipment | null>(null);
  const [checkForm, setCheckForm] = useState({ condition: 'ready', level: '', notes: '' });
  const [statusFor, setStatusFor] = useState<UnitEquipment | null>(null);
  const [statusForm, setStatusForm] = useState<{ status: UnitEquipment['status']; notes: string }>({ status: 'available', notes: '' });
  const [requestOpen, setRequestOpen] = useState(false);
  const [reqForm, setReqForm] = useState({ kind: 'fuel', details: '' });
  const [capOpen, setCapOpen] = useState(false);
  const [capForm, setCapForm] = useState({ er_beds: 0, icu_beds: 0, available: 0, accepting: true });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [crewForm, setCrewForm] = useState({ name: '', role: '', phone: '' });
  // equipment: add, edit, retire / remove (unit admin)
  const [addEquipOpen, setAddEquipOpen] = useState(false);
  const [equipForm, setEquipForm] = useState({ catalogId: '', customLabel: '', identifier: '', condition: 'unknown', notes: '' });
  const [editEquip, setEditEquip] = useState<UnitEquipment | null>(null);
  const [editForm, setEditForm] = useState({ customLabel: '', identifier: '', condition: 'unknown', notes: '' });
  const [removeEquip, setRemoveEquip] = useState<UnitEquipment | null>(null);
  const [useCount, setUseCount] = useState<number | null>(null);
  // the selected dispatch: Can't respond, Need help, road closure, field data, after-action
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpForm, setHelpForm] = useState<{ kind: HelpRequest['kind']; message: string }>({ kind: 'general', message: '' });
  const [closureOpen, setClosureOpen] = useState(false);
  const [closureForm, setClosureForm] = useState({ roadName: '', note: '', segmentFrom: '', segmentTo: '', reopen: '' });
  const [fieldForm, setFieldForm] = useState({ stranded: '0', location: '', needs: '', rescued: '0', injured: '0', missing: '0', hospitalId: '' });
  const [noticeForm, setNoticeForm] = useState({ patients: '1', condition: '' });
  const [aaForm, setAaForm] = useState({ people: '0', followUp: false, followNote: '', families: '', injured: '' });

  const refresh = async () => {
    try {
      await repo.loadMyUnit();
      await repo.loadDispatchExtras();
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load your unit data.');
    }
  };

  useEffect(() => {
    refresh().finally(() => setLoaded(true));
    const t = setInterval(() => setNow(new Date()), 30000);
    // new dispatches arrive through realtime; refresh the unit data now and then too
    const r = setInterval(() => refresh(), 60000);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, []);

  const unread = data.notifications.filter((n) => n.unread).length;
  const NAV: { id: View; label: string; icon: typeof ListChecks; dot?: boolean }[] = [
    { id: 'queue', label: 'Incoming Dispatches', icon: ListChecks },
    { id: 'equipment', label: 'Equipment & Readiness', icon: Wrench },
    { id: 'roster', label: 'Roster & Shifts', icon: Users },
    ...(isHospital ? [{ id: 'hospital' as View, label: 'Hospital', icon: HeartPulse }] : []),
    { id: 'requests', label: 'Support Requests', icon: Inbox },
    { id: 'analytics', label: 'Unit Analytics', icon: BarChart3 },
    { id: 'contacts', label: 'Directory', icon: BookUser },
    { id: 'notifications', label: 'Notifications', icon: Bell, dot: unread > 0 },
  ];

  // inMain: the message belongs to the main column (an action outside the dispatch detail)
  const run = async (fn: () => Promise<void>, ok: string, inMain = false) => {
    if (busy) return false;
    setBusy(true);
    setNotice(null);
    setNoticeMain(inMain);
    try {
      await fn();
      setNotice(ok);
      return true;
    } catch (e: any) {
      setNotice(e?.message || 'Something went wrong.');
      return false;
    } finally {
      setBusy(false);
      setTimeout(() => setNotice(null), 4500);
    }
  };
  // a hint about the selected dispatch, shown in its status box
  const sayInDetail = (msg: string) => {
    setNoticeMain(false);
    setNotice(msg);
    setTimeout(() => setNotice(null), 4500);
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

  // the field, notice and after-action forms start from the selected dispatch's saved data
  useEffect(() => {
    const fd = selected?.field_data || {};
    const rd = fd.rescue_details;
    const rt = fd.rescue_tally;
    const evacPeople = Array.isArray(fd.evac_tally) ? fd.evac_tally.reduce((s, e) => s + (Number(e?.people) || 0), 0) : 0;
    setFieldForm({
      stranded: String(rd?.stranded_count ?? 0),
      location: rd?.location || '',
      needs: rd?.special_needs || '',
      rescued: String(rt?.rescued ?? 0),
      injured: String(rt?.injured ?? 0),
      missing: String(rt?.missing ?? 0),
      hospitalId: fd.hospital_id || '',
    });
    setNoticeForm({ patients: '1', condition: '' });
    setAaForm({ people: String(rt?.rescued || evacPeople || 0), followUp: false, followNote: '', families: '', injured: '' });
  }, [selected?.id]);

  const activeCount = data.dispatches.filter((d) => isOpenStage(d.dispatch_status)).length;
  const crewOnDuty = data.personnel.filter((p) => p.on_duty).length;
  const newest = data.dispatches.find((d) => d.dispatch_status === 'sent');
  const overdueCount = data.equipment.filter(overdue).length;

  const select = (d: Dispatch) => {
    setSelectedId(d.id);
    setAfterAction('');
    setStepNote('');
    setNotice(null);
    setSheetOpen(true);
  };

  const initial = (currentUser.full_name || 'D').trim().charAt(0).toUpperCase();
  // who is signed in, as the reference build's sidebar card shows it
  const identity = [
    currentUser.full_name || currentUser.email,
    currentUser.unit_role === 'unit_admin' ? 'Unit admin' : 'Member',
    unit ? UNIT_TYPE_LABEL[unit.unit_type] || unit.unit_type : '',
    crewOnDuty ? `${crewOnDuty} on duty` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const equipLabel = (e: UnitEquipment) => e.label || data.equipmentCatalog.find((c) => c.id === e.catalog_id)?.label || 'Equipment';
  const clock = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });

  /* ------------------------------------------------------------ pieces */

  const stagePill = (s: DispatchStage, onAccent = false) => (
    <span
      className={`inline-flex items-center justify-center min-w-[88px] h-6 px-2.5 rounded-md text-[11px] font-semibold ${
        onAccent ? 'bg-white text-[#E2552B]' : STAGE_PILL[s]
      }`}
    >
      {STAGE_LABEL[s] || pretty(s)}
    </span>
  );

  const pill = (cls: string, text: string) => (
    <span className={`shrink-0 inline-flex items-center justify-center h-6 px-2.5 rounded-md text-[11px] font-semibold capitalize ${cls}`}>{text}</span>
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
          <span className={`hidden md:block text-[11px] truncate ${active ? 'text-white/80' : 'text-neutral-400'}`}>
            {relTime(d.dispatched_at)} by {d.dispatched_by_name || '—'}
          </span>
        </span>
        <span className={`hidden md:block text-[13px] truncate ${active ? 'text-white' : ''}`}>
          {d.report?.hazard_type}
          <span className={`block text-[11px] ${active ? 'text-white/80' : 'text-neutral-400'}`}>{priority}</span>
        </span>
        <span className="hidden md:block text-[13px] truncate">{d.eta ? `ETA ${absTime(d.eta)}` : d.team}</span>
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

  const flow = selected ? teamFlow(selected.team) : [];
  // a rescue on hold sits at on scene in the progress bar
  const stageIndex = selected ? flow.findIndex((s) => s.id === (selected.dispatch_status === 'on_hold' ? 'on_scene' : selected.dispatch_status)) : -1;
  const steps = selected ? nextSteps(selected) : [];
  const onDuty = data.personnel.filter((p) => p.on_duty);
  const events = selected ? data.dispatchEvents.filter((e) => e.dispatch_id === selected.id) : [];
  const helpFor = selected ? data.helpRequests.filter((h) => h.dispatch_id === selected.id) : [];
  const isPnpUnit = unit?.unit_type === 'PNP';
  const selOpen = !!selected && isOpenStage(selected.dispatch_status);
  const fieldOpen = !!selected && FIELD_OPEN.includes(selected.dispatch_status);
  const isRescue = !!selected && isRescueTeam(selected.team);
  const isAmbulance = selected?.team === 'Ambulance';
  const count = (v: string) => Math.max(0, Math.floor(Number(v)) || 0);

  const respond = (to: DispatchAction) => {
    if (!selected) return;
    if (to === 'on_hold' && !stepNote.trim()) {
      sayInDetail('Write the reason for the hold in the note first.');
      return;
    }
    run(async () => {
      await repo.respondToDispatch(selected.id, to, stepNote.trim());
      await repo.loadDispatchExtras();
      setStepNote('');
    }, `Status updated to ${(ACTION_LABEL[to] || pretty(to)).toLowerCase()}`);
  };

  const askHelp = (kind: HelpRequest['kind'], message: string, ok: string) =>
    selected ? run(() => repo.requestDispatchHelp(selected.id, kind, message), ok) : Promise.resolve(false);

  const saveField = () => {
    if (!selected) return;
    const patch: Dispatch['field_data'] = {};
    if (isRescue) {
      const rescued = count(fieldForm.rescued);
      patch.rescue_details = { stranded_count: count(fieldForm.stranded), location: fieldForm.location.trim(), special_needs: fieldForm.needs.trim() };
      patch.rescue_tally = {
        rescued,
        injured: count(fieldForm.injured),
        missing: count(fieldForm.missing),
        destinations: fieldForm.hospitalId ? [{ kind: 'hospital', ref_id: fieldForm.hospitalId, count: rescued }] : [],
      };
    }
    if (fieldForm.hospitalId) patch.hospital_id = fieldForm.hospitalId;
    if (!Object.keys(patch).length) {
      sayInDetail('Pick an accepting hospital first.');
      return;
    }
    run(() => repo.saveDispatchFieldData(selected.id, patch), isRescue ? 'Field data saved' : 'Hospital saved');
  };

  const sendNotice = () => {
    if (!selected) return;
    if (!fieldForm.hospitalId) {
      sayInDetail('Pick an accepting hospital first.');
      return;
    }
    run(async () => {
      await repo.sendPatientNotice(fieldForm.hospitalId, selected.report_id, count(noticeForm.patients) || 1, noticeForm.condition.trim());
      setNoticeForm({ patients: '1', condition: '' });
    }, 'Patient notice sent to the hospital');
  };

  const submitAfter = () => {
    if (!selected) return;
    const meta: Record<string, unknown> = {
      people_assisted: count(aaForm.people),
      follow_up_needed: aaForm.followUp,
      follow_up_note: aaForm.followUp ? aaForm.followNote.trim() : '',
    };
    if (selected.team === 'BFP') {
      meta.families_displaced = count(aaForm.families);
      meta.people_injured = count(aaForm.injured);
    }
    run(() => repo.submitAfterAction(selected.id, afterAction.trim(), meta), 'After-action submitted');
  };

  // the accepting hospitals, plus the saved one if it has since gone on divert
  const hospitalOptions = (
    <>
      <option value="">{data.acceptingHospitals.length ? 'Select an accepting hospital' : 'No hospital is accepting patients now'}</option>
      {data.acceptingHospitals.map((h) => (
        <option key={h.id} value={h.id}>
          {h.name}
          {h.available != null ? ` (${h.available} available)` : ''}
        </option>
      ))}
      {fieldForm.hospitalId && !data.acceptingHospitals.some((h) => h.id === fieldForm.hospitalId) && (
        <option value={fieldForm.hospitalId}>Saved hospital (not accepting now)</option>
      )}
    </>
  );

  const metaLines = (m: Record<string, unknown>): [string, string][] => {
    const used = Array.isArray(m.equipment_used)
      ? (m.equipment_used as { identifier?: string }[]).map((e) => e?.identifier || '').filter(Boolean).join(', ')
      : '';
    const lines: [string, unknown][] = [
      ['People assisted', m.people_assisted],
      ['Families displaced', m.families_displaced],
      ['People injured', m.people_injured],
      ['Follow-up', m.follow_up_needed ? m.follow_up_note || 'Needed' : null],
      ['Equipment used', used],
    ];
    return lines.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]);
  };

  const details = selected ? (
    <>
      <section className={`${panel} p-5`}>
        <h3 className="text-[15px] font-semibold text-neutral-800 mb-4">Crew on Duty</h3>
        {onDuty.length ? (
          <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x -mx-1 px-1 pb-1">{onDuty.map(crewCard)}</div>
        ) : (
          <p className="text-[12px] text-neutral-400">Nobody is clocked in. Use Roster & Shifts.</p>
        )}
      </section>

      <section className={`${panel} px-5 py-3`}>
        {detailRow('Incident', selected.report?.code || '—')}
        {detailRow('Hazard', selected.report?.hazard_type || '—')}
        {detailRow('Severity', PRIORITY[selected.report?.severity || '']?.label || 'Normal')}
        {detailRow('Barangay', selected.report?.barangay || '—')}
        {detailRow('ETA', selected.eta ? absTime(selected.eta) : '—')}
        {detailRow('Dispatched by', `${selected.dispatched_by_name || '—'} · ${relTime(selected.dispatched_at)}`)}
        {selected.report?.description && <p className="mt-2 text-[13px] text-neutral-600">{selected.report.description}</p>}
        {selected.instructions && <p className="mt-2 mb-1 text-[13px] text-neutral-700 bg-[#FFF4EC] rounded-xl px-3.5 py-2.5 whitespace-pre-wrap">{selected.instructions}</p>}
      </section>

      <section className={`${panel} p-5 flex flex-col`}>
        <h3 className="text-[15px] font-semibold text-neutral-800 mb-4">Status</h3>
        {selected.dispatch_status === 'declined' ? (
          <p className="text-[13px] text-neutral-600 bg-[#F7F4F2] rounded-xl px-3.5 py-2.5 whitespace-pre-wrap">
            <span className="font-semibold text-neutral-700">Declined.</span> {selected.decline_reason}
          </p>
        ) : (
          <div
            className={`grid ${flow.length > 5 ? 'gap-1' : 'gap-1.5'}`}
            style={{ gridTemplateColumns: `repeat(${flow.length}, minmax(0, 1fr))` }}
            aria-label={`Stage: ${STAGE_LABEL[selected.dispatch_status]}`}
          >
            {flow.map((s, i) => (
              <div key={s.id} className="min-w-0" title={STAGE_LABEL[s.id]}>
                <div className={`h-1.5 rounded-full ${i <= stageIndex ? 'bg-gradient-to-r from-[#F07A4A] to-[#E2552B]' : 'bg-[#F3ECE7]'}`} />
                <span
                  className={`block mt-1.5 font-semibold ${flow.length > 5 ? 'text-[9px] leading-tight' : 'text-[10px] truncate'} ${
                    i <= stageIndex ? 'text-[#C2410C]' : 'text-neutral-400'
                  }`}
                >
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        )}
        {selected.dispatch_status === 'on_hold' && selected.hold_reason && (
          <p className="mt-3 text-[12px] text-[#7A3B3B] bg-[#F8ECEC] rounded-xl px-3.5 py-2 whitespace-pre-wrap">On hold: {selected.hold_reason}</p>
        )}

        {steps.length ? (
          <div className="mt-5 space-y-2">
            <input
              className={field}
              value={stepNote}
              onChange={(e) => setStepNote(e.target.value)}
              placeholder={steps.some((s) => s.to === 'on_hold') ? 'Note (required for On hold)' : 'Note (optional)'}
              aria-label="Note for this step"
            />
            <button type="button" onClick={() => respond(steps[0].to)} disabled={busy} className={`${accentBtn} w-full h-12`}>
              {busy ? <BrandLoader mode="inline" portal="dispatch" process="refresh" variant="reverse" /> : steps[0].label}
            </button>
            {steps.slice(1).map((s) => (
              <button key={s.to} type="button" onClick={() => respond(s.to)} disabled={busy} className={`${softBtn} w-full justify-center h-10`}>
                {s.label}
              </button>
            ))}
            <p className="text-[11px] text-neutral-400 text-center">Each step is one tap. The reporter is told from On scene onwards.</p>
          </div>
        ) : (
          selected.dispatch_status === 'done' && <p className="mt-4 text-center text-[12px] text-neutral-400">This dispatch is complete.</p>
        )}

        {selOpen && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(selected.dispatch_status === 'sent' || selected.dispatch_status === 'acknowledged') && (
              <button
                type="button"
                className={softBtn}
                disabled={busy}
                onClick={() => {
                  setDeclineReason('');
                  setDeclineOpen(true);
                }}
              >
                Can’t respond
              </button>
            )}
            <button
              type="button"
              className={softBtn}
              disabled={busy}
              onClick={() => {
                setHelpForm({ kind: 'general', message: '' });
                setHelpOpen(true);
              }}
            >
              Need help
            </button>
            {selected.team === 'BFP' && (
              <>
                <button type="button" className={softBtn} disabled={busy} onClick={() => askHelp('water_tanker', 'Requesting a water tanker on this dispatch.', 'Water tanker request sent to the LGU')}>
                  Water tanker
                </button>
                <button type="button" className={softBtn} disabled={busy} onClick={() => askHelp('extra_personnel', 'Requesting extra personnel on this dispatch.', 'Personnel request sent to the LGU')}>
                  Extra personnel
                </button>
              </>
            )}
          </div>
        )}
        {notice && !noticeMain && <p className="mt-2 text-[12px] text-center text-neutral-500">{notice}</p>}
      </section>

      {helpFor.length > 0 && (
        <section className={`${panel} p-5`}>
          <h3 className="text-[15px] font-semibold text-neutral-800 mb-3">Help requests</h3>
          <ul className="space-y-2.5">
            {helpFor.map((h) => (
              <li key={h.id} className="flex items-start gap-3 text-[12px]">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-neutral-700">{HELP_KIND[h.kind] || pretty(h.kind)}</span>
                  <span className="block text-neutral-500 break-words">{h.message}</span>
                  <span className="block text-neutral-400">{relTime(h.created_at)}</span>
                </span>
                {pill(HELP_PILL[h.status] || 'bg-neutral-200', h.status)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {fieldOpen && isRescue && (
        <section className={`${panel} p-5 space-y-3`}>
          <h3 className="text-[15px] font-semibold text-neutral-800">Rescue details & tally</h3>
          <div className="grid grid-cols-2 gap-2">
            <Label text="Stranded">
              <input type="number" min={0} inputMode="numeric" className={field} value={fieldForm.stranded} onChange={(e) => setFieldForm({ ...fieldForm, stranded: e.target.value })} />
            </Label>
            <Label text="Location">
              <input className={field} value={fieldForm.location} onChange={(e) => setFieldForm({ ...fieldForm, location: e.target.value })} />
            </Label>
          </div>
          <Label text="Special needs">
            <input className={field} value={fieldForm.needs} onChange={(e) => setFieldForm({ ...fieldForm, needs: e.target.value })} placeholder="Elderly, infants, PWD…" />
          </Label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['rescued', 'Rescued'],
                ['injured', 'Injured'],
                ['missing', 'Missing'],
              ] as const
            ).map(([k, l]) => (
              <Label key={k} text={l}>
                <input type="number" min={0} inputMode="numeric" className={field} value={fieldForm[k]} onChange={(e) => setFieldForm({ ...fieldForm, [k]: e.target.value })} />
              </Label>
            ))}
          </div>
          <Label text="Destination hospital">
            <select className={field} value={fieldForm.hospitalId} onChange={(e) => setFieldForm({ ...fieldForm, hospitalId: e.target.value })}>
              {hospitalOptions}
            </select>
          </Label>
          <button type="button" className={`${softBtn} w-full justify-center h-10`} disabled={busy} onClick={saveField}>
            Save field data
          </button>
        </section>
      )}

      {fieldOpen && isAmbulance && (
        <section className={`${panel} p-5 space-y-3`}>
          <h3 className="text-[15px] font-semibold text-neutral-800">Hospital</h3>
          <Label text="Accepting hospital">
            <select className={field} value={fieldForm.hospitalId} onChange={(e) => setFieldForm({ ...fieldForm, hospitalId: e.target.value })}>
              {hospitalOptions}
            </select>
          </Label>
          <p className="text-[11px] text-neutral-400">Required before Transporting. Save it first, then tap Transporting.</p>
          <button type="button" className={`${softBtn} w-full justify-center h-10`} disabled={busy} onClick={saveField}>
            Save hospital
          </button>
        </section>
      )}

      {fieldOpen && (isRescue || isAmbulance) && (
        <section className={`${panel} p-5 space-y-3`}>
          <h3 className="text-[15px] font-semibold text-neutral-800">Send patient notice</h3>
          <p className="text-[11px] text-neutral-400">Tells the hospital picked above that patients are coming.</p>
          <div className="grid grid-cols-[1fr_2fr] gap-2">
            <Label text="Patients">
              <input type="number" min={1} inputMode="numeric" className={field} value={noticeForm.patients} onChange={(e) => setNoticeForm({ ...noticeForm, patients: e.target.value })} />
            </Label>
            <Label text="Condition">
              <input className={field} value={noticeForm.condition} onChange={(e) => setNoticeForm({ ...noticeForm, condition: e.target.value })} placeholder="e.g. Trauma, stable" />
            </Label>
          </div>
          <button type="button" className={`${accentBtn} w-full`} disabled={busy} onClick={sendNotice}>
            <Truck className="w-4 h-4" /> Send notice
          </button>
        </section>
      )}

      {selOpen && isPnpUnit && (
        <section className={`${panel} p-5`}>
          <h3 className="text-[15px] font-semibold text-neutral-800 mb-1">Road closure</h3>
          <p className="text-[11px] text-neutral-400 mb-3">Post a closure from this dispatch to the Road Status list, and reopen it when the road is clear.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`${accentBtn} h-9 px-4`}
              disabled={busy}
              onClick={() => {
                setClosureForm({ roadName: '', note: '', segmentFrom: '', segmentTo: '', reopen: '' });
                setClosureOpen(true);
              }}
            >
              Post closure
            </button>
            <button type="button" className={softBtn} disabled={busy} onClick={() => run(() => repo.reopenRoadClosure(selected.id), 'Road reopened')}>
              Reopen
            </button>
          </div>
        </section>
      )}

      {events.length > 0 && (
        <section className={`${panel} p-5`}>
          <h3 className="text-[15px] font-semibold text-neutral-800 mb-3">Status trail</h3>
          <ol className="space-y-2.5">
            {events.map((e) => (
              <li key={e.id} className="text-[12px]">
                <span className="font-semibold text-neutral-700 capitalize">{ACTION_LABEL[e.action] || pretty(e.action)}</span>
                <span className="text-neutral-400"> · {e.actor_name || 'System'} · {absTime(e.created_at)}</span>
                {e.note && <span className="block text-neutral-500">{e.note}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {selected.dispatch_status === 'done' && (
        <section className={`${panel} p-5`}>
          <h3 className="text-[15px] font-semibold text-neutral-800 mb-2">After-action report</h3>
          {selected.after_action ? (
            <>
              <p className="text-[13px] text-neutral-600 bg-[#F7F4F2] rounded-xl px-3.5 py-2.5 whitespace-pre-wrap">{selected.after_action}</p>
              {metaLines(selected.after_action_meta).length > 0 && (
                <dl className="mt-2 space-y-1 text-[12px]">
                  {metaLines(selected.after_action_meta).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3">
                      <dt className="text-neutral-500 shrink-0">{k}</dt>
                      <dd className="text-neutral-700 text-right break-words min-w-0">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {selected.after_action_at && <p className="mt-1.5 text-[11px] text-neutral-400">Filed {relTime(selected.after_action_at)}</p>}
            </>
          ) : (
            <div className="space-y-2">
              <textarea
                rows={4}
                value={afterAction}
                onChange={(e) => setAfterAction(e.target.value)}
                aria-label="After-action summary"
                placeholder="What was done, time spent, equipment used, casualties or patients, outcome"
                className="w-full rounded-xl bg-[#F7F4F2] border border-transparent px-3.5 py-2.5 text-[13px] resize-none focus:outline-none focus:bg-white focus:border-[#F07A4A]"
              />
              <div className="grid grid-cols-2 gap-2">
                <Label text="People assisted">
                  <input type="number" min={0} inputMode="numeric" className={field} value={aaForm.people} onChange={(e) => setAaForm({ ...aaForm, people: e.target.value })} />
                </Label>
                <Label text="Follow-up needed">
                  <select className={field} value={aaForm.followUp ? 'yes' : 'no'} onChange={(e) => setAaForm({ ...aaForm, followUp: e.target.value === 'yes' })}>
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </Label>
              </div>
              {aaForm.followUp && (
                <Label text="Follow-up note">
                  <input className={field} value={aaForm.followNote} onChange={(e) => setAaForm({ ...aaForm, followNote: e.target.value })} placeholder="What needs following up?" />
                </Label>
              )}
              {selected.team === 'BFP' && (
                <div className="grid grid-cols-2 gap-2">
                  <Label text="Families displaced">
                    <input type="number" min={0} inputMode="numeric" className={field} value={aaForm.families} onChange={(e) => setAaForm({ ...aaForm, families: e.target.value })} />
                  </Label>
                  <Label text="People injured">
                    <input type="number" min={0} inputMode="numeric" className={field} value={aaForm.injured} onChange={(e) => setAaForm({ ...aaForm, injured: e.target.value })} />
                  </Label>
                </div>
              )}
              <p className="text-[11px] text-neutral-400">Equipment used and the step times are added for you.</p>
              <button type="button" disabled={busy || !afterAction.trim()} onClick={submitAfter} className={`${accentBtn} w-full`}>
                Submit after-action
              </button>
            </div>
          )}
        </section>
      )}
    </>
  ) : (
    <section className={`${panel} p-6 text-center text-[13px] text-neutral-400`}>
      No dispatches yet. When the LGU or a barangay official dispatches your unit, it lands here.
    </section>
  );

  /* ------------------------------------------------------------ views */

  const heading = (title: string, sub?: string, right?: React.ReactNode) => (
    <div className="flex flex-wrap items-end justify-between gap-3 mt-7 mb-3">
      <div>
        <h2 className="text-[22px] font-semibold text-neutral-700">{title}</h2>
        {sub && <p className="text-[12px] text-neutral-400 mt-0.5">{sub}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
  const chip = (text: string, warn = false) => (
    <span className={`h-7 px-3 rounded-full text-[11px] font-bold inline-flex items-center ${warn ? 'bg-[#FDF0DC] text-[#8A5A12]' : 'bg-white text-[#C2410C]'}`}>{text}</span>
  );
  const empty = (text: string) => <p className="text-[13px] text-neutral-400 py-8 text-center">{text}</p>;

  const queueView = (
    <>
      {heading('Incoming Dispatches', 'Open dispatches addressed to your unit.', chip(`${activeCount} active`))}
      {isPnpUnit && (data.patrolShelters.length > 0 || data.reliefEscorts.length > 0) && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mb-4">
          {data.patrolShelters.length > 0 && (
            <section className={`${panel} p-5`}>
              <h3 className="text-[15px] font-semibold text-neutral-800 mb-3">Shelters needing patrol</h3>
              <ul className="space-y-2">
                {data.patrolShelters.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="min-w-0 truncate">
                      <span className="font-semibold text-neutral-700">{s.name}</span>
                      <span className="text-neutral-400"> · {s.barangay || '—'}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-neutral-400">{s.needs_patrol_at ? absTime(s.needs_patrol_at) : ''}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {data.reliefEscorts.length > 0 && (
            <section className={`${panel} p-5`}>
              <h3 className="text-[15px] font-semibold text-neutral-800 mb-3">Relief escorts</h3>
              <ul className="space-y-2.5">
                {data.reliefEscorts.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-neutral-700 truncate">{r.title || 'Relief distribution'}</span>
                      <span className="block text-[11px] text-neutral-400 break-words">{[r.barangay, r.escort_note].filter(Boolean).join(' · ')}</span>
                    </span>
                    {pill(r.escort_status === 'confirmed' ? 'bg-[#73B386] text-white' : 'bg-[#E9B872] text-white', r.escort_status)}
                    {r.escort_status === 'requested' && (
                      <button type="button" disabled={busy} className={`${accentBtn} h-9 px-4`} onClick={() => run(() => repo.confirmReliefEscort(r.id), 'Escort confirmed', true)}>
                        Confirm escort
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      <div className="hidden md:grid grid-cols-[1.2fr_1.2fr_1fr_1.1fr_auto_24px] gap-x-4 px-5 pb-2 text-[12px] font-medium text-neutral-500">
        <span>Incident</span>
        <span>Hazard / Severity</span>
        <span>ETA / Team</span>
        <span>Barangay</span>
        <span className="min-w-[88px] text-center">Status</span>
        <span />
      </div>
      <div className="space-y-3 pb-6">
        {items.length ? items.map(row) : empty(q ? 'No dispatches match.' : 'No dispatches yet. When the LGU or a barangay official dispatches your unit, it lands here.')}
      </div>
    </>
  );

  const equipmentView = (
    <div className="pb-6">
      {heading(
        'Equipment & Readiness',
        'Track each piece and run the shift checklist.',
        <>
          {chip(`${data.equipment.length} items`)}
          {overdueCount > 0 && chip(`${overdueCount} overdue`, true)}
          {isUnitAdmin && (
            <button
              type="button"
              className={`${accentBtn} h-9 px-4`}
              onClick={() => {
                setEquipForm({ catalogId: data.equipmentCatalog[0]?.id || '', customLabel: '', identifier: '', condition: 'unknown', notes: '' });
                setAddEquipOpen(true);
              }}
            >
              <Plus className="w-4 h-4" /> Add equipment
            </button>
          )}
        </>
      )}
      <div className="space-y-3">
        {data.equipment.map((e) => (
          <div key={e.id} className={`${card} ${overdue(e) ? 'border-l-4 border-[#E9B872]' : ''}`}>
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-[#FFF1EA] text-[#E2552B] flex items-center justify-center shrink-0">
                <Wrench className="w-5 h-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-neutral-800 truncate">{e.identifier || equipLabel(e)}</span>
                <span className="block text-[12px] text-neutral-400 truncate">
                  {[e.identifier ? equipLabel(e) : '', e.notes, `last check ${e.last_checked_at ? relTime(e.last_checked_at) : 'never'}`].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="hidden sm:inline-flex gap-1.5">
                {pill(EQUIP_PILL[e.status] || 'bg-neutral-200', e.status)}
                {e.condition && pill(COND_PILL[e.condition] || COND_PILL.unknown, pretty(e.condition))}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="sm:hidden inline-flex gap-1.5">
                {pill(EQUIP_PILL[e.status] || 'bg-neutral-200', e.status)}
                {e.condition && pill(COND_PILL[e.condition] || COND_PILL.unknown, pretty(e.condition))}
              </span>
              <button
                type="button"
                className={softBtn}
                onClick={() => {
                  setCheckFor(e);
                  setCheckForm({ condition: 'ready', level: '', notes: '' });
                }}
              >
                Check
              </button>
              <button
                type="button"
                className={softBtn}
                onClick={() => {
                  setStatusFor(e);
                  setStatusForm({ status: e.status, notes: e.notes || '' });
                }}
              >
                Status
              </button>
              {isUnitAdmin && (
                <>
                  <button
                    type="button"
                    className={softBtn}
                    onClick={() => {
                      setEditEquip(e);
                      setEditForm({ customLabel: e.label, identifier: e.identifier, condition: e.condition || 'unknown', notes: e.notes });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={softBtn}
                    onClick={() => {
                      setRemoveEquip(e);
                      setUseCount(null);
                      if (e.status !== 'deployed') repo.equipmentUseCount(e.id).then(setUseCount, () => setUseCount(-1));
                    }}
                  >
                    {e.status === 'unavailable' ? 'Remove' : 'Retire / remove'}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
        {!data.equipment.length && empty(isUnitAdmin ? 'No equipment yet. Use Add equipment to register your unit’s equipment.' : 'No equipment yet. Your unit admin adds equipment here.')}
      </div>
    </div>
  );

  const rosterView = (
    <div className="pb-6">
      {heading(
        'Roster & Shifts',
        'Who is on duty, shift times, roles.',
        <>
          {chip(`${crewOnDuty} on duty`)}
          {isUnitAdmin && (
            <button type="button" onClick={() => setInviteOpen(true)} className={`${accentBtn} h-9 px-4`}>
              <UserPlus className="w-4 h-4" /> Invite member
            </button>
          )}
        </>
      )}
      <div className="space-y-3">
        {data.personnel.map((p) => (
          <div key={p.id} className={`${card} flex flex-wrap sm:flex-nowrap items-center gap-3`}>
            <span className="w-10 h-10 rounded-xl bg-[#FFF1EA] text-[#E2552B] font-bold flex items-center justify-center shrink-0">{p.name.charAt(0).toUpperCase()}</span>
            {/* on phones the name keeps its own line; the controls wrap below */}
            <span className="min-w-0 flex-1 basis-[calc(100%-52px)] sm:basis-auto">
              <span className="block text-[14px] font-semibold text-neutral-800 truncate">{p.name}</span>
              <span className="block text-[12px] text-neutral-400 truncate">
                {[p.role || 'Crew', p.phone, p.on_duty && p.shift_start ? `since ${absTime(p.shift_start)}` : ''].filter(Boolean).join(' · ')}
              </span>
            </span>
            {pill(p.on_duty ? 'bg-[#73B386] text-white' : 'bg-[#F3EFEC] text-neutral-500', p.on_duty ? 'On duty' : 'Off duty')}
            {p.phone && (
              <a href={telHref(p.phone)} aria-label={`Call ${p.name}`} className="w-9 h-9 rounded-full bg-[#F7F4F2] text-neutral-600 flex items-center justify-center shrink-0">
                <Phone className="w-4 h-4" />
              </a>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => repo.clockPersonnel(p.id, !p.on_duty), p.on_duty ? `${p.name} clocked out` : `${p.name} clocked in`)}
              className={`shrink-0 h-9 px-4 rounded-full text-[12px] font-semibold cursor-pointer ${p.on_duty ? 'bg-[#F7F4F2] text-neutral-600' : 'bg-gradient-to-r from-[#F07A4A] to-[#E2552B] text-white'}`}
            >
              {p.on_duty ? 'Clock out' : 'Clock in'}
            </button>
          </div>
        ))}
        {!data.personnel.length && empty(isUnitAdmin ? 'No personnel yet. Add your crew below, or invite members by email.' : 'No personnel yet. Ask your unit admin to add the crew.')}
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

  const cap = data.capacity || { er_beds: 0, icu_beds: 0, available: 0, accepting: true, updated_at: null };
  const readout = (value: React.ReactNode, label: string, tone = 'text-neutral-800') => (
    <div key={label} className="min-w-0">
      <p className="text-[11px] sm:text-[12px] text-neutral-400 truncate">{label}</p>
      <p className={`text-[22px] sm:text-[26px] font-semibold mt-1 tabular-nums ${tone}`}>{value}</p>
    </div>
  );
  const readouts = (cells: React.ReactNode[]) => (
    <div className="bg-white rounded-2xl px-5 py-5 grid grid-cols-2 sm:grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-4 shadow-[0_6px_24px_-14px_rgba(120,60,30,0.35)]">{cells}</div>
  );

  const hospitalView = (
    <div className="pb-6">
      {heading(
        'Hospital Capacity',
        'ER / ICU beds, accepting / divert, incoming-patient notices.',
        <button
          type="button"
          className={`${accentBtn} h-9 px-4`}
          onClick={() => {
            setCapForm({ er_beds: cap.er_beds, icu_beds: cap.icu_beds, available: cap.available, accepting: cap.accepting });
            setCapOpen(true);
          }}
        >
          Update
        </button>
      )}
      {readouts([
        readout(cap.er_beds, 'ER beds', 'text-[#C2410C]'),
        readout(cap.icu_beds, 'ICU beds', 'text-[#C2410C]'),
        readout(cap.available, 'Available', 'text-[#2F6B3F]'),
        readout(cap.accepting ? 'Accepting' : 'Divert', 'Status', cap.accepting ? 'text-[#2F6B3F]' : 'text-[#9B2C2C]'),
      ])}
      {cap.updated_at && <p className="mt-2 text-[11px] text-neutral-400">Last updated {relTime(cap.updated_at)}</p>}
      <h3 className="mt-6 mb-3 text-[15px] font-semibold text-neutral-700">Incoming-patient notices</h3>
      <div className="space-y-3">
        {data.patientNotices.map((n) => (
          <div key={n.id} className={`${card} flex flex-wrap items-center gap-3`}>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-neutral-800">
                {n.patients} {n.patients === 1 ? 'patient' : 'patients'}
                {n.condition ? ` · ${n.condition}` : ''}
              </span>
              <span className="block text-[12px] text-neutral-400">
                {absTime(n.created_at)}
                {n.eta ? ` · ETA ${absTime(n.eta)}` : ''}
              </span>
            </span>
            {pill(NOTICE_PILL[n.status] || 'bg-[#F3EFEC] text-neutral-500', pretty(n.status))}
            {(n.status === 'sent' || n.status === 'acknowledged') && (
              // on phones the buttons take their own line so the notice text keeps its width
              <span className="w-full sm:w-auto flex flex-wrap gap-2">
                {n.status === 'sent' && (
                  <button type="button" disabled={busy} onClick={() => run(() => repo.ackPatientNotice(n.id, 'acknowledged'), 'Notice acknowledged')} className={`${accentBtn} h-9 px-4`}>
                    Acknowledge
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => run(() => repo.ackPatientNotice(n.id, 'arrived'), 'Patient marked arrived')} className={softBtn}>
                  Arrived
                </button>
                <button type="button" disabled={busy} onClick={() => run(() => repo.ackPatientNotice(n.id, 'cancelled'), 'Notice cancelled')} className={softBtn}>
                  Cancel
                </button>
              </span>
            )}
          </div>
        ))}
        {!data.patientNotices.length && empty('No incoming-patient notices.')}
      </div>
    </div>
  );

  const openRequests = data.unitRequests.filter((r) => r.status === 'pending' || r.status === 'approved').length;
  const requestsView = (
    <div className="pb-6">
      {heading(
        'Support Requests',
        'Ask the LGU for fuel, extra personnel, equipment or mutual aid.',
        <>
          {openRequests > 0 && chip(`${openRequests} open`)}
          <button
            type="button"
            className={`${accentBtn} h-9 px-4`}
            onClick={() => {
              setReqForm({ kind: 'fuel', details: '' });
              setRequestOpen(true);
            }}
          >
            <Plus className="w-4 h-4" /> New request
          </button>
        </>
      )}
      <div className="space-y-3">
        {data.unitRequests.map((r) => (
          <div key={r.id} className={`${card} flex flex-wrap sm:flex-nowrap items-center gap-3`}>
            <span className="min-w-0 flex-1 basis-full sm:basis-auto">
              <span className="block text-[14px] font-semibold text-neutral-800 truncate">{KIND_LABEL[r.kind] || r.kind}</span>
              <span className="block text-[12px] text-neutral-400 break-words">
                {r.details} · {absTime(r.created_at)}
                {r.decided_at ? ` · decided ${relTime(r.decided_at)}` : ''}
              </span>
            </span>
            {pill(
              r.status === 'approved' || r.status === 'done' ? 'bg-[#73B386] text-white' : r.status === 'declined' ? 'bg-[#D9534F] text-white' : 'bg-[#E9B872] text-white',
              r.status
            )}
            {/* the unit admin closes an approved request once it was delivered */}
            {isUnitAdmin && r.status === 'approved' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => repo.decideUnitRequest(r.id, 'done'), 'Request marked done')}
                className="shrink-0 h-9 px-4 rounded-full text-[12px] font-semibold bg-[#F7F4F2] text-neutral-700 cursor-pointer disabled:opacity-50"
              >
                Mark done
              </button>
            )}
          </div>
        ))}
        {!data.unitRequests.length && empty('No requests yet.')}
      </div>
    </div>
  );

  // unit analytics: response times and counts from this unit's dispatches
  const stats = useMemo(() => {
    const ds = data.dispatches;
    const mins = (a: string | null, b: string | null) => (a && b ? (Date.parse(b) - Date.parse(a)) / 60000 : null);
    const avg = (vals: (number | null)[]) => {
      const v = vals.filter((x): x is number => x != null && x >= 0);
      return v.length ? (v.reduce((s, x) => s + x, 0) / v.length).toFixed(1) : '—';
    };
    const nowD = new Date();
    return {
      total: ds.length,
      month: ds.filter((d) => {
        const t = new Date(d.dispatched_at);
        return t.getMonth() === nowD.getMonth() && t.getFullYear() === nowD.getFullYear();
      }).length,
      avgAck: avg(ds.map((d) => mins(d.dispatched_at, d.ack_at))),
      avgScene: avg(ds.map((d) => mins(d.ack_at, d.on_scene_at))),
      done: ds.filter((d) => d.dispatch_status === 'done').length,
    };
  }, [data.dispatches]);

  const exportCsv = () => {
    if (!data.dispatches.length) {
      setNotice('No data to export');
      return;
    }
    download(
      `dispatch-stats-${new Date().toISOString().slice(0, 10)}.csv`,
      toCSV(
        data.dispatches.map((d) => ({
          dispatched_at: d.dispatched_at,
          ack_at: d.ack_at || '',
          on_scene_at: d.on_scene_at || '',
          done_at: d.done_at || '',
          dispatch_status: d.dispatch_status,
          team: d.team,
          instructions: d.instructions,
          report_code: d.report?.code || '',
          report_barangay: d.report?.barangay || '',
        }))
      )
    );
  };

  const analyticsView = (
    <div className="pb-6">
      {heading(
        'Unit Analytics',
        'Response time, monthly count, completed dispatches.',
        <button type="button" onClick={exportCsv} className={softBtn}>
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      )}
      {data.dispatches.length ? (
        <>
          {readouts([
            readout(stats.total, 'Total dispatches', 'text-[#C2410C]'),
            readout(stats.month, 'This month', 'text-[#C2410C]'),
            readout(`${stats.avgAck} min`, 'Avg to acknowledge', 'text-[#2F6B3F]'),
            readout(`${stats.avgScene} min`, 'Avg to scene', 'text-[#2F6B3F]'),
            readout(stats.done, 'Completed', 'text-[#2F6B3F]'),
          ])}
          <div className="mt-4 space-y-3">
            {data.dispatches.slice(0, 30).map((d) => (
              <div key={d.id} className={`${card} grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_1fr_auto_auto] items-center gap-x-4 gap-y-1`}>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-neutral-800 truncate">{d.report?.code || 'Dispatch'}</span>
                  <span className="block text-[11px] text-neutral-400 truncate">{absTime(d.dispatched_at)}</span>
                </span>
                <span className="hidden sm:block text-[13px] text-neutral-500 truncate">{d.report?.barangay || '—'}</span>
                <span className="hidden sm:block text-[11px] text-neutral-400 text-right">
                  ack {d.ack_at ? relTime(d.ack_at) : '—'}
                  <br />
                  scene {d.on_scene_at ? relTime(d.on_scene_at) : '—'}
                </span>
                {stagePill(d.dispatch_status)}
              </div>
            ))}
          </div>
        </>
      ) : (
        empty('Your response time and monthly count appear here once you have a dispatch.')
      )}
    </div>
  );

  const hotlines = data.hotlines.filter((h) => h.active);
  const contactRow = (key: string, name: string, sub: string, number: string) => (
    <div key={key} className={`${card} flex items-center gap-3`}>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-neutral-800 truncate">{name}</span>
        <span className="block text-[12px] text-neutral-400 truncate">
          {sub} · {number}
        </span>
      </span>
      <a href={telHref(number)} className={`${accentBtn} h-9 px-4`}>
        <Phone className="w-4 h-4" /> Call
      </a>
    </div>
  );
  const contactsView = (
    <div className="pb-6">
      {heading('Directory', 'BFP, PNP, rescue units, hospitals and barangay captains. Tap to call.')}
      <div className="space-y-3">
        {hotlines.map((h) => contactRow(h.id, h.agency_name, h.category || h.scope || 'Hotline', h.contact_number))}
        {!hotlines.length && empty('No hotlines listed yet.')}
      </div>
      {data.captains.length > 0 && (
        <>
          <h3 className="mt-6 mb-3 text-[15px] font-semibold text-neutral-700">Barangay captains</h3>
          <div className="space-y-3">{data.captains.map((c) => contactRow(c.barangay, c.captain_name || '(unassigned)', `Brgy Captain · ${c.barangay}`, c.captain_phone))}</div>
        </>
      )}
    </div>
  );

  const notificationsView = (
    <div className="pb-6">
      {heading(
        'Notifications',
        'Every alert delivered to this unit.',
        unread > 0 && (
          <button type="button" onClick={() => run(() => repo.markAllRead(), 'All marked read')} className={softBtn}>
            Mark all read
          </button>
        )
      )}
      <div className="space-y-3">
        {data.notifications.map((n) => (
          <div key={n.id} className={`${card} flex items-start gap-3 ${n.unread ? 'border-l-4 border-[#F07A4A]' : ''}`}>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-neutral-800">{n.title}</span>
              {n.body && <span className="block text-[12px] text-neutral-500 mt-0.5">{n.body}</span>}
              <span className="block text-[11px] text-neutral-400 mt-1">{absTime(n.created_at)}</span>
            </span>
            {n.unread ? (
              <button type="button" onClick={() => run(() => repo.markRead(n.id), 'Marked read')} className={softBtn}>
                Mark read
              </button>
            ) : (
              pill('bg-[#F3EFEC] text-neutral-500', 'Read')
            )}
          </div>
        ))}
        {!data.notifications.length && empty('No notifications yet. Alerts delivered to this unit appear here.')}
      </div>
    </div>
  );

  const hasDetails = view === 'queue';
  const currentView =
    view === 'queue'
      ? queueView
      : view === 'equipment'
      ? equipmentView
      : view === 'roster'
      ? rosterView
      : view === 'hospital'
      ? hospitalView
      : view === 'requests'
      ? requestsView
      : view === 'analytics'
      ? analyticsView
      : view === 'contacts'
      ? contactsView
      : notificationsView;

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
            <button
              type="button"
              onClick={() => setView('queue')}
              aria-label="Go to incoming dispatches"
              title="Incoming Dispatches"
              className="h-[84px] flex items-center justify-center cursor-pointer"
            >
              <TriadEmblem portal="dispatch" size={34} />
            </button>
            <nav aria-label="Dispatch sections" className="flex-1 flex flex-col items-center gap-2 pt-6 pb-5 rounded-tr-[56px] bg-gradient-to-b from-[#F07A4A] via-[#E2552B] to-[#C2410C] overflow-y-auto no-scrollbar">
              <span
                role="img"
                aria-label={`Signed in: ${identity}`}
                title={identity}
                className="w-12 h-12 shrink-0 rounded-full bg-white/20 ring-2 ring-white/70 flex items-center justify-center text-white font-black text-lg mb-4"
              >
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
                    className={`relative shrink-0 w-12 h-12 rounded-xl flex items-center justify-center cursor-pointer transition-colors ${
                      active ? 'bg-white/20 text-white' : 'text-white/75 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <Icon className="w-[22px] h-[22px]" strokeWidth={1.8} />
                    {item.dot && <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-white" aria-hidden="true" />}
                    {active && <span className="absolute -right-[22px] top-2.5 bottom-2.5 w-[3px] rounded-full bg-white" />}
                  </button>
                );
              })}
              <button type="button" onClick={() => run(refresh, 'Refreshed')} aria-label="Refresh" title="Refresh" className="mt-auto shrink-0 w-11 h-11 rounded-xl text-white/80 hover:text-white hover:bg-white/10 flex items-center justify-center cursor-pointer">
                <RefreshCw className="w-5 h-5" />
              </button>
              <button type="button" onClick={onSignOut} aria-label="Sign out" title="Sign out" className="shrink-0 w-11 h-11 rounded-xl bg-white/20 text-white flex items-center justify-center cursor-pointer hover:bg-white/30">
                <LogOut className="w-5 h-5" />
              </button>
              <span className="shrink-0 max-w-[84px] truncate font-mono text-[9px] text-white/60" title={`build ${CONFIG.BUILD}`}>
                {CONFIG.BUILD}
              </span>
            </nav>
          </aside>

          {/* ---------------- middle column */}
          <main className="flex-1 min-w-0 flex flex-col">
            {/* phone header */}
            <div className="md:hidden flex items-center gap-2.5 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-2">
              <TriadEmblem portal="dispatch" size={28} />
              <span className="min-w-0 text-[15px] font-extrabold text-neutral-800 truncate">{unit?.name || 'Dispatch'}</span>
              <span className="ml-auto text-[12px] font-semibold text-neutral-500">{clock}</span>
              <button type="button" onClick={() => setView('notifications')} aria-label="Notifications" className="relative w-9 h-9 shrink-0 rounded-full bg-white text-[#C2410C] flex items-center justify-center shadow-sm cursor-pointer">
                <Bell className="w-4 h-4" />
                {unread > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#E2552B]" aria-hidden="true" />}
              </button>
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
                    onChange={(e) => {
                      setQuery(e.target.value);
                      if (view !== 'queue') setView('queue');
                    }}
                    placeholder="Search dispatches: incident, hazard or barangay"
                    aria-label="Search dispatches"
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

              {/* unit summary + the newest dispatch waiting for acknowledgement */}
              <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_minmax(0,240px)] gap-4">
                <div className="bg-white rounded-2xl px-5 py-5 grid grid-cols-3 divide-x divide-neutral-100 shadow-[0_6px_24px_-14px_rgba(120,60,30,0.35)]">
                  {[
                    { label: 'Active dispatches', value: activeCount, sub: unit ? `${unit.name} · ${UNIT_TYPE_LABEL[unit.unit_type] || unit.unit_type}` : '' },
                    { label: 'On duty', value: crewOnDuty, sub: `of ${data.personnel.length} crew` },
                    { label: 'Checks overdue', value: overdueCount, sub: `of ${data.equipment.length} items` },
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
                    {newest ? <AlertTriangle className="w-4 h-4" /> : <ChevronRight className="w-4 h-4 opacity-80" />}
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
                    {item.dot ? ' •' : ''}
                  </button>
                ))}
              </div>

              {/* with the detail panel open, its own status box shows the message */}
              {notice && (!hasDetails || !sheetOpen || noticeMain) && (
                <p className={`mt-4 text-[12px] text-[#9A3412] bg-[#FFF4EC] rounded-xl px-4 py-2 ${hasDetails && selected && !noticeMain ? 'lg:hidden' : ''}`}>{notice}</p>
              )}

              {currentView}
            </div>
          </main>

          {/* ---------------- right panel (desktop) */}
          {hasDetails && (
            <aside aria-label="Dispatch detail" className="hidden lg:flex w-[340px] shrink-0 flex-col gap-3 p-3 bg-[#F7F1EE] overflow-y-auto">
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
            aria-label="Dispatch detail"
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

      {/* ---------------- pop-ups (reference build) */}
      {checkFor && (
        <Modal
          title={`Readiness check · ${checkFor.identifier || equipLabel(checkFor)}`}
          onClose={() => setCheckFor(null)}
          footer={
            <>
              <button type="button" className={softBtn} onClick={() => setCheckFor(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                className={accentBtn}
                onClick={async () => {
                  if (await run(() => repo.equipmentCheck(checkFor.id, checkForm.condition, checkForm.level.trim(), checkForm.notes.trim()), 'Check recorded')) setCheckFor(null);
                }}
              >
                Save check
              </button>
            </>
          }
        >
          <Label text="Condition">
            <select className={field} value={checkForm.condition} onChange={(e) => setCheckForm({ ...checkForm, condition: e.target.value })}>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {pretty(c)}
                </option>
              ))}
            </select>
          </Label>
          <Label text="Level (fuel, pressure…)">
            <input className={field} value={checkForm.level} onChange={(e) => setCheckForm({ ...checkForm, level: e.target.value })} placeholder="e.g. 80% or 200 bar" />
          </Label>
          <Label text="Notes">
            <textarea rows={2} className={`${field} h-auto py-2.5`} value={checkForm.notes} onChange={(e) => setCheckForm({ ...checkForm, notes: e.target.value })} />
          </Label>
        </Modal>
      )}

      {statusFor && (
        <Modal
          title={`Set status · ${statusFor.identifier || equipLabel(statusFor)}`}
          onClose={() => setStatusFor(null)}
          footer={
            <>
              <button type="button" className={softBtn} onClick={() => setStatusFor(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                className={accentBtn}
                onClick={async () => {
                  if (await run(() => repo.equipmentStatus(statusFor.id, statusForm.status, statusForm.notes.trim()), 'Status saved')) setStatusFor(null);
                }}
              >
                Save
              </button>
            </>
          }
        >
          <Label text="Status">
            <select className={field} value={statusForm.status} onChange={(e) => setStatusForm({ ...statusForm, status: e.target.value as UnitEquipment['status'] })}>
              {EQUIP_STATUS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Label>
          <Label text="Notes">
            <textarea rows={2} className={`${field} h-auto py-2.5`} value={statusForm.notes} onChange={(e) => setStatusForm({ ...statusForm, notes: e.target.value })} />
          </Label>
        </Modal>
      )}

      {requestOpen && (
        <Modal
          title="New support request"
          onClose={() => setRequestOpen(false)}
          footer={
            <>
              <button type="button" className={softBtn} onClick={() => setRequestOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !reqForm.details.trim()}
                className={accentBtn}
                onClick={async () => {
                  if (await run(() => repo.createUnitRequest(reqForm.kind, reqForm.details.trim()), 'Request sent to the LGU')) setRequestOpen(false);
                }}
              >
                Send
              </button>
            </>
          }
        >
          <Label text="Kind">
            <select className={field} value={reqForm.kind} onChange={(e) => setReqForm({ ...reqForm, kind: e.target.value })}>
              {Object.entries(KIND_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Label>
          <Label text="Details">
            <textarea rows={3} className={`${field} h-auto py-2.5`} value={reqForm.details} onChange={(e) => setReqForm({ ...reqForm, details: e.target.value })} placeholder="What do you need?" />
          </Label>
        </Modal>
      )}

      {capOpen && (
        <Modal
          title="Update hospital capacity"
          onClose={() => setCapOpen(false)}
          footer={
            <>
              <button type="button" className={softBtn} onClick={() => setCapOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                className={accentBtn}
                onClick={async () => {
                  if (await run(() => repo.setHospitalCapacity({ ...capForm, updated_at: null }), 'Capacity updated')) setCapOpen(false);
                }}
              >
                Save
              </button>
            </>
          }
        >
          {(
            [
              ['er_beds', 'ER beds'],
              ['icu_beds', 'ICU beds'],
              ['available', 'Available'],
            ] as const
          ).map(([k, l]) => (
            <Label key={k} text={l}>
              <input type="number" min={0} className={field} value={capForm[k]} onChange={(e) => setCapForm({ ...capForm, [k]: Math.max(0, Number(e.target.value) || 0) })} />
            </Label>
          ))}
          <Label text="Accepting patients">
            <select className={field} value={capForm.accepting ? 'true' : 'false'} onChange={(e) => setCapForm({ ...capForm, accepting: e.target.value === 'true' })}>
              <option value="true">Accepting</option>
              <option value="false">Divert</option>
            </select>
          </Label>
        </Modal>
      )}

      {addEquipOpen && (
        <Modal
          title={`Add equipment${unit ? ` · ${unit.name}` : ''}`}
          onClose={() => setAddEquipOpen(false)}
          footer={
            <>
              <button type="button" className={softBtn} onClick={() => setAddEquipOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || (!equipForm.catalogId && !equipForm.customLabel.trim())}
                className={accentBtn}
                onClick={async () => {
                  if (
                    await run(
                      () =>
                        repo.addEquipment({
                          catalogId: equipForm.catalogId || null,
                          customLabel: equipForm.customLabel,
                          identifier: equipForm.identifier,
                          condition: equipForm.condition,
                          notes: equipForm.notes,
                        }),
                      'Equipment added'
                    )
                  )
                    setAddEquipOpen(false);
                }}
              >
                Add
              </button>
            </>
          }
        >
          <Label text="Type">
            <select className={field} value={equipForm.catalogId} onChange={(e) => setEquipForm({ ...equipForm, catalogId: e.target.value })}>
              {data.equipmentCatalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
              <option value="">Other (custom)</option>
            </select>
          </Label>
          {!equipForm.catalogId && (
            <Label text="Custom label">
              <input className={field} value={equipForm.customLabel} onChange={(e) => setEquipForm({ ...equipForm, customLabel: e.target.value })} placeholder="e.g. Portable pump" />
            </Label>
          )}
          <Label text="Identifier (plate, tag or unit number)">
            <input className={field} value={equipForm.identifier} onChange={(e) => setEquipForm({ ...equipForm, identifier: e.target.value })} placeholder="e.g. Fire Truck #2" />
          </Label>
          <Label text="Starting condition">
            <select className={field} value={equipForm.condition} onChange={(e) => setEquipForm({ ...equipForm, condition: e.target.value })}>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {pretty(c)}
                </option>
              ))}
            </select>
          </Label>
          <Label text="Notes">
            <textarea rows={2} className={`${field} h-auto py-2.5`} value={equipForm.notes} onChange={(e) => setEquipForm({ ...equipForm, notes: e.target.value })} placeholder="Anything the next shift should know" />
          </Label>
        </Modal>
      )}

      {editEquip && (
        <Modal
          title={`Edit · ${editEquip.identifier || equipLabel(editEquip)}`}
          onClose={() => setEditEquip(null)}
          footer={
            <>
              <button type="button" className={softBtn} onClick={() => setEditEquip(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                className={accentBtn}
                onClick={async () => {
                  const ok = await run(
                    () =>
                      repo.updateEquipment(editEquip.id, {
                        customLabel: editEquip.catalog_id ? null : editForm.customLabel,
                        identifier: editForm.identifier,
                        condition: editForm.condition,
                        notes: editForm.notes,
                      }),
                    'Equipment updated'
                  );
                  if (ok) setEditEquip(null);
                }}
              >
                Save
              </button>
            </>
          }
        >
          <Label text="Type">
            <input className={field} value={equipLabel(editEquip)} disabled readOnly />
          </Label>
          {!editEquip.catalog_id && (
            <Label text="Custom label">
              <input className={field} value={editForm.customLabel} onChange={(e) => setEditForm({ ...editForm, customLabel: e.target.value })} />
            </Label>
          )}
          <Label text="Identifier">
            <input className={field} value={editForm.identifier} onChange={(e) => setEditForm({ ...editForm, identifier: e.target.value })} />
          </Label>
          <Label text="Condition">
            <select className={field} value={editForm.condition} onChange={(e) => setEditForm({ ...editForm, condition: e.target.value })}>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {pretty(c)}
                </option>
              ))}
            </select>
          </Label>
          <Label text="Notes">
            <textarea rows={2} className={`${field} h-auto py-2.5`} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
          </Label>
          <p className="text-[11px] text-neutral-400">The owner and type cannot be changed. Retire it and add a new one instead.</p>
        </Modal>
      )}

      {removeEquip && (
        <Modal
          title={`${removeEquip.status === 'deployed' ? 'Cannot remove' : 'Retire or remove'} · ${removeEquip.identifier || equipLabel(removeEquip)}`}
          onClose={() => setRemoveEquip(null)}
          footer={
            removeEquip.status === 'deployed' ? (
              <button type="button" className={softBtn} onClick={() => setRemoveEquip(null)}>
                Close
              </button>
            ) : (
              <>
                <button type="button" className={softBtn} onClick={() => setRemoveEquip(null)}>
                  Cancel
                </button>
                {useCount !== null && removeEquip.status !== 'unavailable' && (
                  <button
                    type="button"
                    disabled={busy}
                    className={softBtn}
                    onClick={async () => {
                      if (await run(() => repo.removeEquipment(removeEquip.id, true), 'Equipment retired')) setRemoveEquip(null);
                    }}
                  >
                    Retire
                  </button>
                )}
                {useCount === 0 && (
                  <button
                    type="button"
                    disabled={busy}
                    className={accentBtn}
                    onClick={async () => {
                      if (await run(() => repo.removeEquipment(removeEquip.id, false), 'Equipment removed')) setRemoveEquip(null);
                    }}
                  >
                    Remove permanently
                  </button>
                )}
              </>
            )
          }
        >
          <p className="text-[13px] text-neutral-600">
            {removeEquip.status === 'deployed'
              ? 'This equipment is out on a dispatch. Release it from the dispatch (or mark the dispatch Done) before removing or retiring it.'
              : useCount === null
              ? 'Checking the dispatch history…'
              : useCount < 0
              ? removeEquip.status === 'unavailable'
                ? 'Could not check the dispatch history. Try again in a moment.'
                : 'Could not check the dispatch history. Retiring keeps the history safe.'
              : useCount > 0 && removeEquip.status === 'unavailable'
              ? `This equipment is retired. It was used in ${useCount} ${useCount === 1 ? 'dispatch' : 'dispatches'}, so it stays in the list to keep that history.`
              : useCount > 0
              ? `This equipment was used in ${useCount} ${useCount === 1 ? 'dispatch' : 'dispatches'}. Deleting it would erase that history, so retire it instead: it stays in the list, marked unavailable.`
              : removeEquip.status === 'unavailable'
              ? 'This equipment is retired and was never used on a dispatch. You can remove it permanently (its readiness checks go with it).'
              : 'This equipment was never used on a dispatch. Remove it permanently (its readiness checks go with it), or retire it: it stays in the list, marked unavailable.'}
          </p>
        </Modal>
      )}

      {declineOpen && selected && (
        <Modal
          title="Can’t respond to this dispatch"
          onClose={() => setDeclineOpen(false)}
          footer={
            <>
              <button type="button" className={softBtn} onClick={() => setDeclineOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !declineReason.trim()}
                className={accentBtn}
                onClick={async () => {
                  if (await run(() => repo.declineDispatch(selected.id, declineReason.trim()), 'Dispatch declined. The dispatcher has been told to pick another team.')) setDeclineOpen(false);
                }}
              >
                Decline dispatch
              </button>
            </>
          }
        >
          <p className="text-[12px] text-neutral-500">The dispatcher and the LGU are told right away so they can send another team.</p>
          <Label text="Reason">
            <textarea
              rows={3}
              maxLength={500}
              className={`${field} h-auto py-2.5`}
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="e.g. No available responders, equipment failure"
            />
          </Label>
        </Modal>
      )}

      {helpOpen && selected && (
        <Modal
          title="Request help on this dispatch"
          onClose={() => setHelpOpen(false)}
          footer={
            <>
              <button type="button" className={softBtn} onClick={() => setHelpOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !helpForm.message.trim()}
                className={accentBtn}
                onClick={async () => {
                  if (await askHelp(helpForm.kind, helpForm.message.trim(), 'Help request sent to the LGU')) setHelpOpen(false);
                }}
              >
                Send
              </button>
            </>
          }
        >
          <Label text="Kind">
            <select className={field} value={helpForm.kind} onChange={(e) => setHelpForm({ ...helpForm, kind: e.target.value as HelpRequest['kind'] })}>
              {(Object.keys(HELP_KIND) as HelpRequest['kind'][]).map((k) => (
                <option key={k} value={k}>
                  {HELP_KIND[k]}
                </option>
              ))}
            </select>
          </Label>
          <Label text="Message">
            <textarea
              rows={3}
              maxLength={1000}
              className={`${field} h-auto py-2.5`}
              value={helpForm.message}
              onChange={(e) => setHelpForm({ ...helpForm, message: e.target.value })}
              placeholder="What do you need?"
            />
          </Label>
          <p className="text-[11px] text-neutral-400 text-right">{helpForm.message.length} / 1000</p>
        </Modal>
      )}

      {closureOpen && selected && (
        <Modal
          title="Post a road closure"
          onClose={() => setClosureOpen(false)}
          footer={
            <>
              <button type="button" className={softBtn} onClick={() => setClosureOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !closureForm.roadName.trim()}
                className={accentBtn}
                onClick={async () => {
                  const ok = await run(
                    () =>
                      repo.postRoadClosure(selected.id, {
                        roadName: closureForm.roadName.trim(),
                        note: closureForm.note.trim(),
                        segmentFrom: closureForm.segmentFrom.trim(),
                        segmentTo: closureForm.segmentTo.trim(),
                        estimatedReopen: closureForm.reopen ? new Date(closureForm.reopen).toISOString() : null,
                      }),
                    'Road closure posted'
                  );
                  if (ok) setClosureOpen(false);
                }}
              >
                Post closure
              </button>
            </>
          }
        >
          <Label text="Road name">
            <input className={field} value={closureForm.roadName} onChange={(e) => setClosureForm({ ...closureForm, roadName: e.target.value })} placeholder="e.g. Rizal St" />
          </Label>
          <Label text="Diversion route / note">
            <textarea rows={2} className={`${field} h-auto py-2.5`} value={closureForm.note} onChange={(e) => setClosureForm({ ...closureForm, note: e.target.value })} placeholder="Detour via Mabini St, two lanes blocked" />
          </Label>
          <div className="grid grid-cols-2 gap-2">
            <Label text="From">
              <input className={field} value={closureForm.segmentFrom} onChange={(e) => setClosureForm({ ...closureForm, segmentFrom: e.target.value })} placeholder="Purok 1" />
            </Label>
            <Label text="To">
              <input className={field} value={closureForm.segmentTo} onChange={(e) => setClosureForm({ ...closureForm, segmentTo: e.target.value })} placeholder="Highway junction" />
            </Label>
          </div>
          <Label text="Estimated reopen (optional)">
            <input type="datetime-local" className={field} value={closureForm.reopen} onChange={(e) => setClosureForm({ ...closureForm, reopen: e.target.value })} />
          </Label>
        </Modal>
      )}

      {inviteOpen && unit && (
        <Modal
          title={`Invite a member · ${unit.name}`}
          onClose={() => setInviteOpen(false)}
          footer={
            <>
              <button type="button" className={softBtn} onClick={() => setInviteOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(inviteEmail.trim())}
                className={accentBtn}
                onClick={async () => {
                  if (await run(() => repo.inviteUnitMember(unit.id, inviteEmail.trim(), 'member', true), `Invitation sent to ${inviteEmail.trim()}`)) {
                    setInviteEmail('');
                    setInviteOpen(false);
                  }
                }}
              >
                Send invitation
              </button>
            </>
          }
        >
          <p className="text-[12px] text-neutral-500">They get an email to set a password, then sign in to this unit’s console as a member.</p>
          <Label text="Email">
            <input type="email" className={field} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="responder@example.com" />
          </Label>
        </Modal>
      )}
    </div>
  );
};
