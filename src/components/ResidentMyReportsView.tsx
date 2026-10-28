import React, { useEffect, useState } from 'react';
import { Clock, MapPin, ShieldCheck, Plus, ChevronDown, Map as MapIcon } from 'lucide-react';

import { IncidentReport, ReportSeverity, StatusHistoryEntry } from '../types';
import { t } from '../lib/i18n';
import { relTime } from '../lib/util';
import { HAZARD_LABELS, classifyHazard } from '../lib/hazards';
import * as repo from '../services/repo';
import { ItemFocus, openable, useFocusItem } from '../hooks/useFocusItem';

// Resident: every report this account filed, newest first, with where it is in
// the workflow (reported, verified, dispatched, resolved) and how many
// neighbours have confirmed it. "View All" on the home screen opens it; tapping
// one report there opens this page on it. Tap a report to read all of it.

// where a report is in the workflow, in order
const STEPS = ['unverified', 'verified', 'dispatched', 'resolved'] as const;

const STATUS: Record<string, { label: string; cls: string }> = {
  unverified: { label: 'Reported', cls: 'bg-red-900 text-white border-red-900' },
  verified: { label: 'Verified', cls: 'bg-red-50 text-red-900 border-red-900/30' },
  dispatched: { label: 'Help on the way', cls: 'bg-amber-50 text-amber-800 border-amber-700/30' },
  resolved: { label: 'Resolved', cls: 'bg-neutral-900 text-white border-neutral-900' },
  rejected: { label: 'Not confirmed', cls: 'bg-neutral-100 text-neutral-500 border-neutral-200' },
};

