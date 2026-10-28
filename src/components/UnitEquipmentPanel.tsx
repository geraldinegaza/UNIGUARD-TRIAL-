import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { DispatchUnit, UnitEquipment } from '../types';
import * as repo from '../services/repo';
import { relTime } from '../lib/util';

// The LGU's view of one unit's equipment, inside the unit window on Dispatch
// Units: register equipment for the unit, correct its details, and retire or
// remove it. Equipment that went out on a dispatch is retired, never deleted,
// so the dispatch history stays whole; deployed equipment cannot be touched
// until its dispatch is done.

const CONDITIONS = ['ready', 'needs_repair', 'missing', 'out_of_service', 'unknown'];
const CONDITION_LABEL: Record<string, string> = {
  ready: 'Ready',
  needs_repair: 'Needs repair',
  missing: 'Missing',
  out_of_service: 'Out of service',
  unknown: 'Unknown',
};
const STATUS_TONE: Record<UnitEquipment['status'], string> = {
  available: 'bg-[#18181b] text-white border-transparent',
  deployed: 'bg-amber-50 text-amber-800 border-amber-200',
  maintenance: 'bg-neutral-100 text-neutral-700 border-neutral-200',
  unavailable: 'bg-neutral-100 text-neutral-400 border-neutral-200 line-through',
};

const input =
  'w-full text-xs font-medium p-3 rounded-xl bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white border border-neutral-200 focus:outline-hidden focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50 transition-all';
const label = 'block text-[10px] font-semibold uppercase tracking-wider mb-1.5 text-neutral-500';
const primary = 'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-medium text-white bg-[#18181b] hover:bg-neutral-800 shadow-xs cursor-pointer disabled:opacity-50 transition-colors';
const ghost = 'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 border border-neutral-200/80 cursor-pointer disabled:opacity-50 transition-colors';
const iconBtn = 'w-8 h-8 rounded-full inline-flex items-center justify-center text-neutral-500 hover:bg-neutral-100 cursor-pointer disabled:opacity-40';

type Form = { catalogId: string; customLabel: string; identifier: string; condition: string; notes: string };
const blank: Form = { catalogId: '', customLabel: '', identifier: '', condition: 'unknown', notes: '' };

