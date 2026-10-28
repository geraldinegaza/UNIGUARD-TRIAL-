import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Boxes, ClipboardList, Download, Edit3, PackageMinus, Plus, Trash2, X } from 'lucide-react';
import { Barangay, InventoryCategory, InventoryItem, User } from '../types';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import { exportPdf, fileStamp } from '../lib/pdf';
import { DetailBar, DetailModal, DetailRow } from './DetailModal';
import { opsTone, shortWhen } from './opsTone';

// Relief stock on hand (relief_inventory) and the goods handed out
// (relief_distribution_log). The LDRRMO keeps the inventory; a barangay
// official sees it and records what their barangay received. Recording a
// distribution lowers the stock on the server (log_relief_distribution, 151).
const CATEGORIES: InventoryCategory[] = ['Food', 'Water', 'Medical', 'Equipment', 'Shelter Supplies', 'Hygiene'];

const blankItem = { name: '', category: 'Food' as InventoryCategory, unit: 'packs', stock: '0', reorder: '0', location: '', supplier: '' };

export const ReliefStockPanel: React.FC<{ currentUser: User; barangays: Barangay[] }> = ({ currentUser, barangays }) => {
  const isBarangay = currentUser.role === 'barangay';
  const canManage = !isBarangay;
  const t = opsTone(isBarangay);
  const { inventory, distributionLog } = useRepo();

  const [view, setView] = useState<'stock' | 'log'>('stock');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState<InventoryItem | 'new' | null>(null);
  const [form, setForm] = useState(blankItem);
  const [distributing, setDistributing] = useState<InventoryItem | null>(null);
  // Details: one stock item (reference build "inv-detail")
  const [detailId, setDetailId] = useState<string | null>(null);
  const [qty, setQty] = useState('1');
  const [family, setFamily] = useState('');
  const [toBarangay, setToBarangay] = useState(currentUser.barangay_name || '');

  useEffect(() => {
    repo.loadInventory().then(
      () => setLoadError(null),
      (e) => setLoadError(e.message || 'Could not load the relief inventory')
    );
  }, []);

  const flash = (m: string) => {
    setNotice(m);
    setTimeout(() => setNotice(null), 4000);
  };

  const low = useMemo(() => inventory.filter((i) => i.stock <= i.reorder), [inventory]);
  const grouped = useMemo(() => {
    const map: Record<string, InventoryItem[]> = {};
    inventory.forEach((i) => (map[i.category] = map[i.category] || []).push(i));
    return CATEGORIES.filter((c) => map[c]).map((c) => ({ category: c, items: map[c] }));
  }, [inventory]);

  const openEditor = (item: InventoryItem | 'new') => {
    setEditing(item);
    setForm(
      item === 'new'
        ? blankItem
        : {
            name: item.name,
            category: item.category,
            unit: item.unit,
            stock: String(item.stock),
            reorder: String(item.reorder),
            location: item.location,
            supplier: item.supplier,
          }
    );
  };

  const saveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || busy) return;
    if (!form.name.trim()) return flash('Name the item');
    setBusy(true);
    try {
      await repo.saveInventoryItem(editing === 'new' ? null : editing.id, {
        name: form.name.trim(),
        category: form.category,
        unit: form.unit.trim() || 'units',
        stock: Number(form.stock) || 0,
        reorder: Number(form.reorder) || 0,
        location: form.location.trim(),
        supplier: form.supplier.trim(),
      });
      flash(editing === 'new' ? `${form.name.trim()} added to the inventory` : `${form.name.trim()} updated`);
      setEditing(null);
    } catch (err: any) {
      flash(err.message || 'Could not save the item');
    } finally {
      setBusy(false);
    }
  };

  const removeItem = async (item: InventoryItem) => {
    if (!window.confirm(`Remove ${item.name} from the inventory? Past distributions keep their record.`)) return;
    try {
      await repo.deleteInventoryItem(item.id);
      flash(`${item.name} removed`);
    } catch (err: any) {
      flash(err.message || 'Could not remove the item');
    }
  };

  const openDistribute = (item: InventoryItem) => {
    setDistributing(item);
    setQty('1');
    setFamily('');
    setToBarangay(currentUser.barangay_name || (barangays[0] ? barangays[0].name : ''));
  };

  const saveDistribution = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!distributing || busy) return;
    const n = Math.round(Number(qty));
    if (!n || n <= 0) return flash('Enter a quantity above zero');
    if (n > distributing.stock) return flash(`Only ${distributing.stock} ${distributing.unit} left`);
    setBusy(true);
    try {
      await repo.logDistribution({ item_id: distributing.id, qty: n, barangay: toBarangay, family: family.trim() });
      flash(`${n} ${distributing.unit} of ${distributing.name} recorded for ${toBarangay}`);
      setDistributing(null);
    } catch (err: any) {
      flash(err.message || 'Could not record the distribution');
    } finally {
      setBusy(false);
    }
  };

  // both lists export as formatted PDFs, like every other export in the console
  const exportLog = () =>
    exportPdf({
      title: 'Relief Distribution Log',
      meta: [`${distributionLog.length} ${distributionLog.length === 1 ? 'record' : 'records'}`],
      filename: `uniguard-distribution-log-${fileStamp()}.pdf`,
      landscape: true,
      signer: currentUser.full_name,
      sections: [
        {
          title: 'Goods handed out',
          head: ['When', 'Item', 'Quantity', 'Barangay', 'Family / recipient', 'Recorded by'],
          rows: distributionLog.map((d) => [
            d.distributed_at ? new Date(d.distributed_at).toLocaleString() : '',
            d.item_name,
            d.qty,
            d.barangay,
            d.family,
            d.distributed_by,
          ]),
        },
      ],
    });
  const exportInventory = () =>
    exportPdf({
      title: 'Relief Inventory',
      meta: [`${inventory.length} ${inventory.length === 1 ? 'item' : 'items'} · ${low.length} at or below reorder level`],
      filename: `uniguard-inventory-${fileStamp()}.pdf`,
      signer: currentUser.full_name,
      sections: [
        {
          title: 'Stock on hand',
          head: ['Item', 'Category', 'Stock', 'Reorder at', 'Location', 'Supplier'],
          rows: inventory.map((i) => [i.name, i.category, `${i.stock} ${i.unit}`, `${i.reorder} ${i.unit}`, i.location, i.supplier]),
        },
      ],
    });

  const totalUnits = inventory.reduce((n, i) => n + i.stock, 0);

  return (
    <section className={t.card} aria-label="Relief stock">
      <div className={`${t.head} flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <Boxes className={`w-4 h-4 shrink-0 ${t.ink}`} />
          <h2 className={t.h2}>Relief Stock & Distribution Log</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className={`flex items-center gap-1 rounded-full p-1 text-xs font-medium border ${t.tabs}`} role="tablist">
            <button role="tab" aria-selected={view === 'stock'} onClick={() => setView('stock')} className={`px-3 py-1 rounded-full cursor-pointer transition-colors ${view === 'stock' ? t.tabOn : t.tabOff}`}>
              Inventory
            </button>
            <button role="tab" aria-selected={view === 'log'} onClick={() => setView('log')} className={`px-3 py-1 rounded-full cursor-pointer transition-colors ${view === 'log' ? t.tabOn : t.tabOff}`}>
              Distribution log
            </button>
          </div>
          {view === 'stock' && canManage && (
            <button onClick={() => openEditor('new')} className={t.primary}>
              <Plus className="w-3.5 h-3.5" />
              <span>Add item</span>
            </button>
          )}
          {view === 'stock' && inventory.length > 0 && (
            <button onClick={exportInventory} className={t.ghost}>
              <Download className="w-3.5 h-3.5" />
              <span>Export PDF</span>
            </button>
          )}
          {view === 'log' && distributionLog.length > 0 && (
            <button onClick={exportLog} className={t.ghost}>
              <Download className="w-3.5 h-3.5" />
              <span>Export PDF</span>
            </button>
          )}
        </div>
      </div>

      {notice && <div className={`px-5 sm:px-6 py-2.5 text-xs font-medium border-b ${t.border} ${t.ink}`}>{notice}</div>}
      {loadError && (
        <div className="px-5 sm:px-6 py-3 text-xs text-amber-900 bg-amber-50 border-b border-amber-200">
          {loadError.replace(/\.$/, "")}. The relief tables come with the upgrade (migrations 141 and 151).
        </div>
      )}

      {view === 'stock' ? (
        <div className="p-4 sm:p-6 space-y-4">
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className={t.pill}>{inventory.length} items</span>
            <span className={t.pill}>{totalUnits.toLocaleString()} units on hand</span>
            {low.length > 0 && (
              <span className="px-3 py-1 rounded-full font-mono font-medium bg-amber-50 text-amber-900 border border-amber-200">{low.length} low</span>
            )}
          </div>

          {low.length > 0 && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="text-xs leading-relaxed min-w-0">
                <span className="font-semibold">At or below the reorder point: </span>
                {low.slice(0, 4).map((i) => `${i.name} (${i.stock} ${i.unit})`).join(' · ')}
                {low.length > 4 ? ` · +${low.length - 4} more` : ''}
              </div>
            </div>
          )}

          {inventory.length === 0 && !loadError ? (
            <p className={`text-xs py-8 text-center ${t.muted}`}>
              {canManage ? 'No items yet. Add the goods the LDRRMO keeps in its warehouses.' : 'The LDRRMO has not listed any relief stock yet.'}
            </p>
          ) : (
            grouped.map((g) => (
              <div key={g.category} className="space-y-2">
                <h3 className={`text-[11px] font-semibold uppercase tracking-wider ${t.muted}`}>{g.category}</h3>
                <ul className={`rounded-2xl border ${t.border} divide-y ${t.divide}`}>
                  {g.items.map((i) => {
                    const isLow = i.stock <= i.reorder;
                    const pct = i.reorder > 0 ? Math.min(100, Math.round((i.stock / (i.reorder * 2)) * 100)) : 100;
                    return (
                      <li key={i.id} className="px-3.5 sm:px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <button
                              type="button"
                              onClick={() => setDetailId(i.id)}
                              className={`text-xs font-semibold underline-offset-2 hover:underline cursor-pointer text-left ${t.ink}`}
                            >
                              {i.name}
                            </button>
                            <span className={`text-[11px] ${t.muted}`}>{[i.location, i.supplier].filter(Boolean).join(' · ')}</span>
                          </div>
                          <div className={`mt-1.5 h-1.5 rounded-full overflow-hidden border ${t.track}`}>
                            <div className={`h-full rounded-full ${isLow ? 'bg-amber-500' : t.bar}`} style={{ width: `${Math.max(pct, i.stock > 0 ? 4 : 0)}%` }} />
                          </div>
                        </div>
                        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                          <span className={`text-xs font-mono tabular-nums ${isLow ? 'text-amber-800 font-semibold' : t.ink}`}>
                            {i.stock.toLocaleString()} {i.unit}
                            <span className={`ml-1 font-normal ${t.faint}`}>/ reorder {i.reorder}</span>
                          </span>
                          <div className="flex items-center gap-1">
                            <button onClick={() => openDistribute(i)} disabled={i.stock <= 0} className={`${t.ghost} !px-3 !py-1.5 !min-h-[32px]`} title="Record goods handed out">
                              <PackageMinus className="w-3.5 h-3.5" />
                              <span>Distribute</span>
                            </button>
                            {canManage && (
                              <>
                                <button onClick={() => openEditor(i)} className={`w-8 h-8 rounded-full inline-flex items-center justify-center cursor-pointer ${t.muted} hover:bg-neutral-100`} title="Edit or restock" aria-label={`Edit ${i.name}`}>
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => removeItem(i)} className={`w-8 h-8 rounded-full inline-flex items-center justify-center cursor-pointer ${t.muted} hover:bg-neutral-100`} title="Remove item" aria-label={`Remove ${i.name}`}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="p-4 sm:p-6">
          {distributionLog.length === 0 ? (
            <p className={`text-xs py-8 text-center ${t.muted}`}>No distributions recorded yet. Use Distribute on an inventory item.</p>
          ) : (
            <ul className={`rounded-2xl border ${t.border} divide-y ${t.divide}`}>
              {distributionLog.map((d) => (
                <li key={d.id} className="px-3.5 sm:px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                  <ClipboardList className={`hidden sm:block w-4 h-4 shrink-0 ${t.faint}`} />
                  <div className="min-w-0 flex-1">
                    <div className={`text-xs font-semibold ${t.ink}`}>
                      {d.qty.toLocaleString()} × {d.item_name || 'Removed item'}
                      <span className={`font-normal ${t.muted}`}> to {d.barangay}</span>
                    </div>
                    <div className={`text-[11px] ${t.muted} break-words`}>
                      {[d.family, d.distributed_by && `recorded by ${d.distributed_by}`].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <span className={`text-[11px] font-mono shrink-0 ${t.faint}`}>{shortWhen(d.distributed_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Add / edit an item (LDRRMO) */}
      {editing && (
        <div className={`fixed inset-0 z-50 ${t.modalBack} flex items-center justify-center p-4`}>
          <form onSubmit={saveItem} className={`bg-white rounded-[24px] max-w-lg w-full max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 shadow-2xl border ${t.modal} space-y-4`}>
            <div className={`flex items-center justify-between pb-3 border-b ${t.border}`}>
              <h3 className={`font-semibold text-base ${t.ink}`}>{editing === 'new' ? 'Add Inventory Item' : 'Edit or Restock Item'}</h3>
              <button type="button" onClick={() => setEditing(null)} className={`cursor-pointer ${t.muted}`} aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div>
              <label className={t.label}>Item name</label>
              <input className={t.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Family Food Pack" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={t.label}>Category</label>
                <select className={t.input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as InventoryCategory })}>
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={t.label}>Unit</label>
                <input className={t.input} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="packs" />
              </div>
              <div>
                <label className={t.label}>Stock on hand</label>
                <input className={t.input} type="number" min={0} inputMode="numeric" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
              </div>
              <div>
                <label className={t.label}>Reorder at</label>
                <input className={t.input} type="number" min={0} inputMode="numeric" value={form.reorder} onChange={(e) => setForm({ ...form, reorder: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={t.label}>Storage location</label>
                <input className={t.input} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="MDRRMO Warehouse A" />
              </div>
              <div>
                <label className={t.label}>Supplier</label>
                <input className={t.input} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} placeholder="DSWD Field Office" />
              </div>
            </div>
            <div className={`flex justify-end gap-2 pt-3 border-t ${t.border}`}>
              <button type="button" onClick={() => setEditing(null)} className={t.ghost}>
                Cancel
              </button>
              <button type="submit" disabled={busy} className={t.primary}>
                {busy ? 'Saving…' : 'Save item'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Record a distribution */}
      {distributing && (
        <div className={`fixed inset-0 z-50 ${t.modalBack} flex items-center justify-center p-4`}>
          <form onSubmit={saveDistribution} className={`bg-white rounded-[24px] max-w-md w-full max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 shadow-2xl border ${t.modal} space-y-4`}>
            <div className={`flex items-center justify-between pb-3 border-b ${t.border}`}>
              <div className="min-w-0">
                <h3 className={`font-semibold text-base ${t.ink}`}>Record Distribution</h3>
                <p className={`text-xs ${t.muted}`}>
                  {distributing.name} · {distributing.stock} {distributing.unit} in stock
                </p>
              </div>
              <button type="button" onClick={() => setDistributing(null)} className={`cursor-pointer ${t.muted}`} aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={t.label}>Quantity ({distributing.unit})</label>
                <input className={t.input} type="number" min={1} max={distributing.stock} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div>
                <label className={t.label}>Barangay</label>
                {isBarangay ? (
                  <input className={t.input} value={toBarangay} readOnly />
                ) : (
                  <select className={t.input} value={toBarangay} onChange={(e) => setToBarangay(e.target.value)}>
                    {barangays.map((b) => (
                      <option key={b.id}>{b.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            <div>
              <label className={t.label}>Family or recipient (optional)</label>
              <input className={t.input} value={family} onChange={(e) => setFamily(e.target.value)} placeholder="Dela Cruz household, or 42 families at the covered court" />
            </div>
            <p className={`text-[11px] ${t.muted}`}>Saving lowers the stock by the quantity given.</p>
            <div className={`flex justify-end gap-2 pt-3 border-t ${t.border}`}>
              <button type="button" onClick={() => setDistributing(null)} className={t.ghost}>
                Cancel
              </button>
              <button type="submit" disabled={busy} className={t.primary}>
                {busy ? 'Saving…' : 'Record'}
              </button>
            </div>
          </form>
        </div>
      )}
      {detailId && (() => {
        const item = inventory.find((x) => x.id === detailId);
        if (!item) return null;
        const out = item.stock <= 0;
        const lowStock = item.stock <= item.reorder;
        const state = out ? 'Out of stock' : lowStock ? 'Low stock' : 'In stock';
        const color = out ? '#B91C1C' : lowStock ? '#D97706' : '#15803D';
        const pct = item.reorder > 0 ? Math.min(100, Math.round((item.stock / Math.max(item.reorder * 2, 1)) * 100)) : 100;
        const tone = isBarangay ? 'barangay' : 'staff';
        return (
          <DetailModal
            title={item.name}
            subtitle={item.category}
            tone={tone}
            onClose={() => setDetailId(null)}
            actions={
              <>
                <button
                  type="button"
                  disabled={item.stock <= 0}
                  onClick={() => {
                    setDetailId(null);
                    openDistribute(item);
                  }}
                  className={t.ghost}
                >
                  <PackageMinus className="w-3.5 h-3.5" />
                  <span>Distribute</span>
                </button>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => {
                      setDetailId(null);
                      openEditor(item);
                    }}
                    className={t.primary}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit / Restock</span>
                  </button>
                )}
              </>
            }
          >
            <div className="flex items-center justify-between gap-3">
              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border" style={{ color, borderColor: `${color}55`, background: `${color}14` }}>
                {state}
              </span>
              <span className="text-xs font-mono text-neutral-600">
                {item.stock} / {item.reorder} {item.unit}
              </span>
            </div>
            <DetailBar pct={pct} color={color} />
            <div>
              <DetailRow tone={tone} label="Item name" value={item.name} />
              <DetailRow tone={tone} label="Category" value={item.category} />
              <DetailRow tone={tone} label="Unit of measure" value={item.unit} />
              <DetailRow tone={tone} label="In stock" value={`${item.stock.toLocaleString()} ${item.unit}`} />
              <DetailRow tone={tone} label="Reorder threshold" value={`${item.reorder.toLocaleString()} ${item.unit}`} />
              <DetailRow tone={tone} label="Warehouse location" value={item.location} />
              <DetailRow tone={tone} label="Supplier" value={item.supplier} />
              <DetailRow tone={tone} label="Last updated" value={item.updated_at ? new Date(item.updated_at).toLocaleString() : ''} />
            </div>
          </DetailModal>
        );
      })()}
    </section>
  );
};
