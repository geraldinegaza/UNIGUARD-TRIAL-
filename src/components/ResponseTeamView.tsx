import React, { useEffect, useMemo, useState } from 'react';
import { Shield, Users, Wrench, Truck, Phone, Plus, X, RefreshCw, Building2, Clock, Siren } from 'lucide-react';

import { User, Dispatch, DispatchStage, HelpRequest, UnitEquipment } from '../types';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import { relTime, telHref } from '../lib/util';

// Barangay official: the Response Team screen from the reference build.
// The barangay's Response Team dispatches (assign a responder, Can't respond,
// Need help, Beyond our capacity), the responder roster, the barangay's
// equipment, shelters flagged for a PNP patrol, and the dispatch units to call.
// Every write goes through the server's checked functions (migration 155).

interface ResponseTeamViewProps {
  currentUser: User;
  onNavigateTab?: (tab: string) => void;
  /** open the dispatch form for this report in Incidents (Beyond our capacity) */
  onRedispatch?: (reportId: string) => void;
}

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
const HELP_KIND: Record<HelpRequest['kind'], string> = {
  general: 'General',
  water_tanker: 'Water tanker',
  extra_personnel: 'Extra personnel',
  beyond_capacity: 'Beyond capacity',
};
const CONDITIONS = ['ready', 'needs_repair', 'missing', 'out_of_service', 'unknown'];
const UNIT_TYPE_LABEL: Record<string, string> = { BFP: 'Fire (BFP)', PNP: 'Police (PNP)', Rescue: 'Rescue Unit', Hospital: 'Hospital' };
const pretty = (s: string) => (s || '').replace(/_/g, ' ');
const isOpen = (s: DispatchStage) => s !== 'done' && s !== 'declined';
const absTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

// the barangay console's palette
const card = 'bg-white rounded-[24px] border border-[#7EA0C5]/40 shadow-xs overflow-hidden';
const cardHead = 'px-5 sm:px-6 py-4 bg-[#C2E8FF]/15 border-b border-[#7EA0C5]/30 flex flex-wrap items-center justify-between gap-3';
const rowCls = 'p-4 sm:p-5';
const input =
  'w-full text-xs p-2.5 rounded-xl outline-hidden transition-all bg-[#C2E8FF]/10 text-[#011025] border border-[#7EA0C5]/40 focus:bg-white focus:border-[#052659]';
const primaryBtn =
  'px-4 py-2 rounded-full text-xs font-medium text-white bg-[#052659] hover:bg-[#031c42] border border-[#011025]/20 shadow-xs cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5';
const ghostBtn =
  'px-3.5 py-1.5 rounded-full text-xs font-medium bg-white hover:bg-[#C2E8FF]/30 text-[#052659] border border-[#7EA0C5]/40 shadow-2xs cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5';
const pill = (cls: string, text: string) => (
  <span className={`shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${cls}`}>{text}</span>
);
const STAGE_PILL = (s: DispatchStage) =>
  s === 'done'
    ? 'bg-[#E7F4EA] text-[#2F6B3F]'
    : s === 'declined'
    ? 'bg-neutral-100 text-neutral-500'
    : s === 'on_hold'
    ? 'bg-[#FDF0DC] text-[#8A5A12]'
    : 'bg-[#C2E8FF]/60 text-[#052659]';