export const ResidentMyReportsView: React.FC<{
  reports: IncidentReport[];
  onOpenReportModal: () => void;
  focus?: ItemFocus;
  onShowOnMap?: (reportId: string) => void;
}> = ({ reports, onOpenReportModal, focus, onShowOnMap }) => {
  const mine = reports.filter((r) => r.is_mine).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const open = mine.filter((r) => r.status !== 'resolved' && r.status !== 'rejected').length;
  const [expanded, setExpanded] = useState<string | null>(focus?.id ?? null);
  useEffect(() => {
    if (focus) setExpanded(focus.id);
  }, [focus]);
  useFocusItem(focus ? `my-report-${focus.id}` : null, focus?.key);

  return (
    <div className="space-y-5 sm:space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-xs sm:text-sm text-neutral-500">
          {t('Every report you have filed, with its current status.')} {mine.length ? `${open} ${t('still open')}.` : ''}
        </p>
        <button
          type="button"
          onClick={onOpenReportModal}
          className="px-5 py-2.5 rounded-xl bg-red-900 hover:bg-red-800 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-md cursor-pointer active:scale-95"
        >
          <Plus className="w-4 h-4" />
          {t('New Report')}
        </button>
      </div>

      <div className="bg-white rounded-3xl border border-neutral-100/80 overflow-hidden shadow-xl">
        {mine.length ? (
          <ul className="divide-y divide-neutral-100">
            {mine.map((r) => {
              const s = STATUS[r.status] || STATUS.unverified;
              const isOpen = expanded === r.id;
              const reached = STEPS.indexOf(r.status as (typeof STEPS)[number]);
              return (
                <li key={r.id} id={`my-report-${r.id}`} className="scroll-mt-24">
                <div
                  {...openable(() => setExpanded(isOpen ? null : r.id))}
                  aria-expanded={isOpen}
                  className="p-5 sm:p-6 flex flex-wrap sm:flex-nowrap items-start justify-between gap-3 cursor-pointer hover:bg-red-50/30 transition-colors"
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-neutral-900">{r.hazard_type}</span>
                      <span className="font-mono text-[11px] font-semibold text-neutral-400">{r.code}</span>
                    </div>
                    {r.description && <p className={`text-xs text-neutral-600 ${isOpen ? 'whitespace-pre-line' : 'line-clamp-2'}`}>{r.description}</p>}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-neutral-400" />
                        {relTime(r.created_at)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-neutral-400" />
                        {r.barangay_name ? `Brgy. ${r.barangay_name}` : '—'}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5 text-neutral-400" />
                        {r.corroboration_count} {t('confirmed')}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs font-bold uppercase px-3.5 py-1.5 rounded-full border shadow-xs ${s.cls}`}>{t(s.label)}</span>
                    <ChevronDown className={`w-4 h-4 text-neutral-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </div>
                </div>
                {isOpen && (
                  <div className="px-5 sm:px-6 pb-5 sm:pb-6 space-y-4 animate-in fade-in duration-150">
                    {/* progress through the workflow; a rejected report stops at the first step */}
                    {r.status !== 'rejected' && (
                      <ol className="grid grid-cols-4 gap-1.5" aria-label={t('Progress')}>
                        {STEPS.map((step, i) => (
                          <li key={step} className="space-y-1">
                            <span className={`block h-1.5 rounded-full ${i <= reached ? 'bg-red-900' : 'bg-neutral-200'}`} />
                            <span className={`block text-[10px] sm:text-[11px] font-semibold ${i <= reached ? 'text-neutral-800' : 'text-neutral-400'}`}>
                              {t(STATUS[step].label)}
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                    {r.photo_url && (
                      <a href={r.photo_url} target="_blank" rel="noopener noreferrer" className="block w-fit">
                        <img src={r.photo_url} alt={t('Photo you attached')} className="max-h-56 max-w-full rounded-2xl border border-neutral-100 object-cover" />
                      </a>
                    )}
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                      <div className="flex justify-between sm:block gap-3">
                        <dt className="text-neutral-400">{t('Filed')}</dt>
                        <dd className="font-semibold text-neutral-800">{new Date(r.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</dd>
                      </div>
                      {r.verified_by_name && (
                        <div className="flex justify-between sm:block gap-3">
                          <dt className="text-neutral-400">{t('Verified by')}</dt>
                          <dd className="font-semibold text-neutral-800">{r.verified_by_name}</dd>
                        </div>
                      )}
                      {r.resolved_at && (
                        <div className="flex justify-between sm:block gap-3">
                          <dt className="text-neutral-400">{t('Resolved')}</dt>
                          <dd className="font-semibold text-neutral-800">{relTime(r.resolved_at)}</dd>
                        </div>
                      )}
                    </dl>
                    <ReportHistoryAndEdit report={r} />
                    {r.has_location && onShowOnMap && (
                      <button
                        type="button"
                        onClick={() => onShowOnMap(r.id)}
                        className="px-4 py-2.5 rounded-xl border border-neutral-200 bg-white hover:bg-red-50/60 text-neutral-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer active:scale-95"
                      >
                        <MapIcon className="w-4 h-4" />
                        {t('Show on map')}
                      </button>
                    )}
                  </div>
                )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="p-10 text-center">
            <p className="text-sm font-semibold text-neutral-700">{t("You haven't submitted any incident reports yet.")}</p>
            <button type="button" onClick={onOpenReportModal} className="mt-3 text-sm font-bold text-red-900 hover:underline cursor-pointer">
              {t('+ Submit a ground hazard report')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// a citizen may change their report for 15 minutes after filing it (the
// database enforces the same window and keeps the status and barangay fixed)
const EDIT_WINDOW_MS = 15 * 60000;
const URGENCY: { severity: ReportSeverity; label: string }[] = [
  { severity: 'advisory', label: 'Looks Minor' },
  { severity: 'warning', label: 'Getting Worse' },
  { severity: 'emergency', label: 'People at Risk' },
];
const HISTORY_LABEL: Record<string, string> = {
  unverified: 'Reported',
  verified: 'Verified',
  dispatched: 'Help on the way',
  resolved: 'Resolved',
  rejected: 'Not confirmed',
};
const REASON_LABEL: Record<string, string> = {
  auto_corroboration: 'Verified automatically: three neighbours confirmed it',
};

// The report's activity, and the edit form while the 15-minute window is open.
const ReportHistoryAndEdit: React.FC<{ report: IncidentReport }> = ({ report }) => {
  const [history, setHistory] = useState<StatusHistoryEntry[] | null>(null);
  const [now, setNow] = useState(Date.now());
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ hazard: report.hazard_type, severity: report.severity, description: report.description });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    repo.reportHistory(report.id).then((h) => live && setHistory(h));
    return () => {
      live = false;
    };
  }, [report.id, report.status]);

  const left = Date.parse(report.created_at) + EDIT_WINDOW_MS - now;
  const canEdit = report.status === 'unverified' && left > 0;
  // count the window down while it is open
  useEffect(() => {
    if (!canEdit) return;
    const id = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, [canEdit]);
  useEffect(() => {
    if (!canEdit) setEditing(false);
  }, [canEdit]);

  const save = async () => {
    if (!form.description.trim()) {
      setNotice(t('Add a short description before saving.'));
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await repo.editReport(report.id, { hazard_type: form.hazard, severity: form.severity, description: form.description });
      setEditing(false);
      setNotice(t('Your changes were saved.'));
    } catch (e: any) {
      setNotice(e?.message || t('Could not save your changes.'));
    } finally {
      setSaving(false);
    }
  };

  const isOther = classifyHazard(report.hazard_type).key === 'other';
  const field = 'w-full text-sm rounded-xl border border-neutral-200 bg-white p-2.5 focus:outline-hidden focus:border-red-900';

  return (
    <div className="space-y-3">
      {history && history.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-black uppercase tracking-wider text-neutral-400">{t('Activity')}</p>
          <ol className="space-y-1.5 border-l-2 border-neutral-100 pl-3">
            {history.map((h) => (
              <li key={h.id} className="text-xs">
                <span className="font-semibold text-neutral-800">{t(HISTORY_LABEL[h.to_status] || h.to_status)}</span>
                <span className="text-neutral-400"> · {relTime(h.created_at)}</span>
                {(REASON_LABEL[h.reason] || h.note) && (
                  <span className="block text-neutral-500">{REASON_LABEL[h.reason] ? t(REASON_LABEL[h.reason]) : h.note}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {notice && <p role="status" className="text-xs font-semibold text-red-900">{notice}</p>}

      {canEdit && !editing && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setForm({ hazard: report.hazard_type, severity: report.severity, description: report.description });
              setEditing(true);
            }}
            className="px-4 py-2.5 rounded-xl bg-red-900 hover:bg-red-800 text-white text-xs font-bold cursor-pointer active:scale-95"
          >
            {t('Edit this report')}
          </button>
          <span className="text-[11px] text-neutral-500">
            {t('You can edit it for {n} more min.', { n: Math.max(1, Math.ceil(left / 60000)) })}
          </span>
        </div>
      )}
      {!canEdit && report.status === 'unverified' && (
        <p className="text-[11px] text-neutral-400">{t('The 15-minute edit window has closed. An official can still help you.')}</p>
      )}

      {editing && (
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4 space-y-3">
          <label className="block space-y-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-neutral-500">{t('Hazard type')}</span>
            <select className={field} value={form.hazard} disabled={isOther} onChange={(e) => setForm({ ...form, hazard: e.target.value })}>
              {(isOther ? [report.hazard_type] : HAZARD_LABELS.filter((h) => classifyHazard(h).key !== 'other')).map((h) => (
                <option key={h} value={h}>
                  {t(h)}
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-neutral-500">{t('How urgent does it look')}</span>
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {URGENCY.map((u) => (
                <button
                  key={u.severity}
                  type="button"
                  role="radio"
                  aria-checked={form.severity === u.severity}
                  onClick={() => setForm({ ...form, severity: u.severity })}
                  className={`px-3.5 py-2 rounded-full text-xs font-bold border cursor-pointer ${
                    form.severity === u.severity ? 'bg-red-900 text-white border-red-900' : 'bg-white text-neutral-700 border-neutral-200'
                  }`}
                >
                  {t(u.label)}
                </button>
              ))}
            </div>
          </div>
          <label className="block space-y-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-neutral-500">{t('Description')}</span>
            <textarea className={`${field} resize-none`} rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <p className="text-[11px] text-neutral-500">{t('The location and barangay stay as filed.')}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className="px-4 py-2.5 rounded-xl text-xs font-bold text-neutral-700 hover:bg-neutral-100 cursor-pointer">
              {t('Cancel')}
            </button>
            <button type="button" onClick={save} disabled={saving} className="px-4 py-2.5 rounded-xl bg-red-900 hover:bg-red-800 text-white text-xs font-bold cursor-pointer disabled:opacity-60">
              {saving ? t('Saving…') : t('Save changes')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
