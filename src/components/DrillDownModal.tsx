import React, { useState, useEffect } from 'react';
import { corroborationText } from '../lib/util';
import {
  X,
  AlertTriangle,
  MapPin,
  Clock,
  ShieldCheck,
  CheckCircle2,
  Users,
  Eye,
  Filter,
  ExternalLink,
  Building2,
  PhoneCall
} from 'lucide-react';
import { IncidentReport, Barangay } from '../types';
import * as repo from '../services/repo';
import { CONFIG } from '../lib/config';

export interface DrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  filterType: string;
  filterValue: string;
  reports: IncidentReport[];
  barangays: Barangay[];
  onReportUpdated?: () => void;
  /** false for the Super Admin, who may not verify reports */
  canVerify?: boolean;
  /** LDRRMO staff verify through lgu_verify_report (records who verified) */
  isLgu?: boolean;
  /** opens the incident queue's dispatch form for this report */
  onDispatch?: (report: IncidentReport) => void;
}

const FILTER_TITLE: Record<string, string> = {
  active_incidents: 'Reports this week',
  verified_share: 'Verified reports',
  corroboration_rate: 'Reached three confirmations',
  open_incidents: 'Open incidents',
  hazard: 'Hazard',
  barangay: 'Barangay',
  urgency: 'Urgency',
  active_hazards: 'Active hazards',
  verified_reports: 'Verified reports',
};