const EQUIP_PILL: Record<string, string> = {
  available: 'bg-[#E7F4EA] text-[#2F6B3F]',
  deployed: 'bg-[#C2E8FF]/60 text-[#052659]',
  maintenance: 'bg-[#FDF0DC] text-[#8A5A12]',
  unavailable: 'bg-[#FBE3E2] text-[#9B2C2C]',
};
const RESPONDER_PILL: Record<string, string> = {
  available: 'bg-[#E7F4EA] text-[#2F6B3F]',
  on_duty: 'bg-[#C2E8FF]/60 text-[#052659]',
  off_duty: 'bg-neutral-100 text-neutral-500',
};

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }> = ({ title, onClose, children, footer }) => (
  <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
    <div className="absolute inset-0 bg-[#011025]/50 backdrop-blur-xs" onClick={onClose} aria-hidden="true" />
    <div className="relative w-full sm:max-w-md max-h-[90dvh] overflow-y-auto bg-white rounded-t-[24px] sm:rounded-[24px] border border-[#7EA0C5]/40 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5 shadow-xl">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-base font-semibold text-[#011025]">{title}</h3>
        <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full bg-[#C2E8FF]/30 text-[#052659] flex items-center justify-center cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="space-y-3">{children}</div>
      <div className="mt-5 pt-3 border-t border-[#7EA0C5]/20 flex flex-wrap justify-end gap-2">{footer}</div>
    </div>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block">
    <span className="block text-xs font-semibold mb-1 text-[#052659]">{label}</span>
    {children}
  </label>
);

export const ResponseTeamView: React.FC<ResponseTeamViewProps> = ({ currentUser, onNavigateTab, onRedispatch }) => {
  const data = useRepo();
  const myBrgy = currentUser.barangay_uuid || null;
  const brgyName = currentUser.barangay_name || 'your barangay';
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // the responder picked on each dispatch row
  const [pick, setPick] = useState<Record<string, string>>({});
  // pop-ups
  const [declineFor, setDeclineFor] = useState<Dispatch | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [helpFor, setHelpFor] = useState<Dispatch | null>(null);
  const [helpForm, setHelpForm] = useState<{ kind: HelpRequest['kind']; message: string }>({ kind: 'general', message: '' });
  const [beyondFor, setBeyondFor] = useState<Dispatch | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [equipForm, setEquipForm] = useState({ catalogId: '', customLabel: '', identifier: '', condition: 'unknown', notes: '' });
  const [editEquip, setEditEquip] = useState<UnitEquipment | null>(null);
  const [editForm, setEditForm] = useState({ customLabel: '', identifier: '', condition: 'unknown', notes: '' });
  const [removeEquip, setRemoveEquip] = useState<UnitEquipment | null>(null);
  const [useCount, setUseCount] = useState<number | null>(null);

  const refresh = () =>
    Promise.all([repo.loadResponseTeam(), repo.loadResponders(), repo.loadDispatchUnits().catch(() => undefined)]).catch((e: any) =>
      setNotice(e?.message || 'Could not load the Response Team data.')
    );
  useEffect(() => {
    refresh().finally(() => setLoaded(true));
  }, []);

  const run = async (fn: () => Promise<void>, ok: string) => {
    if (busy) return false;
    setBusy(true);
    setNotice(null);
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

  const dispatches = data.teamDispatches;
  // this barangay's responders, and the shared ones with no barangay
  const responders = useMemo(() => data.responders.filter((r) => r.barangay_id === myBrgy || r.barangay_id === null), [data.responders, myBrgy]);
  const available = responders.filter((r) => r.status === 'available');
  const patrolShelters = data.centers.filter((c) => c.needs_patrol);
  const units = data.units.filter((u) => u.active);
  const equipLabel = (e: UnitEquipment) => e.label || data.equipmentCatalog.find((c) => c.id === e.catalog_id)?.label || 'Equipment';
  const activeCount = dispatches.filter((d) => isOpen(d.dispatch_status)).length;

  const assign = (d: Dispatch) => {
    const responderId = pick[d.id];
    if (!responderId) {
      setNotice('Pick a responder first.');
      return;
    }
    run(async () => {
      await repo.assignTeamResponder(d.report_id, responderId);
      setPick((p) => ({ ...p, [d.id]: '' }));
    }, 'Responder assigned. They are now on duty.');
  };

  const dispatchRow = (d: Dispatch) => {
    const open = isOpen(d.dispatch_status);
    const help = data.helpRequests.filter((h) => h.dispatch_id === d.id);
    return (
      <div key={d.id} className={rowCls}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-[#011025] truncate">
              {d.report?.code || 'Dispatch'} · {d.report?.hazard_type || 'Incident'}
            </h3>
            <p className="text-xs text-[#5482B4] mt-0.5 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>
                {absTime(d.dispatched_at)} · by {d.dispatched_by_name || '—'}
              </span>
            </p>
          </div>
          {pill(STAGE_PILL(d.dispatch_status), STAGE_LABEL[d.dispatch_status] || pretty(d.dispatch_status))}
        </div>
        {d.instructions && <p className="mt-2 text-xs text-[#011025] bg-[#C2E8FF]/15 border border-[#7EA0C5]/20 rounded-xl px-3 py-2 whitespace-pre-wrap">{d.instructions}</p>}
        {d.dispatch_status === 'declined' && d.decline_reason && <p className="mt-2 text-xs text-[#5482B4]">Declined: {d.decline_reason}</p>}
        {help.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {help.map((h) => (
              <span key={h.id} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#FDF0DC] text-[#8A5A12]" title={h.message}>
                {HELP_KIND[h.kind] || pretty(h.kind)} · {h.status}
              </span>
            ))}
          </div>
        )}
        {open && (
          <>
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <select
                className={`${input} sm:flex-1`}
                value={pick[d.id] || ''}
                onChange={(e) => setPick((p) => ({ ...p, [d.id]: e.target.value }))}
                aria-label="Assign a responder"
              >
                <option value="">{available.length ? 'Assign a responder…' : 'No responder is available'}</option>
                {available.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.unit ? ` · ${r.unit}` : ''}
                  </option>
                ))}
              </select>
              <button type="button" className={primaryBtn} disabled={busy} onClick={() => assign(d)}>
                Assign
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(d.dispatch_status === 'sent' || d.dispatch_status === 'acknowledged') && (
                <button
                  type="button"
                  className={ghostBtn}
                  disabled={busy}
                  onClick={() => {
                    setDeclineReason('');
                    setDeclineFor(d);
                  }}
                >
                  Can’t respond
                </button>
              )}
              <button
                type="button"
                className={ghostBtn}
                disabled={busy}
                onClick={() => {
                  setHelpForm({ kind: 'general', message: '' });
                  setHelpFor(d);
                }}
              >
                Need help
              </button>
              <button type="button" className={ghostBtn} disabled={busy} onClick={() => setBeyondFor(d)}>
                Beyond capacity
              </button>
            </div>
          </>
        )}
      </div>
    );
  };

  const empty = (title: string, sub: string) => (
    <div className="p-8 text-center">
      <p className="text-sm font-semibold text-[#011025]">{title}</p>
      <p className="text-xs text-[#5482B4] mt-1">{sub}</p>
    </div>
  );

  return (
    <div className="space-y-6 sm:space-y-7 animate-in fade-in duration-300">
      {/* header */}
      <div className="px-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#011025]">Response Team</h1>
          <p className="text-xs sm:text-sm mt-0.5 text-[#5482B4]">Incoming dispatches, roster and equipment for Barangay {brgyName}.</p>
        </div>
        <button type="button" className={ghostBtn} disabled={busy} onClick={() => run(refresh as () => Promise<any>, 'Refreshed')}>
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {notice && <p className="text-xs text-[#052659] bg-[#C2E8FF]/40 border border-[#7EA0C5]/40 rounded-2xl px-4 py-2.5">{notice}</p>}

      {/* dispatches */}
      <section className={card}>
        <div className={cardHead}>
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl bg-[#C2E8FF]/40 border border-[#7EA0C5]/40 text-[#052659] flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-[#011025]">Response Team dispatches</h2>
              <p className="text-xs text-[#5482B4]">{activeCount} active</p>
            </div>
          </div>
        </div>
        {dispatches.length ? (
          <div className="divide-y divide-[#7EA0C5]/20">{dispatches.map(dispatchRow)}</div>
        ) : (
          empty(loaded ? 'No Response Team dispatches yet' : 'Loading…', 'When your barangay’s Response Team is dispatched, the alert lands here.')
        )}
      </section>

      {/* roster */}
      <section className={card}>
        <div className={cardHead}>
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl bg-[#C2E8FF]/40 border border-[#7EA0C5]/40 text-[#052659] flex items-center justify-center shrink-0">
              <Users className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-[#011025]">Roster</h2>
              <p className="text-xs text-[#5482B4]">
                {available.length} available · {responders.filter((r) => r.status === 'on_duty').length} on duty
              </p>
            </div>
          </div>
        </div>
        {responders.length ? (
          <div className="divide-y divide-[#7EA0C5]/20">
            {responders.map((r) => (
              <div key={r.id} className={`${rowCls} flex flex-wrap sm:flex-nowrap items-center gap-3`}>
                <span className="min-w-0 flex-1 basis-[calc(100%-6rem)] sm:basis-auto">
                  <span className="block text-sm font-semibold text-[#011025] truncate">{r.name}</span>
                  <span className="block text-xs text-[#5482B4] truncate">{[r.unit, r.contact].filter(Boolean).join(' · ') || '—'}</span>
                </span>
                {pill(RESPONDER_PILL[r.status] || RESPONDER_PILL.available, pretty(r.status))}
                {r.contact && (
                  <a href={telHref(r.contact)} aria-label={`Call ${r.name}`} className="w-8 h-8 rounded-full bg-[#C2E8FF]/30 text-[#052659] flex items-center justify-center shrink-0">
                    <Phone className="w-4 h-4" />
                  </a>
                )}
                <button
                  type="button"
                  className={ghostBtn}
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => repo.setResponderStatus(r.id, r.status === 'off_duty' ? 'available' : 'off_duty'),
                      r.status === 'off_duty' ? `${r.name} is available` : `${r.name} is off duty`
                    )
                  }
                >
                  {r.status === 'off_duty' ? 'Set available' : 'Set off duty'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          empty('No responders yet', 'The barangay’s responders appear here once the LDRRMO lists them.')
        )}
      </section>

      {/* equipment */}
      <section className={card}>
        <div className={cardHead}>
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl bg-[#C2E8FF]/40 border border-[#7EA0C5]/40 text-[#052659] flex items-center justify-center shrink-0">
              <Wrench className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-[#011025]">Equipment</h2>
              <p className="text-xs text-[#5482B4]">Boats, life vests, ropes, radios and other barangay-owned equipment.</p>
            </div>
          </div>
          <button
            type="button"
            className={primaryBtn}
            disabled={!myBrgy}
            onClick={() => {
              setEquipForm({ catalogId: data.equipmentCatalog[0]?.id || '', customLabel: '', identifier: '', condition: 'unknown', notes: '' });
              setAddOpen(true);
            }}
          >
            <Plus className="w-3.5 h-3.5" /> Add equipment
          </button>
        </div>
        {data.teamEquipment.length ? (
          <div className="divide-y divide-[#7EA0C5]/20">
            {data.teamEquipment.map((e) => (
              <div key={e.id} className={rowCls}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-[#011025] truncate">{e.identifier || equipLabel(e)}</span>
                    <span className="block text-xs text-[#5482B4] truncate">
                      {[e.identifier ? equipLabel(e) : '', e.notes, `last check ${e.last_checked_at ? relTime(e.last_checked_at) : 'never'}`].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {pill(EQUIP_PILL[e.status] || 'bg-neutral-100 text-neutral-500', e.status)}
                    {e.condition && pill('bg-[#C2E8FF]/30 text-[#052659]', pretty(e.condition))}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={ghostBtn}
                    onClick={() => {
                      setEditEquip(e);
                      setEditForm({ customLabel: e.label, identifier: e.identifier, condition: e.condition || 'unknown', notes: e.notes });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={ghostBtn}
                    onClick={() => {
                      setRemoveEquip(e);
                      setUseCount(null);
                      if (e.status !== 'deployed') repo.equipmentUseCount(e.id).then(setUseCount, () => setUseCount(-1));
                    }}
                  >
                    {e.status === 'unavailable' ? 'Remove' : 'Retire / remove'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          empty('No equipment yet', 'Use Add equipment to register a piece of barangay equipment.')
        )}
      </section>

      {/* shelters needing a PNP patrol */}
      {patrolShelters.length > 0 && (
        <section className={card}>
          <div className={cardHead}>
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-2xl bg-[#C2E8FF]/40 border border-[#7EA0C5]/40 text-[#052659] flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-[#011025]">Shelters needing patrol</h2>
                <p className="text-xs text-[#5482B4]">Flagged from the shelter’s edit form. The PNP sees this list.</p>
              </div>
            </div>
          </div>
          <div className="divide-y divide-[#7EA0C5]/20">
            {patrolShelters.map((c) => (
              <div key={c.id} className={`${rowCls} flex items-center gap-3`}>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[#011025] truncate">{c.name}</span>
                  <span className="block text-xs text-[#5482B4] truncate">
                    {c.barangay_name} · flagged {c.needs_patrol_at ? absTime(c.needs_patrol_at) : '—'}
                  </span>
                </span>
                <button type="button" className={ghostBtn} onClick={() => onNavigateTab?.('shelters')}>
                  Open
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* dispatch units to call */}
      {units.length > 0 && (
        <section className={card}>
          <div className={cardHead}>
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-2xl bg-[#C2E8FF]/40 border border-[#7EA0C5]/40 text-[#052659] flex items-center justify-center shrink-0">
                <Truck className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-[#011025]">Dispatch units</h2>
                <p className="text-xs text-[#5482B4]">BFP, PNP, rescue units and hospitals. Tap to call.</p>
              </div>
            </div>
          </div>
          <div className="divide-y divide-[#7EA0C5]/20">
            {units.map((u) => (
              <div key={u.id} className={`${rowCls} flex flex-wrap sm:flex-nowrap items-center gap-3`}>
                <span className="min-w-0 flex-1 basis-[calc(100%-6rem)] sm:basis-auto">
                  <span className="block text-sm font-semibold text-[#011025] truncate">{u.name}</span>
                  <span className="block text-xs text-[#5482B4] truncate">
                    {UNIT_TYPE_LABEL[u.unit_type] || u.unit_type}
                    {u.contact_number ? ` · ${u.contact_number}` : ''}
                  </span>
                </span>
                {pill(u.status === 'available' ? 'bg-[#E7F4EA] text-[#2F6B3F]' : u.status === 'on_duty' ? 'bg-[#C2E8FF]/60 text-[#052659]' : 'bg-neutral-100 text-neutral-500', pretty(u.status))}
                {u.contact_number && (
                  <a href={telHref(u.contact_number)} className={primaryBtn}>
                    <Phone className="w-3.5 h-3.5" /> Call
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------- pop-ups */}
      {declineFor && (
        <Modal
          title="Can’t respond to this dispatch"
          onClose={() => setDeclineFor(null)}
          footer={
            <>
              <button type="button" className={ghostBtn} onClick={() => setDeclineFor(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={primaryBtn}
                disabled={busy || !declineReason.trim()}
                onClick={async () => {
                  if (await run(() => repo.declineDispatch(declineFor.id, declineReason.trim()), 'Dispatch declined. The dispatcher has been told to pick another team.')) setDeclineFor(null);
                }}
              >
                Decline dispatch
              </button>
            </>
          }
        >
          <p className="text-xs text-[#5482B4]">The dispatcher and the LDRRMO are told right away so they can send another team.</p>
          <Field label="Reason">
            <textarea
              rows={3}
              maxLength={500}
              className={input}
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="e.g. No available responders, equipment failure"
            />
          </Field>
        </Modal>
      )}

      {helpFor && (
        <Modal
          title="Request help on this dispatch"
          onClose={() => setHelpFor(null)}
          footer={
            <>
              <button type="button" className={ghostBtn} onClick={() => setHelpFor(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={primaryBtn}
                disabled={busy || !helpForm.message.trim()}
                onClick={async () => {
                  if (await run(() => repo.requestDispatchHelp(helpFor.id, helpForm.kind, helpForm.message.trim()), 'Help request sent to the LDRRMO')) setHelpFor(null);
                }}
              >
                Send
              </button>
            </>
          }
        >
          <Field label="Kind">
            <select className={input} value={helpForm.kind} onChange={(e) => setHelpForm({ ...helpForm, kind: e.target.value as HelpRequest['kind'] })}>
              {(Object.keys(HELP_KIND) as HelpRequest['kind'][]).map((k) => (
                <option key={k} value={k}>
                  {HELP_KIND[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Message">
            <textarea
              rows={3}
              maxLength={1000}
              className={input}
              value={helpForm.message}
              onChange={(e) => setHelpForm({ ...helpForm, message: e.target.value })}
              placeholder="What do you need?"
            />
          </Field>
          <p className="text-[11px] text-[#7EA0C5] text-right">{helpForm.message.length} / 1000</p>
        </Modal>
      )}

      {beyondFor && (
        <Modal
          title="Beyond our capacity"
          onClose={() => setBeyondFor(null)}
          footer={
            <button type="button" className={ghostBtn} onClick={() => setBeyondFor(null)}>
              Close
            </button>
          }
        >
          <p className="text-xs text-[#5482B4]">Choose how to escalate this dispatch.</p>
          <button
            type="button"
            className={`${primaryBtn} w-full py-2.5`}
            disabled={busy || !onRedispatch}
            onClick={() => {
              const reportId = beyondFor.report_id;
              setBeyondFor(null);
              onRedispatch?.(reportId);
            }}
          >
            <Siren className="w-3.5 h-3.5" /> Re-dispatch another team
          </button>
          <button
            type="button"
            className={`${ghostBtn} w-full py-2.5`}
            disabled={busy}
            onClick={async () => {
              if (await run(() => repo.requestDispatchHelp(beyondFor.id, 'beyond_capacity', 'Beyond our capacity — please send additional help.'), 'Need Help sent to the LDRRMO')) setBeyondFor(null);
            }}
          >
            Send Need Help to the LDRRMO
          </button>
        </Modal>
      )}

      {addOpen && (
        <Modal
          title={`Add equipment · Barangay ${brgyName}`}
          onClose={() => setAddOpen(false)}
          footer={
            <>
              <button type="button" className={ghostBtn} onClick={() => setAddOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={primaryBtn}
                disabled={busy || (!equipForm.catalogId && !equipForm.customLabel.trim())}
                onClick={async () => {
                  if (
                    await run(
                      () =>
                        repo.addBarangayEquipment({
                          catalogId: equipForm.catalogId || null,
                          customLabel: equipForm.customLabel,
                          identifier: equipForm.identifier,
                          condition: equipForm.condition,
                          notes: equipForm.notes,
                        }),
                      'Equipment added'
                    )
                  )
                    setAddOpen(false);
                }}
              >
                Add
              </button>
            </>
          }
        >
          <Field label="Type">
            <select className={input} value={equipForm.catalogId} onChange={(e) => setEquipForm({ ...equipForm, catalogId: e.target.value })}>
              {data.equipmentCatalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
              <option value="">Other (custom)</option>
            </select>
          </Field>
          {!equipForm.catalogId && (
            <Field label="Custom label">
              <input className={input} value={equipForm.customLabel} onChange={(e) => setEquipForm({ ...equipForm, customLabel: e.target.value })} placeholder="e.g. Portable pump" />
            </Field>
          )}
          <Field label="Identifier (tag or number)">
            <input className={input} value={equipForm.identifier} onChange={(e) => setEquipForm({ ...equipForm, identifier: e.target.value })} placeholder="e.g. Boat #1" />
          </Field>
          <Field label="Starting condition">
            <select className={input} value={equipForm.condition} onChange={(e) => setEquipForm({ ...equipForm, condition: e.target.value })}>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {pretty(c)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes">
            <textarea rows={2} className={input} value={equipForm.notes} onChange={(e) => setEquipForm({ ...equipForm, notes: e.target.value })} placeholder="Anything the next shift should know" />
          </Field>
        </Modal>
      )}

      {editEquip && (
        <Modal
          title={`Edit · ${editEquip.identifier || equipLabel(editEquip)}`}
          onClose={() => setEditEquip(null)}
          footer={
            <>
              <button type="button" className={ghostBtn} onClick={() => setEditEquip(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={primaryBtn}
                disabled={busy}
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
          <Field label="Type">
            <input className={input} value={equipLabel(editEquip)} disabled readOnly />
          </Field>
          {!editEquip.catalog_id && (
            <Field label="Custom label">
              <input className={input} value={editForm.customLabel} onChange={(e) => setEditForm({ ...editForm, customLabel: e.target.value })} />
            </Field>
          )}
          <Field label="Identifier">
            <input className={input} value={editForm.identifier} onChange={(e) => setEditForm({ ...editForm, identifier: e.target.value })} />
          </Field>
          <Field label="Condition">
            <select className={input} value={editForm.condition} onChange={(e) => setEditForm({ ...editForm, condition: e.target.value })}>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {pretty(c)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes">
            <textarea rows={2} className={input} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
          </Field>
          <p className="text-[11px] text-[#7EA0C5]">The owner and type cannot be changed. Retire it and add a new one instead.</p>
        </Modal>
      )}

      {removeEquip && (
        <Modal
          title={`${removeEquip.status === 'deployed' ? 'Cannot remove' : 'Retire or remove'} · ${removeEquip.identifier || equipLabel(removeEquip)}`}
          onClose={() => setRemoveEquip(null)}
          footer={
            removeEquip.status === 'deployed' ? (
              <button type="button" className={ghostBtn} onClick={() => setRemoveEquip(null)}>
                Close
              </button>
            ) : (
              <>
                <button type="button" className={ghostBtn} onClick={() => setRemoveEquip(null)}>
                  Cancel
                </button>
                {useCount !== null && removeEquip.status !== 'unavailable' && (
                  <button
                    type="button"
                    className={ghostBtn}
                    disabled={busy}
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
                    className={primaryBtn}
                    disabled={busy}
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
          <p className="text-xs text-[#011025]">
            {removeEquip.status === 'deployed'
              ? 'This equipment is out on a dispatch. Release it from the dispatch (or close the dispatch) before removing or retiring it.'
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
    </div>
  );
};
