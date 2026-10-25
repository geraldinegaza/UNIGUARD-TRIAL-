import React, { useEffect, useMemo, useState } from 'react';
import { Truck, Plus, X, Users, Inbox, Check, Ban, Mail, Phone, MapPin, Search, Trash2, Pencil } from 'lucide-react';
import { DispatchUnit, UnitType, User } from '../types';
import * as repo from '../services/repo';
import { useRepo } from '../hooks/useRepo';
import { relTime } from '../lib/util';

// Dispatch units (BFP, PNP, Rescue, Hospital) for the LGU console. The LGU
// creates and edits units and decides their support requests. Only the Super
// Admin can create accounts, so inviting members and disabling them shows for
// the Super Admin alone; a unit admin can invite further members from the unit.

const TYPES: UnitType[] = ['BFP', 'PNP', 'Rescue', 'Hospital'];
const TYPE_LABEL: Record<UnitType, string> = { BFP: 'Fire (BFP)', PNP: 'Police (PNP)', Rescue: 'Rescue', Hospital: 'Hospital' };
const KIND_LABEL: Record<string, string> = { fuel: 'Fuel', personnel: 'Personnel', equipment: 'Equipment', mutual_aid: 'Mutual aid', other: 'Other' };

interface DispatchUnitsViewProps {
  /** the Super Admin may invite and disable unit members */
  canManageAccounts?: boolean;
}

const card = 'bg-white rounded-[24px] border border-neutral-200/70 shadow-xs';
const input =
  'w-full text-xs font-medium p-3 rounded-xl bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white border border-neutral-200 focus:outline-hidden focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50 transition-all';
const label = 'block text-[10px] font-semibold uppercase tracking-wider mb-1.5 text-neutral-500';
const primary = 'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-medium text-white bg-[#18181b] hover:bg-neutral-800 shadow-xs cursor-pointer disabled:opacity-50 transition-colors';
const ghost = 'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 border border-neutral-200/80 cursor-pointer disabled:opacity-50 transition-colors';