export const DrillDownModal: React.FC<DrillDownModalProps> = ({
  isOpen,
  onClose,
  filterType,
  filterValue,
  reports,
  barangays,
  onReportUpdated,
  canVerify = true,
  isLgu = false,
  onDispatch,
}) => {
  const [selectedIncident, setSelectedIncident] = useState<IncidentReport | null>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Filter reports. The analytics cards open it with a filter type and the
  // value 'all', so the type decides; a value narrows further.
  const weekAgo = Date.now() - 7 * 86400000;
  const filteredReports = reports.filter((r) => {
    if (filterType === 'active_incidents') return Date.parse(r.created_at) >= weekAgo;
    if (filterType === 'verified_share') return r.status === 'verified' || r.status === 'dispatched' || r.status === 'resolved';
    if (filterType === 'corroboration_rate') return r.corroboration_count >= CONFIG.CORROBORATION_THRESHOLD;
    if (filterType === 'open_incidents') return r.status !== 'resolved' && r.status !== 'rejected';
    if (!filterValue || filterValue === 'all') return true;
    if (filterType === 'hazard') {
      return r.hazard_type.toLowerCase().includes(filterValue.toLowerCase());
    }
    if (filterType === 'barangay') {
      return r.barangay_id.toLowerCase() === filterValue.toLowerCase();
    }
    if (filterType === 'urgency') {
      return (r.urgency || '').toLowerCase().includes(filterValue.toLowerCase());
    }
    if (filterType === 'active_hazards') {
      return r.status !== 'resolved';
    }
    if (filterType === 'verified_reports') {
      return r.status === 'verified' || r.status === 'dispatched';
    }
    return true;
  });

  const activeRecord = selectedIncident || filteredReports[0] || null;

  // The server allows one step at a time: reported -> verified -> dispatched -> resolved
  const NEXT_STATUS: Record<string, string | undefined> = {
    unverified: 'verified',
    verified: 'dispatched',
    dispatched: 'resolved',
  };

  const handleUpdateStatus = async (reportId: string, status: 'verified' | 'dispatched' | 'resolved') => {
    try {
      if (status === 'verified' && isLgu) await repo.lguVerify(reportId, 'Verified from the drill-down panel');
      else await repo.advanceStatus(reportId, status, 'Updated from the drill-down panel');
      if (onReportUpdated) onReportUpdated();
      if (activeRecord && activeRecord.id === reportId) {
        setSelectedIncident({ ...activeRecord, status });
      }
    } catch (err: any) {
      window.alert(err.message || 'Could not update the incident.');
    }
  };

  const getBarangayName = (id: string) => {
    const b = barangays.find((x) => x.id === id);
    return b ? b.name : id;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl border border-slate-100 shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-rose-50 text-[#991B1B] flex items-center justify-center">
              <Filter className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-slate-900 tracking-tight">
                  Detailed Incident Inspection & Triage
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-[#991B1B] uppercase">
                  {FILTER_TITLE[filterType] || filterType}
                  {filterValue && filterValue !== 'all' ? `: ${filterValue}` : ''}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {filteredReports.length} matching ground observations recorded in Lingayen
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-200/70 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-12">
          {/* Records List (Left) */}
          <div className="md:col-span-5 border-r border-slate-100 overflow-y-auto p-4 space-y-2 max-h-[60vh] md:max-h-none">
            {filteredReports.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <ShieldCheck className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                <p className="text-xs font-semibold">No incidents found in this category.</p>
              </div>
            ) : (
              filteredReports.map((report, idx) => {
                const isSelected = activeRecord?.id === report.id;
                return (
                  <div
                    key={report.id}
                    onClick={() => setSelectedIncident(report)}
                    className={`p-3 rounded-2xl border transition-all cursor-pointer text-left ${
                      isSelected
                        ? 'border-[#991B1B] bg-rose-50/50 shadow-xs'
                        : 'border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-extrabold text-[#991B1B] tracking-tight">
                        {report.code || 'Pending code'}
                      </span>
                      <span
                        className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase ${
                          report.status === 'resolved'
                            ? 'bg-zinc-800 text-white'
                            : report.status === 'dispatched'
                            ? 'bg-zinc-200 text-zinc-900'
                            : report.status === 'verified'
                            ? 'bg-zinc-100 text-zinc-800 border border-zinc-300'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {report.status}
                      </span>
                    </div>

                    <p className="font-bold text-xs text-slate-900 capitalize">
                      {report.hazard_type.replace('_', ' ')}
                    </p>
                    <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">
                      {report.description}
                    </p>

                    <div className="mt-2 pt-2 border-t border-slate-100/80 flex items-center justify-between text-[10px] text-slate-400 font-semibold">
                      <span>{getBarangayName(report.barangay_id)}</span>
                      <span>{corroborationText(report.corroboration_count || 0)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Detailed Inspector Pane (Right) */}
          <div className="md:col-span-7 p-5 overflow-y-auto max-h-[60vh] md:max-h-none flex flex-col justify-between">
            {activeRecord ? (
              <div className="space-y-4">
                {/* Photo Preview if available */}
                {activeRecord.photo_url ? (
                  <div className="rounded-2xl overflow-hidden h-44 w-full bg-slate-100 border border-slate-200 relative group">
                    <img
                      src={activeRecord.photo_url}
                      alt={activeRecord.hazard_type}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent flex items-end p-3">
                      <span className="text-white text-xs font-bold flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-rose-300" />
                        <span>{getBarangayName(activeRecord.barangay_id)}, Lingayen</span>
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl h-24 w-full bg-rose-50/70 border border-rose-100 flex items-center justify-center text-rose-700 gap-2">
                    <AlertTriangle className="w-5 h-5 text-[#991B1B]" />
                    <span className="text-xs font-bold">No photo attached to this report</span>
                  </div>
                )}

                {/* Header Information */}
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-[#991B1B] uppercase tracking-wider">
                      {activeRecord.urgency || 'High'} Severity
                    </span>
                    <span className="text-xs text-slate-400 font-medium">
                      {new Date(activeRecord.created_at).toLocaleString()}
                    </span>
                  </div>
                  <h4 className="text-lg font-black text-slate-900 mt-1 capitalize">
                    {activeRecord.hazard_type.replace('_', ' ')} Hazard
                  </h4>
                  <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                    {activeRecord.description}
                  </p>
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <p className="text-[10px] text-slate-400 uppercase font-bold">Location & GPS</p>
                    <p className="font-bold text-slate-800 mt-0.5">
                      {getBarangayName(activeRecord.barangay_id)}
                    </p>
                    <p className="text-[10px] text-slate-500 tabular-nums">
                      {activeRecord.latitude.toFixed(4)}, {activeRecord.longitude.toFixed(4)}
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <p className="text-[10px] text-slate-400 uppercase font-bold">Crowd Corroboration</p>
                    <p className="font-bold text-slate-800 mt-0.5 flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-slate-700" />
                      <span>{corroborationText(activeRecord.corroboration_count || 0)}</span>
                    </p>
                    <p className="text-[10px] text-slate-600 font-semibold">
                      {(activeRecord.corroboration_count || 0) >= CONFIG.CORROBORATION_THRESHOLD
                        ? 'Confirmation threshold reached'
                        : `${CONFIG.CORROBORATION_THRESHOLD - (activeRecord.corroboration_count || 0)} more needed to reach the threshold`}
                    </p>
                  </div>
                </div>

                {/* Status Triage Controls */}
                <div className="pt-3 border-t border-slate-100">
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                    MDRRMO Triage & Dispatch Action
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => handleUpdateStatus(activeRecord.id, 'verified')}
                      disabled={NEXT_STATUS[activeRecord.status] !== 'verified' || !canVerify}
                      title={NEXT_STATUS[activeRecord.status] === 'verified' ? undefined : 'Status moves one step at a time'}
                      className={`py-2 px-3 rounded-xl font-bold text-xs transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 ${
                        activeRecord.status === 'verified'
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                      }`}
                    >
                      Verify
                    </button>

                    <button
                      onClick={() => onDispatch && onDispatch(activeRecord)}
                      disabled={NEXT_STATUS[activeRecord.status] !== 'dispatched' || !onDispatch}
                      title={NEXT_STATUS[activeRecord.status] === 'dispatched' ? undefined : 'Status moves one step at a time'}
                      className={`py-2 px-3 rounded-xl font-bold text-xs transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 ${
                        activeRecord.status === 'dispatched'
                          ? 'bg-slate-800 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                      }`}
                    >
                      Dispatch
                    </button>

                    <button
                      onClick={() => handleUpdateStatus(activeRecord.id, 'resolved')}
                      disabled={NEXT_STATUS[activeRecord.status] !== 'resolved'}
                      title={NEXT_STATUS[activeRecord.status] === 'resolved' ? undefined : 'Status moves one step at a time'}
                      className={`py-2 px-3 rounded-xl font-bold text-xs transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 ${
                        activeRecord.status === 'resolved'
                          ? 'bg-[#991B1B] text-white shadow-xs'
                          : 'bg-red-50 text-red-800 hover:bg-red-100'
                      }`}
                    >
                      Resolve
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-slate-400">
                <p className="text-xs">Select an incident from the left to view triage details.</p>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <span>Official MDRRMO Triage Engine &bull; Municipality of Lingayen</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-900 text-white font-bold text-xs hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
};
