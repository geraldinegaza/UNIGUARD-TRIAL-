import React, { useState } from 'react';
import { Compass, Edit3, MapPin } from 'lucide-react';
import { RoadCause, RoadCondition, RoadStatus } from '../types';
import * as repo from '../services/repo';
import { useRepo } from '../hooks/useRepo';
import { canNavigate, classifyCoords, coordMessage, fmtCoords, locate, wazeUrl } from '../lib/geo';
import { DetailModal, DetailRow, DetailTone } from './DetailModal';

// One road status record (reference build "road pin" pop-up): where, why, how
// bad, since when and until when, who last updated it, and Open in Waze. An
// official or the LGU can edit it in place; the change is audit-logged.

const CONDITION: { value: RoadCondition; label: string }[] = [
  { value: 'blocked', label: 'Blocked / impassable' },
  { value: 'one_lane', label: 'One lane / use caution' },
  { value: 'under_repair', label: 'Under repair / clearing' },
  { value: 'passable', label: 'Passable / cleared' },
];
const CONDITION_LABEL = Object.fromEntries(CONDITION.map((c) => [c.value, c.label])) as Record<string, string>;
const CAUSES: { value: RoadCause; label: string }[] = [
  { value: '', label: 'Not specified' },
  { value: 'flood', label: 'Flooding' },
  { value: 'landslide', label: 'Landslide' },
  { value: 'repair', label: 'Road repair' },
  { value: 'accident', label: 'Accident' },
  { value: 'other', label: 'Other' },
];
const SEVERITIES = ['', 'Minor', 'Moderate', 'Major', 'Critical'];

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
// a datetime-local value in the device's time zone
const localInput = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const input = 'w-full text-xs font-medium p-2.5 rounded-xl bg-neutral-50/70 border border-neutral-200 focus:bg-white focus:outline-hidden focus:border-neutral-400';
const lab = 'block text-[10px] font-semibold uppercase tracking-wider mb-1 text-neutral-500';