export const DispatchUnitsView: React.FC<DispatchUnitsViewProps> = ({ canManageAccounts = false }) => {
  const { units, unitMembers, unitRequests } = useRepo();
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', unit_type: 'BFP' as UnitType, contact_number: '', address: '' });
  const [openUnit, setOpenUnit] = useState<DispatchUnit | null>(null);
  const [edit, setEdit] = useState({ name: '', contact_number: '', address: '' });
  const [invite, setInvite] = useState({ email: '', unitRole: 'unit_admin' as 'unit_admin' | 'member' });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // reference build: the Super Admin edits a member's name and phone
  const [editMember, setEditMember] = useState<User | null>(null);
  const [memberForm, setMemberForm] = useState({ full_name: '', phone: '' });

  useEffect(() => {
    repo
      .loadDispatchUnits()
      .then(() => {
        // no units yet: start with the New unit form open
        if (!repo.getState().units.length && canManageAccounts) setShowNew(true);
      })
      .catch((e: any) => setLoadError(e?.message || 'Could not load the dispatch units.'));
  }, []);

  // Escape closes whichever dialog is open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setEditMember(null);
      setOpenUnit(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  };
  const run = async (fn: () => Promise<void>, ok: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      flash(ok);
    } catch (e: any) {
      flash(e?.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const membersOf = (unitId: string): User[] => unitMembers.filter((m) => m.dispatch_unit_id === unitId);
  const pending = unitRequests.filter((r) => r.status === 'pending');
  const q = search.trim().toLowerCase();
  const shown = q
    ? units.filter((u) => [u.name, u.unit_type, u.address, u.contact_number].some((f) => (f || '').toLowerCase().includes(q)))
    : units;
  const unitName = (id: string) => units.find((u) => u.id === id)?.name || 'Unit';
  const grouped = useMemo(() => TYPES.map((t) => ({ type: t, list: shown.filter((u) => u.unit_type === t) })), [shown]);

  const openPanel = (u: DispatchUnit) => {
    setOpenUnit(u);
    setEdit({ name: u.name, contact_number: u.contact_number, address: u.address });
    setInvite({ email: '', unitRole: membersOf(u.id).some((m) => m.unit_role === 'unit_admin') ? 'member' : 'unit_admin' });
  };

  return (
    <div className="space-y-6 sm:space-y-7 animate-in fade-in duration-300">
      {/* Header */}
      <div className="px-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-neutral-900">Dispatch Units</h1>
          <p className="text-xs sm:text-sm mt-0.5 max-w-2xl leading-relaxed text-neutral-500">
            BFP, PNP, rescue and hospital units that receive dispatches from the incident queue.
          </p>
        </div>
        {/* a new unit invites its first admin account, so it is a Super Admin action */}
        {canManageAccounts && (
          <button type="button" onClick={() => setShowNew((v) => !v)} className={`${primary} self-start sm:self-auto`}>
            {showNew ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            <span>{showNew ? 'Close' : 'New unit'}</span>
          </button>
        )}
      </div>

      <label className={`${card} flex items-center gap-2 px-4 h-12`}>
        <Search className="w-4 h-4 text-neutral-400 shrink-0" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search units: name, type, address or contact"
          aria-label="Search dispatch units"
          className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none"
        />
        {search && (
          <button type="button" onClick={() => setSearch('')} className="text-[11px] font-semibold text-neutral-600 cursor-pointer">
            Clear
          </button>
        )}
      </label>

      {notice && (
        <div className="px-4 py-3 rounded-2xl bg-white border border-neutral-200 text-xs font-medium text-neutral-800 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="text-neutral-400 hover:text-neutral-700 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {loadError && <p className="px-4 py-3 rounded-2xl bg-red-50 text-red-700 text-xs">{loadError}</p>}

      {/* New unit */}
      {showNew && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.name.trim()) return;
            run(async () => {
              await repo.createDispatchUnit(form);
              setForm({ name: '', unit_type: 'BFP', contact_number: '', address: '' });
              setShowNew(false);
            }, `Created ${form.name.trim()}`);
          }}
          className={`${card} p-6 grid grid-cols-1 md:grid-cols-12 gap-4 items-end`}
        >
          <div className="md:col-span-4">
            <label className={label}>Unit name</label>
            <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. BFP Lingayen" />
          </div>
          <div className="md:col-span-2">
            <label className={label}>Type</label>
            <select className={input} value={form.unit_type} onChange={(e) => setForm({ ...form, unit_type: e.target.value as UnitType })}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className={label}>Contact number</label>
            <input className={input} value={form.contact_number} onChange={(e) => setForm({ ...form, contact_number: e.target.value })} placeholder="(075) 000-0000" />
          </div>
          <div className="md:col-span-3">
            <label className={label}>Address</label>
            <input className={input} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Station address" />
          </div>
          <div className="md:col-span-1">
            <button type="submit" disabled={busy} className={`${primary} w-full`}>
              <Plus className="w-4 h-4" />
              <span>Add</span>
            </button>
          </div>
        </form>
      )}

      {/* Support request inbox: every request from the units */}
      {unitRequests.length > 0 && (
        <div className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-neutral-100 bg-neutral-50/50 flex items-center gap-2">
            <Inbox className="w-4 h-4 text-neutral-700" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-900">Support requests</h2>
            <span className="ml-auto text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-neutral-100 border border-neutral-200 text-neutral-700">
              {pending.length} pending · {unitRequests.length} total
            </span>
          </div>
          <ul className="divide-y divide-neutral-100">
            {unitRequests.map((r) => (
              <li key={r.id} className="px-6 py-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-neutral-900">
                    {unitName(r.unit_id)} · {KIND_LABEL[r.kind] || r.kind}
                  </span>
                  <span className="block text-[11px] text-neutral-500 mt-0.5">{r.details || 'No details'} · {relTime(r.created_at)}</span>
                </span>
                {r.status !== 'pending' ? (
                  <span
                    className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                      r.status === 'declined' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-neutral-100 text-neutral-700 border border-neutral-200'
                    }`}
                  >
                    {r.status}
                    {r.decided_at ? ` · ${relTime(r.decided_at)}` : ''}
                  </span>
                ) : (
                <span className="flex gap-2 shrink-0">
                  <button type="button" disabled={busy} onClick={() => run(() => repo.decideUnitRequest(r.id, 'declined'), 'Request declined')} className={ghost}>
                    Decline
                  </button>
                  <button type="button" disabled={busy} onClick={() => run(() => repo.decideUnitRequest(r.id, 'approved'), 'Request approved')} className={primary}>
                    <Check className="w-4 h-4" />
                    Approve
                  </button>
                </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Units, by type */}
      {grouped.map(({ type, list }) => (
        <div key={type} className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-neutral-100 bg-neutral-50/50 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-900">{TYPE_LABEL[type]}</h2>
            <span className="text-[11px] font-mono text-neutral-500">
              {list.length} {list.length === 1 ? 'unit' : 'units'}
            </span>
          </div>
          {list.length === 0 ? (
            <p className="px-6 py-6 text-xs text-neutral-400">No {TYPE_LABEL[type].toLowerCase()} units yet.</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {list.map((u) => {
                const members = membersOf(u.id);
                return (
                  <li key={u.id}>
                    <button type="button" onClick={() => openPanel(u)} className="w-full text-left px-6 py-4 flex items-center gap-4 hover:bg-neutral-50/70 cursor-pointer">
                      <span className="w-10 h-10 rounded-2xl bg-neutral-100 border border-neutral-200/70 flex items-center justify-center shrink-0">
                        <Truck className="w-5 h-5 text-neutral-800" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-neutral-900 truncate">{u.name}</span>
                        <span className="block text-[11px] text-neutral-500 truncate">
                          {[u.contact_number, u.address].filter(Boolean).join(' · ') || 'No contact details'}
                        </span>
                      </span>
                      <span className="hidden sm:flex items-center gap-1.5 text-[11px] text-neutral-500 shrink-0">
                        <Users className="w-3.5 h-3.5" />
                        {members.length}
                      </span>
                      <span
                        className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                          u.active ? 'bg-[#18181b] text-white' : 'bg-neutral-100 text-neutral-400 border border-neutral-200 line-through'
                        }`}
                      >
                        {u.active ? 'Active' : 'Inactive'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}

      {/* Unit panel */}
      {openUnit && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-neutral-950/50 backdrop-blur-xs p-0 sm:p-6" onClick={() => setOpenUnit(null)}>
          <div
            role="dialog"
            aria-label={`Unit ${openUnit.name}`}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto bg-white rounded-t-[24px] sm:rounded-[24px] border border-neutral-200/80 shadow-2xl p-5 sm:p-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-base text-neutral-900">{openUnit.name}</h3>
                <p className="text-[11px] text-neutral-500 mt-0.5">{TYPE_LABEL[openUnit.unit_type]}</p>
              </div>
              <button type="button" onClick={() => setOpenUnit(null)} aria-label="Close" className="w-9 h-9 rounded-full bg-neutral-100 hover:bg-neutral-200 flex items-center justify-center cursor-pointer">
                <X className="w-4 h-4 text-neutral-600" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className={label}>Unit name</label>
                <input className={input} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </div>
              <div>
                <label className={label}>
                  <Phone className="w-3 h-3 inline mr-1" />
                  Contact
                </label>
                <input className={input} value={edit.contact_number} onChange={(e) => setEdit({ ...edit, contact_number: e.target.value })} />
              </div>
              <div>
                <label className={label}>
                  <MapPin className="w-3 h-3 inline mr-1" />
                  Address
                </label>
                <input className={input} value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await repo.updateDispatchUnit(openUnit.id, { active: !openUnit.active });
                    setOpenUnit(null);
                  }, openUnit.active ? 'Unit deactivated' : 'Unit activated')
                }
                className={ghost}
              >
                <Ban className="w-4 h-4" />
                {openUnit.active ? 'Deactivate unit' : 'Activate unit'}
              </button>
              {canManageAccounts && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const n = membersOf(openUnit.id).length;
                    if (
                      !window.confirm(
                        `Delete ${openUnit.name}? Its crew, equipment and requests are removed${n ? `, and its ${n} member account${n === 1 ? '' : 's'} become resident accounts` : ''}. Past dispatches keep their record. This cannot be undone.`
                      )
                    )
                      return;
                    run(async () => {
                      await repo.deleteDispatchUnit(openUnit.id);
                      setOpenUnit(null);
                    }, `${openUnit.name} deleted`);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 min-h-[36px] rounded-full text-xs font-semibold bg-red-600 hover:bg-red-700 text-white cursor-pointer disabled:opacity-60"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete unit
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await repo.updateDispatchUnit(openUnit.id, edit);
                    setOpenUnit(null);
                  }, 'Unit saved')
                }
                className={`${primary} ml-auto`}
              >
                Save
              </button>
            </div>

            {/* Members */}
            <div className="pt-4 border-t border-neutral-100">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">Members</h4>
              {membersOf(openUnit.id).length === 0 ? (
                <p className="text-xs text-neutral-400">
                  {canManageAccounts ? 'No members yet. Invite the unit admin below.' : 'No members yet. The Super Admin invites the unit admin.'}
                </p>
              ) : (
                <ul className="space-y-2">
                  {membersOf(openUnit.id).map((m) => (
                    <li key={m.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-neutral-50 border border-neutral-200/70">
                      <span className="w-8 h-8 rounded-full bg-[#18181b] text-white text-xs font-bold flex items-center justify-center shrink-0">
                        {(m.full_name || m.email || '?').trim().charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-neutral-900 truncate">
                          {m.full_name || m.email}
                          {m.disabled && <span className="ml-1.5 text-[10px] font-bold text-red-600">DISABLED</span>}
                        </span>
                        <span className="block text-[11px] text-neutral-500 truncate">
                          {m.unit_role === 'unit_admin' ? 'Unit admin' : 'Member'} · {m.email}
                        </span>
                      </span>
                      {canManageAccounts && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditMember(m);
                            setMemberForm({ full_name: m.full_name || '', phone: m.phone || '' });
                          }}
                          aria-label={`Edit ${m.full_name || m.email}`}
                          className="w-8 h-8 rounded-full border border-neutral-200 text-neutral-600 hover:bg-white flex items-center justify-center cursor-pointer shrink-0"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canManageAccounts && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            run(() => repo.adminUsers({ action: 'set-disabled', userId: m.id, disabled: !m.disabled }).then(() => repo.loadDispatchUnits()), m.disabled ? 'Member enabled' : 'Member deactivated')
                          }
                          className="text-[11px] font-medium px-3 py-1.5 rounded-full border border-neutral-200 text-neutral-700 hover:bg-white cursor-pointer"
                        >
                          {m.disabled ? 'Enable' : 'Deactivate'}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {canManageAccounts && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!invite.email.trim()) return;
                    run(async () => {
                      await repo.inviteUnitMember(openUnit.id, invite.email, invite.unitRole);
                      setInvite({ email: '', unitRole: 'member' });
                    }, `Invitation sent to ${invite.email.trim()}`);
                  }}
                  className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end"
                >
                  <div>
                    <label className={label}>
                      <Mail className="w-3 h-3 inline mr-1" />
                      Invite by email
                    </label>
                    <input
                      type="email"
                      className={input}
                      value={invite.email}
                      onChange={(e) => setInvite({ ...invite, email: e.target.value })}
                      placeholder="responder@example.com"
                    />
                  </div>
                  <select className={input} value={invite.unitRole} onChange={(e) => setInvite({ ...invite, unitRole: e.target.value as 'unit_admin' | 'member' })}>
                    <option value="unit_admin">Unit admin</option>
                    <option value="member">Member</option>
                  </select>
                  <button type="submit" disabled={busy} className={primary}>
                    Invite
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {editMember && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-neutral-950/50 p-0 sm:p-6" onClick={() => setEditMember(null)}>
          <form
            role="dialog"
            aria-label="Edit account"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              if (!memberForm.full_name.trim()) return;
              run(async () => {
                await repo.editAccountDetails(editMember.id, memberForm.full_name, memberForm.phone);
                await repo.loadDispatchUnits();
                setEditMember(null);
              }, 'Account updated');
            }}
            className="w-full sm:max-w-sm bg-white rounded-t-[24px] sm:rounded-[24px] p-5 sm:p-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-3"
          >
            <h3 className="font-semibold text-base text-neutral-900">Edit account · {editMember.email}</h3>
            <div>
              <label className={label}>Full name</label>
              <input className={input} value={memberForm.full_name} onChange={(e) => setMemberForm({ ...memberForm, full_name: e.target.value })} />
            </div>
            <div>
              <label className={label}>Phone</label>
              <input className={input} inputMode="tel" value={memberForm.phone} onChange={(e) => setMemberForm({ ...memberForm, phone: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setEditMember(null)} className={ghost}>
                Cancel
              </button>
              <button type="submit" disabled={busy} className={primary}>
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