export const UnitEquipmentPanel: React.FC<{ unit: DispatchUnit; onNotice: (msg: string) => void }> = ({ unit, onNotice }) => {
  const [items, setItems] = useState<UnitEquipment[] | null>(null);
  const [catalog, setCatalog] = useState<{ id: string; label: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 'new', an item being edited, or nothing
  const [editing, setEditing] = useState<'new' | UnitEquipment | null>(null);
  const [form, setForm] = useState<Form>(blank);
  // the item whose Retire / remove choice is open, with how many dispatches used it
  const [removing, setRemoving] = useState<{ item: UnitEquipment; uses: number | null } | null>(null);

  const reload = () =>
    repo
      .loadUnitEquipment(unit.id)
      .then((list) => {
        setItems(list);
        setError(null);
      })
      .catch((e: any) => setError(e?.message || 'Could not load the equipment.'));

  useEffect(() => {
    setItems(null);
    setEditing(null);
    setRemoving(null);
    reload();
    repo
      .loadEquipmentCatalog(unit.unit_type)
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, [unit.id]);

  const nameOf = (e: UnitEquipment) => e.label || catalog.find((c) => c.id === e.catalog_id)?.label || 'Equipment';

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      await reload();
      onNotice(ok);
      return true;
    } catch (e: any) {
      onNotice(e?.message || 'Something went wrong.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openNew = () => {
    setForm({ ...blank, catalogId: catalog[0]?.id || '' });
    setEditing('new');
  };
  const openEdit = (e: UnitEquipment) => {
    setForm({ catalogId: e.catalog_id || '', customLabel: e.label, identifier: e.identifier, condition: e.condition || 'unknown', notes: e.notes });
    setEditing(e);
  };

  const save = async () => {
    if (!form.identifier.trim()) {
      onNotice('Give the equipment an identifier, for example "Fire Truck #2".');
      return;
    }
    const custom = !form.catalogId;
    if (editing === 'new' && custom && !form.customLabel.trim()) {
      onNotice('Name the equipment type, or pick one from the list.');
      return;
    }
    const ok =
      editing === 'new'
        ? await run(
            () => repo.addEquipment({ catalogId: form.catalogId || null, customLabel: form.customLabel, identifier: form.identifier, condition: form.condition, notes: form.notes }, unit.id),
            'Equipment added'
          )
        : await run(
            () =>
              repo.updateEquipment((editing as UnitEquipment).id, {
                customLabel: (editing as UnitEquipment).catalog_id ? null : form.customLabel,
                identifier: form.identifier,
                condition: form.condition,
                notes: form.notes,
              }),
            'Equipment updated'
          );
    if (ok) setEditing(null);
  };

  const askRemove = (item: UnitEquipment) => {
    setRemoving({ item, uses: null });
    if (item.status === 'deployed') return;
    repo
      .equipmentUseCount(item.id)
      .then((uses) => setRemoving((cur) => (cur && cur.item.id === item.id ? { item, uses } : cur)))
      .catch(() => setRemoving((cur) => (cur && cur.item.id === item.id ? { item, uses: 1 } : cur)));
  };

  return (
    <div className="pt-4 border-t border-neutral-100 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Equipment{items ? ` · ${items.length}` : ''}
        </h4>
        {!editing && (
          <button type="button" onClick={openNew} className={ghost}>
            <Plus className="w-4 h-4" />
            Add equipment
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-700 bg-red-50 rounded-xl px-3 py-2">{error}</p>}
      {!items && !error && <p className="text-xs text-neutral-400">Loading equipment…</p>}
      {items && items.length === 0 && !editing && <p className="text-xs text-neutral-400">No equipment registered for this unit yet.</p>}

      {items && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((e) => (
            <li key={e.id} className="flex items-center gap-3 rounded-2xl border border-neutral-200/70 px-3.5 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-neutral-900 truncate">{e.identifier || nameOf(e)}</span>
                <span className="block text-[11px] text-neutral-500 truncate">
                  {[nameOf(e), CONDITION_LABEL[e.condition] || e.condition, e.last_checked_at ? `checked ${relTime(e.last_checked_at)}` : 'never checked']
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${STATUS_TONE[e.status]}`}>{e.status}</span>
              <button type="button" disabled={busy} onClick={() => openEdit(e)} className={iconBtn} aria-label={`Edit ${e.identifier || nameOf(e)}`}>
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button type="button" disabled={busy} onClick={() => askRemove(e)} className={iconBtn} aria-label={`Retire or remove ${e.identifier || nameOf(e)}`}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* retire or remove one item */}
      {removing && (
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold text-neutral-900">
              {removing.item.status === 'deployed' ? 'Cannot remove' : 'Retire or remove'} · {removing.item.identifier || nameOf(removing.item)}
            </p>
            <button type="button" onClick={() => setRemoving(null)} className={iconBtn} aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[11px] text-neutral-600 leading-relaxed">
            {removing.item.status === 'deployed'
              ? 'This equipment is out on a dispatch. Mark that dispatch done (which releases it) before retiring or removing it.'
              : removing.uses === null
              ? 'Checking its dispatch history…'
              : removing.uses > 0
              ? `It was used in ${removing.uses} ${removing.uses === 1 ? 'dispatch' : 'dispatches'}. Deleting it would erase that history, so retire it instead: it stays in the list, marked unavailable.`
              : 'It was never used on a dispatch. Remove it permanently, or retire it: it stays in the list, marked unavailable.'}
          </p>
          {removing.item.status !== 'deployed' && removing.uses !== null && (
            <div className="flex flex-wrap gap-2">
              {removing.item.status !== 'unavailable' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (await run(() => repo.removeEquipment(removing.item.id, true), 'Equipment retired')) setRemoving(null);
                  }}
                  className={primary}
                >
                  Retire
                </button>
              )}
              {removing.uses === 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (await run(() => repo.removeEquipment(removing.item.id, false), 'Equipment removed')) setRemoving(null);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-medium bg-red-600 hover:bg-red-700 text-white cursor-pointer disabled:opacity-50"
                >
                  Remove permanently
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* add or edit */}
      {editing && (
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4 space-y-3">
          <p className="text-xs font-semibold text-neutral-900">{editing === 'new' ? `Add equipment to ${unit.name}` : `Edit ${editing.identifier || nameOf(editing)}`}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className={label}>Type</label>
              {editing === 'new' ? (
                <select className={input} value={form.catalogId} onChange={(e) => setForm({ ...form, catalogId: e.target.value })}>
                  {catalog.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                  <option value="">Other (type a name)</option>
                </select>
              ) : (
                <input className={input} value={nameOf(editing)} disabled />
              )}
            </div>
            {!form.catalogId && (
              <div className="sm:col-span-2">
                <label className={label}>Equipment name</label>
                <input className={input} value={form.customLabel} onChange={(e) => setForm({ ...form, customLabel: e.target.value })} placeholder="e.g. Portable pump" />
              </div>
            )}
            <div>
              <label className={label}>Identifier</label>
              <input className={input} value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} placeholder="e.g. Fire Truck #2" />
            </div>
            <div>
              <label className={label}>Condition</label>
              <select className={input} value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {CONDITION_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={label}>Notes</label>
              <textarea className={`${input} resize-none`} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          {editing !== 'new' && <p className="text-[11px] text-neutral-500">The owner and type cannot be changed. Retire it and add a new one instead.</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} className={ghost}>
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={save} className={primary}>
              {busy ? (editing === 'new' ? 'Adding…' : 'Saving…') : editing === 'new' ? 'Add' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