export const RoadStatusDetail: React.FC<{ roadId: string; tone: DetailTone; canEdit: boolean; onClose: () => void; onSaved?: (msg: string) => void }> = ({
  roadId,
  tone,
  canEdit,
  onClose,
  onSaved,
}) => {
  const { roadStatus } = useRepo();
  const r = roadStatus.find((x) => x.id === roadId);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => toForm(r));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!r) return null;

  const located = r.lat !== null && r.lng !== null;
  const btn = 'inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold cursor-pointer transition-colors disabled:opacity-50';
  const dark = tone === 'barangay' ? 'bg-[#052659] hover:bg-[#011025] text-white' : 'bg-[#18181b] hover:bg-neutral-800 text-white';
  const soft = 'bg-white border border-neutral-200 text-neutral-800 hover:bg-neutral-100';

  const save = async () => {
    setError(null);
    const lat = form.lat.trim() === '' ? null : parseFloat(form.lat);
    const lng = form.lng.trim() === '' ? null : parseFloat(form.lng);
    if ((lat === null) !== (lng === null)) return setError('Enter both latitude and longitude, or leave both empty.');
    if (lat !== null && lng !== null && classifyCoords(lat, lng) !== 'ok') return setError(coordMessage(classifyCoords(lat, lng)).replace('The stored coordinates are', 'These coordinates are'));
    if (!form.road_name.trim()) return setError('The road name is required.');
    setBusy(true);
    try {
      await repo.updateRoadStatus(r.id, {
        road_name: form.road_name.trim(),
        status: form.status,
        note: form.note.trim(),
        segment_from: form.segment_from.trim(),
        segment_to: form.segment_to.trim(),
        cause: form.cause,
        severity: form.severity,
        // a cleared road has no reopening time
        estimated_reopen: form.status === 'passable' || !form.estimated_reopen ? null : new Date(form.estimated_reopen).toISOString(),
        lat,
        lng,
      });
      setEditing(false);
      onSaved?.(`Road status updated: ${form.road_name.trim()}`);
    } catch (e: any) {
      setError(e?.message || 'Could not save the road status.');
    } finally {
      setBusy(false);
    }
  };

  const useMyLocation = async () => {
    try {
      const pos = await locate();
      setForm((f) => ({ ...f, lat: String(pos.lat), lng: String(pos.lng) }));
    } catch (e: any) {
      setError(e?.message || 'Could not read your location.');
    }
  };

  return (
    <DetailModal
      title={r.road_name || 'Road status'}
      subtitle={r.barangay ? `Barangay ${r.barangay}` : 'Municipality-wide'}
      tone={tone}
      onClose={onClose}
      actions={
        editing ? (
          <>
            <button type="button" onClick={() => setEditing(false)} className={`${btn} ${soft}`}>
              Cancel edit
            </button>
            <button type="button" disabled={busy} onClick={save} className={`${btn} ${dark}`}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : (
          <>
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setForm(toForm(r));
                  setError(null);
                  setEditing(true);
                }}
                className={`${btn} ${soft}`}
              >
                <Edit3 className="w-3.5 h-3.5" />
                Edit
              </button>
            )}
            {located && canNavigate(r.lat, r.lng) && (
              <a href={wazeUrl(r.lat as number, r.lng as number)} target="_blank" rel="noopener noreferrer" className={`${btn} ${dark}`}>
                <Compass className="w-3.5 h-3.5" />
                Open in Waze
              </a>
            )}
          </>
        )
      }
    >
      {!editing ? (
        <>
          <span
            className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
              r.status === 'blocked'
                ? 'bg-red-50 text-red-800 border-red-200'
                : r.status === 'passable'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-amber-50 text-amber-800 border-amber-200'
            }`}
          >
            {CONDITION_LABEL[r.status] || r.status}
          </span>
          <div>
            <DetailRow tone={tone} label="Road name" value={r.road_name} />
            <DetailRow tone={tone} label="Barangay" value={r.barangay || 'Municipality-wide'} />
            <DetailRow tone={tone} label="Segment" value={r.segment_from || r.segment_to ? `${r.segment_from || '—'} → ${r.segment_to || '—'}` : ''} />
            <DetailRow tone={tone} label="Cause" value={CAUSES.find((c) => c.value === r.cause)?.label || r.cause} />
            <DetailRow tone={tone} label="Severity" value={r.severity} />
            <DetailRow tone={tone} label="Started" value={when(r.started_at)} />
            <DetailRow tone={tone} label="Estimated reopening" value={r.status === 'passable' ? 'Open' : when(r.estimated_reopen)} />
            <DetailRow tone={tone} label="Last updated" value={[when(r.updated_at), r.updater_name].filter(Boolean).join(' · ')} />
            {r.note && <DetailRow tone={tone} label="Notes" value={r.note} />}
            <DetailRow tone={tone} label="Coordinates" value={located ? fmtCoords(r.lat, r.lng) : ''} />
          </div>
        </>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={lab}>Road name</label>
            <input className={input} value={form.road_name} onChange={(e) => setForm({ ...form, road_name: e.target.value })} />
          </div>
          <div>
            <label className={lab}>Condition</label>
            <select className={input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as RoadCondition })}>
              {CONDITION.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={lab}>Cause</label>
            <select className={input} value={form.cause} onChange={(e) => setForm({ ...form, cause: e.target.value as RoadCause })}>
              {CAUSES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={lab}>Severity</label>
            <select className={input} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s || 'Not specified'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={lab}>Estimated reopening</label>
            <input
              type="datetime-local"
              className={input}
              disabled={form.status === 'passable'}
              value={form.estimated_reopen}
              onChange={(e) => setForm({ ...form, estimated_reopen: e.target.value })}
            />
          </div>
          <div>
            <label className={lab}>Segment from</label>
            <input className={input} value={form.segment_from} onChange={(e) => setForm({ ...form, segment_from: e.target.value })} placeholder="Purok 1" />
          </div>
          <div>
            <label className={lab}>Segment to</label>
            <input className={input} value={form.segment_to} onChange={(e) => setForm({ ...form, segment_to: e.target.value })} placeholder="Highway junction" />
          </div>
          <div className="sm:col-span-2">
            <label className={lab}>Notes / detour</label>
            <textarea className={`${input} resize-none`} rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          <div>
            <label className={lab}>Latitude</label>
            <input className={`${input} font-mono`} inputMode="decimal" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} placeholder="16.0206" />
          </div>
          <div>
            <label className={lab}>Longitude</label>
            <input className={`${input} font-mono`} inputMode="decimal" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} placeholder="120.2306" />
          </div>
          <div className="sm:col-span-2">
            <button type="button" onClick={useMyLocation} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[11px] font-semibold bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-100 cursor-pointer">
              <MapPin className="w-3.5 h-3.5" />
              Use my location
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs font-semibold text-red-700">
          {error}
        </p>
      )}
    </DetailModal>
  );
};

function toForm(r?: RoadStatus) {
  return {
    road_name: r?.road_name || '',
    status: (r?.status || 'blocked') as RoadCondition,
    note: r?.note || '',
    segment_from: r?.segment_from || '',
    segment_to: r?.segment_to || '',
    cause: (r?.cause || '') as RoadCause,
    severity: r?.severity || '',
    estimated_reopen: localInput(r?.estimated_reopen),
    lat: r?.lat != null ? String(r.lat) : '',
    lng: r?.lng != null ? String(r.lng) : '',
  };
}
