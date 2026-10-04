import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  IncidentReport,
  Barangay,
  User,
  IncidentStatus,
  HazardType
} from '../types';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import {
  ShieldAlert,
  ShieldCheck,
  Truck,
  CheckCircle,
  Clock,
  AlertTriangle,
  Users,
  Send,
  FileText,
  History,
  Check,
  X,
  Filter,
  ArrowRight,
  Search,
  Radio,
  ChevronDown,
  MapPin,
  SlidersHorizontal,
  LayoutGrid,
  Crosshair,
  Inbox,
  RotateCcw,
  Ban,
  Flame,
  Droplets,
  Zap,
  List
} from 'lucide-react';

interface AdminTriageProps {
  reports: IncidentReport[];
  barangays: Barangay[];
  currentUser: User;
  onReportsUpdated: () => void;
  onNavigateTab?: (tab: string) => void;
  onSelectReport?: (report: IncidentReport) => void;
}

// Format relative time (e.g., "12m ago", "1h ago", "2d ago")
function formatRelativeTime(dateString: string): string {
  const diffMs = Math.max(0, Date.now() - new Date(dateString).getTime());
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) {
    const remMinutes = diffMinutes % 60;
    return `${diffHours}h ${remMinutes > 0 ? `${remMinutes}m ` : ''}ago`;
  }
  return `${diffDays}d ago`;
}

// Map hazard severity to 4-bar indicator, priority weight, and label
function getSeverityInfo(_hazardType: HazardType | string, urgency?: string): {
  level: number;
  label: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
  weight: number;
} {
  if (urgency === 'emergency') return { level: 4, label: 'CRITICAL', weight: 4 };
  if (urgency === 'warning') return { level: 3, label: 'HIGH', weight: 3 };
  return { level: 2, label: 'MODERATE', weight: 2 };
}

// Hazard icon selector
function getHazardIcon(hazardType: HazardType | string, isBarangay = false) {
  const iconColor = isBarangay ? 'text-[#052659]' : 'text-neutral-800';
  switch (hazardType) {
    case 'Fire':
      return <Flame className={`w-4 h-4 ${iconColor}`} />;
    case 'Flood':
    case 'River Overflow':
    case 'Drainage Blockage':
    case 'Storm Surge':
    case 'Coastal Erosion':
      return <Droplets className={`w-4 h-4 ${iconColor}`} />;
    case 'Electrical / Power Line Hazard':
      return <Zap className={`w-4 h-4 ${iconColor}`} />;
    default:
      return <AlertTriangle className={`w-4 h-4 ${iconColor}`} />;
  }
}

export const AdminTriage: React.FC<AdminTriageProps> = ({
  reports,
  barangays,
  currentUser,
  onReportsUpdated,
  onNavigateTab,
  onSelectReport,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'queue' | 'audit'>('queue');
  // Status filter tabs matching initial draft: All | Pending | Verified | In Progress | Resolved | Rejected
  const [statusFilter, setStatusFilter] = useState<'all' | 'unverified' | 'verified' | 'dispatched' | 'resolved' | 'rejected'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isPrioritySort, setIsPrioritySort] = useState(false);
  const [isCommandView, setIsCommandView] = useState(false);
  const [selectedIncidentDetail, setSelectedIncidentDetail] = useState<IncidentReport | null>(null);

  // Dispatch, Resolve, and Reject Modals
  const [dispatchModalReport, setDispatchModalReport] = useState<IncidentReport | null>(null);
  const [assignedTeam, setAssignedTeam] = useState('');
  const [dispatchNotes, setDispatchNotes] = useState('');
  
  const [resolveModalReport, setResolveModalReport] = useState<IncidentReport | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');

  const [rejectModalReport, setRejectModalReport] = useState<IncidentReport | null>(null);
  const [rejectionReason, setRejectionReason] = useState('False alarm / Duplicate ticket');

  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Responder roster for the dispatch modal, and the latest status note of the open report
  const { responders, audit: auditLogs } = useRepo();
  const [latestNote, setLatestNote] = useState('');

  useEffect(() => {
    if (dispatchModalReport) {
      setAssignedTeam('');
      repo.loadResponders();
    }
  }, [dispatchModalReport]);

  useEffect(() => {
    setLatestNote('');
    if (!selectedIncidentDetail) return;
    let cancelled = false;
    repo.reportHistory(selectedIncidentDetail.id).then((history) => {
      const noted = history.filter((h) => h.note).pop();
      if (!cancelled) setLatestNote(noted ? noted.note : '');
    });
    return () => {
      cancelled = true;
    };
  }, [selectedIncidentDetail]);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const isLgu = currentUser.role === 'lgu_admin';
  const isBarangay = currentUser.role === 'barangay';

  // Keyboard shortcut ⌘K / Ctrl+K to focus search bar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Helper to get Barangay Name
  const getBarangayName = (barangayId: string) => {
    const b = barangays.find((brgy) => brgy.id === barangayId);
    return b ? b.name : barangayId;
  };

  // Area-scoped filtering: If Barangay official, scope to their jurisdiction
  const areaFilteredReports = useMemo(() => {
    return reports.filter((r) => {
      if (isBarangay && currentUser.barangay_id) {
        return r.barangay_id === currentUser.barangay_id;
      }
      return true; // LGU sees all
    });
  }, [reports, isBarangay, currentUser.barangay_id]);

  // Counts for the 6 filter tabs: All | Pending | Verified | In Progress | Resolved | Rejected
  const counts = useMemo(() => {
    return {
      all: areaFilteredReports.length,
      pending: areaFilteredReports.filter((r) => r.status === 'unverified').length,
      verified: areaFilteredReports.filter((r) => r.status === 'verified').length,
      inProgress: areaFilteredReports.filter((r) => r.status === 'dispatched').length,
      resolved: areaFilteredReports.filter((r) => r.status === 'resolved').length,
      rejected: areaFilteredReports.filter((r) => r.status === 'rejected').length,
    };
  }, [areaFilteredReports]);

  // Filtered and sorted reports matching status tab, search query, and Priority Sort toggle
  const filteredReports = useMemo(() => {
    let result = [...areaFilteredReports];

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter((r) => r.status === statusFilter);
    }

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((r, idx) => {
        const code = r.code.toLowerCase();
        const hazard = r.hazard_type.toLowerCase();
        const desc = r.description.toLowerCase();
        const brgy = getBarangayName(r.barangay_id).toLowerCase();
        return code.includes(q) || hazard.includes(q) || desc.includes(q) || brgy.includes(q);
      });
    }

    // Sort order
    if (isPrioritySort) {
      // Priority Sort: Critical & High severity first, then by newest
      return result.sort((a, b) => {
        const sevA = getSeverityInfo(a.hazard_type, a.urgency).weight;
        const sevB = getSeverityInfo(b.hazard_type, b.urgency).weight;
        if (sevB !== sevA) return sevB - sevA;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    } else {
      // Default: Chronological (Newest first)
      return result.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }
  }, [areaFilteredReports, statusFilter, searchQuery, isPrioritySort, barangays]);

  // Handlers. Every status change runs through the advance_report_status RPC,
  // which re-checks the caller's role and barangay and writes the audit entry.
  const runStatusChange = async (report: IncidentReport, next: IncidentStatus, note: string, successMessage: string) => {
    try {
      await repo.advanceStatus(report.id, next, note);
      setActionNotice(successMessage);
      onReportsUpdated();
      return true;
    } catch (err: any) {
      setActionNotice(err.message || 'Could not update the incident.');
      return false;
    } finally {
      setTimeout(() => setActionNotice(null), 4000);
    }
  };

  const handleVerifyManual = (report: IncidentReport) => {
    runStatusChange(report, 'verified', `Manually verified by ${currentUser.full_name}`, 'Status updated to verified');
  };

  const handleDispatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispatchModalReport) return;

    try {
      if (assignedTeam) await repo.assignResponder(dispatchModalReport.id, assignedTeam);
    } catch (err: any) {
      setActionNotice(err.message || 'Could not assign the responder unit.');
      setTimeout(() => setActionNotice(null), 4000);
      return;
    }
    const ok = await runStatusChange(dispatchModalReport, 'dispatched', dispatchNotes.trim(), 'Status updated to dispatched');
    if (ok) {
      setDispatchModalReport(null);
      setDispatchNotes('');
    }
  };

  const handleResolveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolveModalReport) return;

    const ok = await runStatusChange(resolveModalReport, 'resolved', resolutionNotes.trim(), 'Status updated to resolved');
    if (ok) {
      setResolveModalReport(null);
      setResolutionNotes('');
    }
  };

  const handleRejectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectModalReport) return;

    const ok = await runStatusChange(rejectModalReport, 'rejected', rejectionReason, `Incident marked as Rejected: ${rejectionReason}`);
    if (ok) setRejectModalReport(null);
  };

  // Helper for scope label
  const scopeLabel = isLgu
    ? 'Municipality-wide · Lingayen'
    : currentUser.barangay_name
    ? `Brgy. ${currentUser.barangay_name} · Lingayen`
    : 'No barangay assigned';

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {/* Action Flash Notice */}
      {actionNotice && (
        <div className={`p-3.5 rounded-2xl ${
          isBarangay
            ? 'bg-[#C2E8FF]/30 border border-[#7EA0C5]/40 text-[#011025]'
            : 'bg-neutral-100/90 border border-neutral-200/80 text-neutral-800'
        } text-xs font-medium flex items-center justify-between animate-in fade-in`}>
          <div className="flex items-center gap-2">
            <Check className={`w-4 h-4 ${isBarangay ? 'text-[#052659]' : 'text-neutral-800'} shrink-0`} />
            <span>{actionNotice}</span>
          </div>
          <button onClick={() => setActionNotice(null)} className={`cursor-pointer ${isBarangay ? 'text-[#7EA0C5] hover:text-[#011025]' : 'text-neutral-400 hover:text-neutral-700'}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. Main Incident Queue View */}
      {activeSubTab === 'queue' ? (
        <div className="space-y-4">
          {/* Header Row: Incident Queue, Subtitle, Priority Sort, Command View, Scope */}
          <div className="px-1 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h1 className={`text-xl sm:text-2xl font-semibold tracking-tight ${
                isBarangay ? 'text-[#011025]' : 'text-neutral-900'
              }`}>
                {isBarangay ? 'Barangay Incident Queue & Triage' : 'Incident Queue'}
              </h1>
              <p className={`text-xs sm:text-sm mt-0.5 ${
                isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'
              }`}>
                {isBarangay
                  ? `Track and dispatch local reports within Barangay ${currentUser.barangay_name || 'jurisdiction'}.`
                  : 'Track every report through reported, verified, response dispatched and resolved.'}
              </p>
            </div>

            {/* Right Controls: Priority Sort & Command View Buttons + Scope Label */}
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
              {/* Priority Sort Toggle Button */}
              <button
                onClick={() => setIsPrioritySort((prev) => !prev)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium transition-all border cursor-pointer ${
                  isPrioritySort
                    ? isBarangay
                      ? 'bg-[#052659] text-white border-[#011025] shadow-xs'
                      : 'bg-[#18181b] text-white border-[#18181b] shadow-xs'
                    : isBarangay
                    ? 'bg-white text-[#052659] border-[#7EA0C5]/40 hover:bg-[#C2E8FF]/30 shadow-2xs'
                    : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50 shadow-2xs'
                }`}
                title="Sort by urgency / highest severity first"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Priority Sort</span>
                {isPrioritySort && (
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    isBarangay ? 'bg-[#C2E8FF] text-[#052659]' : 'bg-neutral-800 text-white'
                  }`}>
                    ON
                  </span>
                )}
              </button>

              {/* Command View Toggle Button */}
              <button
                onClick={() => setIsCommandView((prev) => !prev)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium transition-all border cursor-pointer ${
                  isCommandView
                    ? isBarangay
                      ? 'bg-[#052659] text-white border-transparent shadow-xs'
                      : 'bg-[#2A2A2A] text-white border-transparent shadow-xs'
                    : isBarangay
                    ? 'bg-[#052659] hover:bg-[#5482B4] text-white border border-[#011025] shadow-xs'
                    : 'bg-[#18181b] text-white border-[#18181b] hover:bg-black shadow-xs'
                }`}
                title="Toggle between Queue Table and Command Matrix View"
              >
                {isCommandView ? (
                  <>
                    <List className="w-3.5 h-3.5" />
                    <span>Table View</span>
                  </>
                ) : (
                  <>
                    <LayoutGrid className="w-3.5 h-3.5" />
                    <span>Command View</span>
                  </>
                )}
              </button>

              {/* Scope Indicator with crosshair/compass icon */}
              <div className={`inline-flex items-center gap-1.5 text-xs font-medium pl-1 ${
                isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'
              }`}>
                <Crosshair className={`w-3.5 h-3.5 shrink-0 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'}`} />
                <span>Scope: {scopeLabel}</span>
              </div>
            </div>
          </div>

          {/* Status Filter Bar Matching Reference Image Capsule Tabs: All, Pending, Verified, In Progress, Resolved, Rejected */}
          <div className={`flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none p-1.5 rounded-full border w-fit max-w-full ${
            isBarangay ? 'bg-[#C2E8FF]/20 border-[#7EA0C5]/30' : 'bg-neutral-100/60 border-neutral-200/60'
          }`}>
            {/* Filter: All */}
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
                statusFilter === 'all'
                  ? isBarangay ? 'bg-[#052659] text-white shadow-2xs' : 'bg-[#2A2A2A] text-white shadow-2xs'
                  : isBarangay ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/40' : 'text-neutral-600 hover:text-neutral-900 hover:bg-white/60'
              }`}
            >
              <span>All</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-medium ${
                  statusFilter === 'all' ? 'bg-white/20 text-white' : isBarangay ? 'bg-[#C2E8FF]/60 text-[#052659]' : 'bg-neutral-200/80 text-neutral-700'
                }`}
              >
                {counts.all}
              </span>
            </button>

            {/* Filter: Pending (unverified) */}
            <button
              onClick={() => setStatusFilter('unverified')}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
                statusFilter === 'unverified'
                  ? isBarangay ? 'bg-[#052659] text-white shadow-2xs' : 'bg-[#2A2A2A] text-white shadow-2xs'
                  : isBarangay ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/40' : 'text-neutral-600 hover:text-neutral-900 hover:bg-white/60'
              }`}
            >
              <span>Pending</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-medium ${
                  statusFilter === 'unverified' ? 'bg-white/20 text-white' : isBarangay ? 'bg-[#C2E8FF]/60 text-[#052659]' : 'bg-neutral-200/80 text-neutral-700'
                }`}
              >
                {counts.pending}
              </span>
            </button>

            {/* Filter: Verified */}
            <button
              onClick={() => setStatusFilter('verified')}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
                statusFilter === 'verified'
                  ? isBarangay ? 'bg-[#052659] text-white shadow-2xs' : 'bg-[#2A2A2A] text-white shadow-2xs'
                  : isBarangay ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/40' : 'text-neutral-600 hover:text-neutral-900 hover:bg-white/60'
              }`}
            >
              <span>Verified</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-medium ${
                  statusFilter === 'verified' ? 'bg-white/20 text-white' : isBarangay ? 'bg-[#C2E8FF]/60 text-[#052659]' : 'bg-neutral-200/80 text-neutral-700'
                }`}
              >
                {counts.verified}
              </span>
            </button>

            {/* Filter: In Progress (dispatched) */}
            <button
              onClick={() => setStatusFilter('dispatched')}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
                statusFilter === 'dispatched'
                  ? isBarangay ? 'bg-[#052659] text-white shadow-2xs' : 'bg-[#2A2A2A] text-white shadow-2xs'
                  : isBarangay ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/40' : 'text-neutral-600 hover:text-neutral-900 hover:bg-white/60'
              }`}
            >
              <span>In Progress</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-medium ${
                  statusFilter === 'dispatched' ? 'bg-white/20 text-white' : isBarangay ? 'bg-[#C2E8FF]/60 text-[#052659]' : 'bg-neutral-200/80 text-neutral-700'
                }`}
              >
                {counts.inProgress}
              </span>
            </button>

            {/* Filter: Resolved */}
            <button
              onClick={() => setStatusFilter('resolved')}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
                statusFilter === 'resolved'
                  ? isBarangay ? 'bg-[#052659] text-white shadow-2xs' : 'bg-[#2A2A2A] text-white shadow-2xs'
                  : isBarangay ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/40' : 'text-neutral-600 hover:text-neutral-900 hover:bg-white/60'
              }`}
            >
              <span>Resolved</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-medium ${
                  statusFilter === 'resolved' ? 'bg-white/20 text-white' : isBarangay ? 'bg-[#C2E8FF]/60 text-[#052659]' : 'bg-neutral-200/80 text-neutral-700'
                }`}
              >
                {counts.resolved}
              </span>
            </button>

            {/* Filter: Rejected */}
            <button
              onClick={() => setStatusFilter('rejected')}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
                statusFilter === 'rejected'
                  ? isBarangay ? 'bg-[#052659] text-white shadow-2xs' : 'bg-[#2A2A2A] text-white shadow-2xs'
                  : isBarangay ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/40' : 'text-neutral-600 hover:text-neutral-900 hover:bg-white/60'
              }`}
            >
              <span>Rejected</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-medium ${
                  statusFilter === 'rejected' ? 'bg-white/20 text-white' : isBarangay ? 'bg-[#C2E8FF]/60 text-[#052659]' : 'bg-neutral-200/80 text-neutral-700'
                }`}
              >
                {counts.rejected}
              </span>
            </button>
          </div>

          {/* Conditional View: Command Matrix vs Table Queue */}
          {isCommandView ? (
            /* Command View Matrix (4 Columns: Pending, Verified, In Progress, Resolved) */
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 animate-in fade-in">
              {/* Column 1: Pending */}
              <div className={`bg-white rounded-[24px] border ${isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200/70'} p-4 sm:p-5 shadow-xs space-y-3.5`}>
                <div className={`flex items-center justify-between pb-3 border-b ${isBarangay ? 'border-[#7EA0C5]/20' : 'border-neutral-100'}`}>
                  <h3 className={`text-xs font-semibold uppercase tracking-wider ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>Pending Triage</h3>
                  <span className={`text-xs font-mono font-medium px-2.5 py-0.5 rounded-full ${isBarangay ? 'bg-[#C2E8FF]/60 text-[#052659] border border-[#7EA0C5]/40' : 'bg-neutral-100 text-neutral-700 border border-neutral-200/60'}`}>
                    {counts.pending}
                  </span>
                </div>
                <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
                  {areaFilteredReports.filter((r) => r.status === 'unverified').map((rep, idx) => (
                    <div key={rep.id} className={`p-3.5 rounded-2xl border ${isBarangay ? 'border-[#7EA0C5]/20 bg-[#C2E8FF]/10 hover:bg-[#C2E8FF]/25' : 'border-neutral-100 bg-[#f9fafb] hover:bg-neutral-100/70'} transition-all space-y-2`}>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className={`font-mono font-medium ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`}>{rep.code}</span>
                        <span className={`font-medium ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>{formatRelativeTime(rep.created_at)}</span>
                      </div>
                      <h4 className={`text-xs font-semibold uppercase ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>{rep.hazard_type}</h4>
                      <p className={`text-[11px] line-clamp-2 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-600'}`}>{rep.description}</p>
                      <div className="flex items-center justify-between pt-1 text-[10px]">
                        <span className={`font-medium ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>Brgy. {getBarangayName(rep.barangay_id)}</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleVerifyManual(rep)}
                            className={`px-3 py-1 ${isBarangay ? 'bg-[#052659] hover:bg-[#5482B4]' : 'bg-[#18181b] hover:bg-neutral-800'} text-white font-medium rounded-full cursor-pointer text-[11px] transition-all shadow-2xs`}
                          >
                            Verify
                          </button>
                          <button
                            onClick={() => setRejectModalReport(rep)}
                            className={`px-3 py-1 bg-white ${isBarangay ? 'hover:bg-[#C2E8FF]/30 text-[#052659] border border-[#7EA0C5]/40' : 'hover:bg-neutral-100 text-neutral-600 border border-neutral-200'} font-medium rounded-full cursor-pointer text-[11px] transition-all`}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {counts.pending === 0 && (
                    <div className={`p-6 text-center text-xs ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`}>No pending reports</div>
                  )}
                </div>
              </div>

              {/* Column 2: Verified */}
              <div className={`bg-white rounded-[24px] border ${isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200/70'} p-4 sm:p-5 shadow-xs space-y-3.5`}>
                <div className={`flex items-center justify-between pb-3 border-b ${isBarangay ? 'border-[#7EA0C5]/20' : 'border-neutral-100'}`}>
                  <h3 className={`text-xs font-semibold uppercase tracking-wider ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>Verified Ready</h3>
                  <span className={`text-xs font-mono font-medium px-2.5 py-0.5 rounded-full ${isBarangay ? 'bg-[#C2E8FF]/60 text-[#052659] border border-[#7EA0C5]/40' : 'bg-neutral-100 text-neutral-700 border border-neutral-200/60'}`}>
                    {counts.verified}
                  </span>
                </div>
                <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
                  {areaFilteredReports.filter((r) => r.status === 'verified').map((rep, idx) => (
                    <div key={rep.id} className={`p-3.5 rounded-2xl border ${isBarangay ? 'border-[#7EA0C5]/20 bg-[#C2E8FF]/10 hover:bg-[#C2E8FF]/25' : 'border-neutral-100 bg-[#f9fafb] hover:bg-neutral-100/70'} transition-all space-y-2`}>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className={`font-mono font-medium ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`}>{rep.code}</span>
                        <span className={`font-medium ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>{formatRelativeTime(rep.created_at)}</span>
                      </div>
                      <h4 className={`text-xs font-semibold uppercase ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>{rep.hazard_type}</h4>
                      <p className={`text-[11px] line-clamp-2 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-600'}`}>{rep.description}</p>
                      <div className="flex items-center justify-between pt-1 text-[10px]">
                        <span className={`font-medium ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>Brgy. {getBarangayName(rep.barangay_id)}</span>
                        <button
                          onClick={() => {
                            setDispatchModalReport(rep);
                            setDispatchNotes('');
                          }}
                          className={`px-3.5 py-1 ${isBarangay ? 'bg-[#052659] hover:bg-[#5482B4]' : 'bg-[#18181b] hover:bg-neutral-800'} text-white font-medium rounded-full cursor-pointer text-[11px] transition-all shadow-2xs`}
                        >
                          Dispatch Team
                        </button>
                      </div>
                    </div>
                  ))}
                  {counts.verified === 0 && (
                    <div className={`p-6 text-center text-xs ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`}>No verified reports awaiting team</div>
                  )}
                </div>
              </div>

              {/* Column 3: In Progress */}
              <div className={`bg-white rounded-[24px] border ${isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200/70'} p-4 sm:p-5 shadow-xs space-y-3.5`}>
                <div className={`flex items-center justify-between pb-3 border-b ${isBarangay ? 'border-[#7EA0C5]/20' : 'border-neutral-100'}`}>
                  <h3 className={`text-xs font-semibold uppercase tracking-wider ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>In Progress (Dispatched)</h3>
                  <span className={`text-xs font-mono font-medium px-2.5 py-0.5 rounded-full ${isBarangay ? 'bg-[#C2E8FF]/60 text-[#052659] border border-[#7EA0C5]/40' : 'bg-neutral-100 text-neutral-700 border border-neutral-200/60'}`}>
                    {counts.inProgress}
                  </span>
                </div>
                <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
                  {areaFilteredReports.filter((r) => r.status === 'dispatched').map((rep, idx) => (
                    <div key={rep.id} className={`p-3.5 rounded-2xl border ${isBarangay ? 'border-[#7EA0C5]/20 bg-[#C2E8FF]/10 hover:bg-[#C2E8FF]/25' : 'border-neutral-100 bg-[#f9fafb] hover:bg-neutral-100/70'} transition-all space-y-2`}>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className={`font-mono font-medium ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`}>{rep.code}</span>
                        <span className={`font-medium ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>{formatRelativeTime(rep.created_at)}</span>
                      </div>
                      <h4 className={`text-xs font-semibold uppercase ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>{rep.hazard_type}</h4>
                      <p className={`text-[11px] line-clamp-2 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-600'}`}>{rep.description}</p>
                      {rep.assigned_units > 0 && (
                        <p className={`text-[10px] font-medium ${isBarangay ? 'text-[#052659]' : 'text-neutral-700'} flex items-center gap-1`}>
                          <Truck className={`w-3 h-3 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-600'}`} />
                          <span className="truncate">{rep.assigned_units} unit{rep.assigned_units > 1 ? 's' : ''} deployed</span>
                        </p>
                      )}
                      <div className="flex items-center justify-between pt-1 text-[10px]">
                        <span className={`font-medium ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>Brgy. {getBarangayName(rep.barangay_id)}</span>
                        <button
                          onClick={() => {
                            setResolveModalReport(rep);
                            setResolutionNotes('');
                          }}
                          className={`px-3.5 py-1 ${isBarangay ? 'bg-[#052659] hover:bg-[#5482B4]' : 'bg-[#2A2A2A] hover:bg-black'} text-white font-medium rounded-full cursor-pointer text-[11px] transition-all shadow-2xs`}
                        >
                          Mark Cleared
                        </button>
                      </div>
                    </div>
                  ))}
                  {counts.inProgress === 0 && (
                    <div className={`p-6 text-center text-xs ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`}>No active response operations</div>
                  )}
                </div>
              </div>

              {/* Column 4: Resolved */}
              <div className={`bg-white rounded-[24px] border ${isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200/70'} p-4 sm:p-5 shadow-xs space-y-3.5`}>
                <div className={`flex items-center justify-between pb-3 border-b ${isBarangay ? 'border-[#7EA0C5]/20' : 'border-neutral-100'}`}>
                  <div className="flex items-center gap-2">
                    <CheckCircle className={`w-3.5 h-3.5 ${isBarangay ? 'text-[#052659]' : 'text-neutral-700'}`} />
                    <h3 className={`text-xs font-semibold uppercase tracking-wider ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>Resolved Archive</h3>
                  </div>
                  <span className={`text-xs font-mono font-medium px-2.5 py-0.5 rounded-full ${isBarangay ? 'bg-[#C2E8FF]/60 text-[#052659] border border-[#7EA0C5]/40' : 'bg-neutral-100 text-neutral-700 border border-neutral-200/60'}`}>
                    {counts.resolved}
                  </span>
                </div>
                <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
                  {areaFilteredReports.filter((r) => r.status === 'resolved').map((rep, idx) => (
                    <div key={rep.id} className={`p-3.5 rounded-2xl border ${isBarangay ? 'border-[#7EA0C5]/20 bg-white hover:bg-[#C2E8FF]/15' : 'border-neutral-100 bg-white hover:bg-neutral-50'} transition-all space-y-1.5`}>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className={`font-mono font-medium ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`}>{rep.code}</span>
                        <span className={isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}>{formatRelativeTime(rep.created_at)}</span>
                      </div>
                      <h4 className={`text-xs font-semibold line-through uppercase ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-500'}`}>{rep.hazard_type}</h4>
                      <p className={`text-[11px] line-clamp-1 ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-500'}`}>{rep.description}</p>
                      <div className="flex items-center justify-between pt-1 text-[10px]">
                        <span className={isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}>Brgy. {getBarangayName(rep.barangay_id)}</span>
                      </div>
                    </div>
                  ))}
                  {counts.resolved === 0 && (
                    <div className={`p-6 text-center text-xs ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`}>No resolved records</div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Table Queue View: Headers: STATUS | HAZARD / DESCRIPTION | BARANGAY | CORROBORATION | AGE | SEVERITY | ACTION */
            <div className={`bg-white rounded-[24px] border ${isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200/70'} shadow-xs overflow-hidden`}>
              {/* Table Header Row Matching Reference Image Tables */}
              <div className={`hidden lg:grid grid-cols-12 gap-4 px-6 py-3.5 ${isBarangay ? 'bg-[#C2E8FF]/25 border-b border-[#7EA0C5]/20 text-[#5482B4]' : 'bg-neutral-50/60 border-b border-neutral-100 text-neutral-400'} text-[11px] font-medium uppercase tracking-wider`}>
                <div className="col-span-2">STATUS</div>
                <div className="col-span-4">HAZARD / DESCRIPTION</div>
                <div className="col-span-2">BARANGAY</div>
                <div className="col-span-1 text-center">CORROBORATION</div>
                <div className="col-span-1">AGE</div>
                <div className="col-span-1 text-center">SEVERITY</div>
                <div className="col-span-1 text-right">ACTION</div>
              </div>

              {/* Table Rows or Empty State */}
              {filteredReports.length === 0 ? (
                /* Empty State: Inbox icon + "No Incidents in This Stage" + subtext */
                <div className="p-14 text-center">
                  <div className={`w-14 h-14 rounded-2xl ${
                    isBarangay
                      ? 'bg-[#C2E8FF]/40 text-[#052659] border border-[#7EA0C5]/40'
                      : 'bg-neutral-100 text-neutral-500 border border-neutral-200/60'
                  } mx-auto flex items-center justify-center mb-3.5 shadow-2xs`}>
                    <Inbox className="w-7 h-7" />
                  </div>
                  <h3 className={`text-base font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
                    No Incidents in This Stage
                  </h3>
                  <p className={`text-xs mt-1 max-w-sm mx-auto font-normal ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
                    Change the status filter to see other reports.
                  </p>
                  <div className="mt-4 flex items-center justify-center gap-2">
                    <button
                      onClick={() => {
                        setStatusFilter('all');
                        setSearchQuery('');
                      }}
                      className={`px-4 py-2 ${isBarangay ? 'bg-[#052659] hover:bg-[#5482B4] border border-[#011025]' : 'bg-[#18181b] hover:bg-neutral-800'} text-white text-xs font-medium rounded-full shadow-xs transition-colors cursor-pointer`}
                    >
                      View All Reports ({counts.all})
                    </button>
                  </div>
                </div>
              ) : (
                <div className={`divide-y ${isBarangay ? 'divide-[#7EA0C5]/20' : 'divide-neutral-100'}`}>
                  {filteredReports.map((report, index) => {
                    const incidentCode = report.code;
                    const brgyName = getBarangayName(report.barangay_id);
                    const severity = getSeverityInfo(report.hazard_type, report.urgency);
                    const isSelected = selectedIncidentDetail?.id === report.id;

                    // Status badge label and styling matching sleek theme
                    let statusBadgeClass = isBarangay
                      ? 'bg-[#C2E8FF]/60 text-[#052659] border border-[#7EA0C5]/40'
                      : 'bg-neutral-100 text-neutral-700 border border-neutral-200/80';
                    let statusText = 'PENDING';

                    if (report.status === 'verified') {
                      statusBadgeClass = isBarangay
                        ? 'bg-[#5482B4] text-white border-transparent shadow-2xs'
                        : 'bg-[#70757a] text-white border-transparent shadow-2xs';
                      statusText = 'VERIFIED';
                    } else if (report.status === 'dispatched') {
                      statusBadgeClass = isBarangay
                        ? 'bg-[#052659] text-white border-transparent shadow-2xs animate-pulse-subtle'
                        : 'bg-[#2A2A2A] text-white border-transparent shadow-2xs animate-pulse-subtle';
                      statusText = 'IN PROGRESS';
                    } else if (report.status === 'resolved') {
                      statusBadgeClass = isBarangay
                        ? 'bg-[#011025] text-white border-transparent'
                        : 'bg-neutral-800 text-white border-transparent';
                      statusText = 'RESOLVED';
                    } else if (report.status === 'rejected') {
                      statusBadgeClass = isBarangay
                        ? 'bg-[#C2E8FF]/40 text-[#7EA0C5] border border-[#7EA0C5]/30 line-through'
                        : 'bg-neutral-100 text-neutral-400 border border-neutral-200 line-through';
                      statusText = 'REJECTED';
                    }

                    return (
                      <div
                        key={report.id}
                        className={`transition-colors cursor-pointer ${
                          isSelected
                            ? isBarangay ? 'bg-[#C2E8FF]/30' : 'bg-neutral-50/80'
                            : isBarangay ? 'hover:bg-[#C2E8FF]/15' : 'hover:bg-neutral-50/60'
                        }`}
                        onClick={() =>
                          setSelectedIncidentDetail(
                            selectedIncidentDetail?.id === report.id ? null : report
                          )
                        }
                      >
                        {/* Desktop Grid Layout */}
                        <div className="hidden lg:grid grid-cols-12 gap-4 px-6 py-4 items-center">
                          {/* 1. STATUS */}
                          <div className="col-span-2">
                            <span
                              className={`inline-flex items-center px-3 py-1 rounded-full text-[10px] font-medium tracking-wide uppercase ${statusBadgeClass}`}
                            >
                              {statusText}
                            </span>
                          </div>

                          {/* 2. HAZARD / DESCRIPTION */}
                          <div className="col-span-4 min-w-0">
                            <div className="flex items-start gap-2.5">
                              <div className="mt-0.5 shrink-0">
                                {getHazardIcon(report.hazard_type, isBarangay)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className={`text-[10px] font-mono font-medium ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`}>
                                    {incidentCode}
                                  </span>
                                  {report.photo_url && (
                                    <span className={`text-[9px] font-medium px-2 py-0.5 rounded-full ${isBarangay ? 'bg-[#C2E8FF]/50 text-[#052659] border border-[#7EA0C5]/40' : 'bg-neutral-100 text-neutral-600 border border-neutral-200/60'}`}>
                                      Photo Attached
                                    </span>
                                  )}
                                </div>
                                <h3 className={`text-xs sm:text-sm font-semibold uppercase tracking-tight truncate mt-0.5 ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
                                  {report.hazard_type}
                                </h3>
                                <p
                                  title={report.description}
                                  className={`text-[11px] truncate mt-0.5 font-normal ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}
                                >
                                  {report.description}
                                </p>
                                {report.assigned_units > 0 && (
                                  <p className={`text-[10px] font-medium ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-600'} mt-1 flex items-center gap-1`}>
                                    <Truck className={`w-3 h-3 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`} />
                                    <span>Assigned: {report.assigned_units} unit{report.assigned_units > 1 ? 's' : ''}</span>
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* 3. BARANGAY */}
                          <div className="col-span-2 min-w-0">
                            <div className={`text-xs font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'} truncate`}>
                              Brgy. {brgyName}
                            </div>
                            <div className={`text-[11px] ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'} truncate font-normal`}>
                              Lingayen, Pangasinan
                            </div>
                          </div>

                          {/* 4. CORROBORATION */}
                          <div className="col-span-1 text-center">
                            <span
                              className={`inline-flex items-center justify-center font-mono font-medium text-xs px-2.5 py-0.5 rounded-full ${
                                report.corroboration_count >= 3
                                  ? isBarangay ? 'bg-[#052659] text-white shadow-2xs' : 'bg-[#18181b] text-white shadow-2xs'
                                  : report.corroboration_count > 0
                                  ? isBarangay ? 'bg-[#C2E8FF]/60 text-[#052659] border border-[#7EA0C5]/40' : 'bg-neutral-100 text-neutral-800 border border-neutral-200/60'
                                  : isBarangay ? 'bg-white text-[#7EA0C5] border border-[#7EA0C5]/40' : 'bg-neutral-50 text-neutral-500 border border-neutral-200/60'
                              }`}
                              title={`${report.corroboration_count} citizen confirmations registered`}
                            >
                              {report.corroboration_count}/3
                            </span>
                          </div>

                          {/* 5. AGE */}
                          <div className={`col-span-1 text-xs ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'} font-normal`}>
                            {formatRelativeTime(report.created_at)}
                          </div>

                          {/* 6. SEVERITY */}
                          <div className="col-span-1 flex flex-col items-center justify-center gap-1">
                            <div className="flex items-center gap-0.5">
                              {[1, 2, 3, 4].map((barIndex) => (
                                <span
                                  key={barIndex}
                                  className={`w-1 h-3 rounded-2xs transition-colors ${
                                    barIndex <= severity.level
                                      ? isBarangay ? 'bg-[#052659]' : 'bg-neutral-800'
                                      : isBarangay ? 'bg-[#C2E8FF]' : 'bg-neutral-200'
                                  }`}
                                />
                              ))}
                            </div>
                            <span className={`text-[9px] font-medium uppercase ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-600'} tracking-wider`}>
                              {severity.label}
                            </span>
                          </div>

                          {/* 7. ACTION */}
                          <div className="col-span-1 flex items-center justify-end gap-1.5">
                            {/* Action based on status */}
                            {report.status === 'unverified' && (
                              <button
                                onClick={() => handleVerifyManual(report)}
                                className={`px-3.5 py-1 ${
                                  isBarangay
                                    ? 'bg-[#052659] hover:bg-[#5482B4] border border-[#011025]'
                                    : 'bg-[#18181b] hover:bg-neutral-800'
                                } text-white text-[11px] font-medium rounded-full transition-all cursor-pointer shadow-2xs`}
                                title="Verify Incident"
                              >
                                Verify
                              </button>
                            )}

                            {report.status === 'verified' && (
                              <button
                                onClick={() => {
                                  setDispatchModalReport(report);
                                  setDispatchNotes('');
                                }}
                                className={`px-3.5 py-1 ${
                                  isBarangay
                                    ? 'bg-[#052659] hover:bg-[#5482B4] border border-[#011025]'
                                    : 'bg-[#18181b] hover:bg-neutral-800'
                                } text-white text-[11px] font-medium rounded-full transition-all cursor-pointer shadow-2xs`}
                                title="Dispatch Responders"
                              >
                                Dispatch
                              </button>
                            )}

                            {report.status === 'dispatched' && (
                              <button
                                onClick={() => {
                                  setResolveModalReport(report);
                                  setResolutionNotes('');
                                }}
                                className={`px-3.5 py-1 ${
                                  isBarangay
                                    ? 'bg-[#052659] hover:bg-[#5482B4] border border-[#011025]'
                                    : 'bg-[#2A2A2A] hover:bg-black'
                                } text-white text-[11px] font-medium rounded-full transition-all cursor-pointer shadow-2xs`}
                                title="Resolve Incident"
                              >
                                Resolve
                              </button>
                            )}



                            {/* Details Drawer Toggle */}
                            <button
                              onClick={() =>
                                setSelectedIncidentDetail(
                                  selectedIncidentDetail?.id === report.id ? null : report
                                )
                              }
                              className={`w-7 h-7 rounded-full ${
                                isBarangay
                                  ? 'bg-[#C2E8FF]/40 hover:bg-[#C2E8FF]/80 text-[#052659] border border-[#7EA0C5]/40'
                                  : 'bg-neutral-100/70 hover:bg-neutral-200 text-neutral-600 border border-neutral-200/60'
                              } flex items-center justify-center transition-colors cursor-pointer`}
                              title="Toggle details"
                            >
                              <ChevronDown
                                className={`w-3.5 h-3.5 transition-transform ${
                                  isSelected
                                    ? isBarangay ? 'rotate-180 text-[#011025]' : 'rotate-180 text-neutral-900'
                                    : ''
                                }`}
                              />
                            </button>
                          </div>
                        </div>

                        {/* Mobile / Tablet Compact Card View */}
                        <div className="lg:hidden p-4 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium uppercase ${statusBadgeClass}`}
                              >
                                {statusText}
                              </span>
                              <span className={`text-[10px] font-mono ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`}>
                                {incidentCode}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <div className="flex items-center gap-0.5">
                                {[1, 2, 3, 4].map((barIndex) => (
                                  <span
                                    key={barIndex}
                                    className={`w-1 h-3 rounded-2xs ${
                                      barIndex <= severity.level
                                        ? isBarangay ? 'bg-[#052659]' : 'bg-neutral-800'
                                        : isBarangay ? 'bg-[#C2E8FF]' : 'bg-neutral-200'
                                    }`}
                                  />
                                ))}
                              </div>
                              <span className={`text-[10px] font-medium uppercase ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-600'}`}>
                                {severity.label}
                              </span>
                            </div>
                          </div>

                          <div>
                            <h3 className={`text-xs font-semibold uppercase ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
                              {report.hazard_type}
                            </h3>
                            <p className={`text-xs mt-0.5 font-normal ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
                              {report.description}
                            </p>
                          </div>

                          <div className={`flex items-center justify-between text-[11px] ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'} pt-1`}>
                            <div className="flex items-center gap-1">
                              <MapPin className={`w-3 h-3 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'} shrink-0`} />
                              <span>Brgy. {brgyName}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`font-mono font-medium ${isBarangay ? 'text-[#011025]' : 'text-neutral-700'}`}>
                                {report.corroboration_count}/3 confirms
                              </span>
                              <span>•</span>
                              <span>{formatRelativeTime(report.created_at)}</span>
                            </div>
                          </div>

                          {/* Mobile Actions */}
                          <div className={`flex items-center justify-end gap-2 pt-2 border-t ${isBarangay ? 'border-[#7EA0C5]/20' : 'border-neutral-100'}`}>
                            {report.status === 'unverified' && (
                              <>
                                <button
                                  onClick={() => handleVerifyManual(report)}
                                  className={`px-3.5 py-1.5 ${
                                    isBarangay ? 'bg-[#052659] hover:bg-[#5482B4] border border-[#011025]' : 'bg-[#18181b]'
                                  } text-white text-xs font-medium rounded-full cursor-pointer transition-colors`}
                                >
                                  Verify
                                </button>
                                <button
                                  onClick={() => setRejectModalReport(report)}
                                  className={`px-3.5 py-1.5 ${
                                    isBarangay
                                      ? 'bg-white text-[#5482B4] border border-[#7EA0C5]/40 hover:bg-[#C2E8FF]/20'
                                      : 'bg-white text-neutral-600 border border-neutral-200 hover:bg-neutral-50'
                                  } text-xs font-medium rounded-full cursor-pointer`}
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            {report.status === 'verified' && (
                              <button
                                onClick={() => {
                                  setDispatchModalReport(report);
                                  setDispatchNotes('');
                                }}
                                className={`px-3.5 py-1.5 ${
                                  isBarangay ? 'bg-[#052659] hover:bg-[#5482B4] border border-[#011025]' : 'bg-[#18181b]'
                                } text-white text-xs font-medium rounded-full cursor-pointer transition-colors`}
                              >
                                Dispatch
                              </button>
                            )}
                            {report.status === 'dispatched' && (
                              <button
                                onClick={() => {
                                  setResolveModalReport(report);
                                  setResolutionNotes('');
                                }}
                                className={`px-3.5 py-1.5 ${
                                  isBarangay ? 'bg-[#052659] hover:bg-[#5482B4] border border-[#011025]' : 'bg-[#2A2A2A]'
                                } text-white text-xs font-medium rounded-full cursor-pointer transition-colors`}
                              >
                                Resolve
                              </button>
                            )}
                            <button
                              onClick={() =>
                                setSelectedIncidentDetail(
                                  selectedIncidentDetail?.id === report.id ? null : report
                                )
                              }
                              className={`px-3.5 py-1.5 ${
                                isBarangay
                                  ? 'bg-[#C2E8FF]/40 text-[#052659] border border-[#7EA0C5]/40 hover:bg-[#C2E8FF]/70'
                                  : 'bg-neutral-100 text-neutral-700 border border-neutral-200 hover:bg-neutral-200/70'
                              } text-xs font-medium rounded-full cursor-pointer`}
                            >
                              {isSelected ? 'Hide' : 'Details'}
                            </button>
                          </div>
                        </div>

                        {/* Expandable Incident Details Drawer */}
                        {isSelected && (
                          <div className={`px-6 py-4 ${isBarangay ? 'bg-[#C2E8FF]/10 border-t border-[#7EA0C5]/20' : 'bg-neutral-50/60 border-t border-neutral-100'} text-xs space-y-3 animate-in fade-in`}>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div className={`bg-white p-3.5 rounded-2xl border ${isBarangay ? 'border-[#7EA0C5]/30' : 'border-neutral-200/60'} shadow-2xs`}>
                                <p className={`text-[10px] font-semibold uppercase tracking-wider ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'}`}>Reporter & Caller</p>
                                <p className={`font-semibold mt-0.5 ${isBarangay ? 'text-[#011025]' : 'text-neutral-800'}`}>{report.code}</p>
                                <p className={`text-[10px] mt-1 font-mono ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
                                  {report.has_location ? `Coordinates: ${report.latitude.toFixed(4)}, ${report.longitude.toFixed(4)}` : 'No coordinates recorded'}
                                </p>
                              </div>

                              <div className={`bg-white p-3.5 rounded-2xl border ${isBarangay ? 'border-[#7EA0C5]/30' : 'border-neutral-200/60'} shadow-2xs`}>
                                <p className={`text-[10px] font-semibold uppercase tracking-wider ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'}`}>Corroboration Engine</p>
                                <p className={`font-semibold mt-0.5 ${isBarangay ? 'text-[#011025]' : 'text-neutral-800'}`}>
                                  {report.corroboration_count} of 3 required confirmations
                                </p>
                                <p className={`text-[10px] mt-1 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
                                  {report.corroboration_count >= 3
                                    ? 'Auto-verified by matching citizen reports'
                                    : 'Awaiting additional citizen field reports'}
                                </p>
                              </div>

                              <div className={`bg-white p-3.5 rounded-2xl border ${isBarangay ? 'border-[#7EA0C5]/30' : 'border-neutral-200/60'} shadow-2xs`}>
                                <p className={`text-[10px] font-semibold uppercase tracking-wider ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'}`}>Dispatch / Team</p>
                                <p className={`font-semibold mt-0.5 ${isBarangay ? 'text-[#011025]' : 'text-neutral-800'}`}>
                                  {report.assigned_units > 0 ? `${report.assigned_units} unit${report.assigned_units > 1 ? 's' : ''} deployed` : 'Pending team assignment'}
                                </p>
                                <p className={`text-[10px] mt-1 truncate ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
                                  {latestNote || 'No dispatch notes recorded'}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center justify-between pt-1">
                              <div className="flex items-center gap-2">
                                {onSelectReport && (
                                  <button
                                    onClick={() => onSelectReport(report)}
                                    className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium ${
                                      isBarangay
                                        ? 'text-[#052659] bg-white hover:bg-[#C2E8FF]/30 border border-[#7EA0C5]/40'
                                        : 'text-neutral-700 bg-white hover:bg-neutral-50 border border-neutral-200'
                                    } transition-colors cursor-pointer shadow-2xs`}
                                  >
                                    <MapPin className={`w-3.5 h-3.5 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`} />
                                    <span>View on Map Radar</span>
                                  </button>
                                )}
                                {report.status === 'unverified' && (
                                  <button
                                    onClick={() => setRejectModalReport(report)}
                                    className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium ${
                                      isBarangay
                                        ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/20 border border-[#7EA0C5]/40'
                                        : 'text-neutral-600 bg-white hover:bg-neutral-50 border border-neutral-200'
                                    } transition-colors cursor-pointer`}
                                  >
                                    <Ban className={`w-3.5 h-3.5 ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`} />
                                    <span>Reject False Report</span>
                                  </button>
                                )}
                              </div>

                              <span className={`text-[11px] ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`}>
                                Ticket Code: <strong className={`font-mono ${isBarangay ? 'text-[#011025]' : 'text-neutral-700'}`}>{incidentCode}</strong>
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* 3. System Audit Log Stream (Accessible via clock/history button) */
        <div className={`bg-white rounded-[24px] border ${isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200/70'} p-5 sm:p-6 shadow-xs space-y-4`}>
          <div className={`flex items-center justify-between pb-3 border-b ${isBarangay ? 'border-[#7EA0C5]/20' : 'border-neutral-100'}`}>
            <div>
              <h3 className={`font-semibold text-sm tracking-tight ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
                UniGuard System Audit & State Machine Logs
              </h3>
              <p className={`text-xs mt-0.5 font-normal ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
                Immutable event stream for LDRRMC incident verification & dispatch actions
              </p>
            </div>
            <button
              onClick={() => setActiveSubTab('queue')}
              className={`text-xs font-medium ${isBarangay ? 'text-[#5482B4] hover:text-[#011025]' : 'text-neutral-600 hover:text-neutral-900'} flex items-center gap-1 cursor-pointer transition-colors`}
            >
              <ArrowRight className="w-3.5 h-3.5 rotate-180" />
              <span>Back to Incident Queue</span>
            </button>
          </div>

          <div className="space-y-2">
            {auditLogs.map((log) => (
              <div
                key={log.id}
                className={`p-3.5 rounded-2xl border ${isBarangay ? 'border-[#7EA0C5]/20 bg-[#C2E8FF]/10' : 'border-neutral-100 bg-[#f9fafb]'} flex items-start justify-between gap-3 text-xs`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-medium uppercase px-2.5 py-0.5 rounded-full border ${
                        log.event_type === 'crowd_corroboration_auto_verify' || log.event_type === 'emergency_broadcast'
                          ? isBarangay ? 'bg-[#052659] text-white border-transparent' : 'bg-[#18181b] text-white border-transparent'
                          : isBarangay ? 'bg-[#C2E8FF]/60 text-[#052659] border-[#7EA0C5]/40' : 'bg-neutral-100 text-neutral-700 border-neutral-200'
                      }`}
                    >
                      {log.event_type.replace(/_/g, ' ')}
                    </span>
                    <span className={`font-medium ${isBarangay ? 'text-[#011025]' : 'text-neutral-800'}`}>Actor: {log.actor_name}</span>
                  </div>
                  <p className={isBarangay ? 'text-[#5482B4]' : 'text-neutral-600'}>{log.description}</p>
                </div>

                <span className={`text-[10px] font-mono ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'} shrink-0`}>
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Dispatch Modal */}
      {dispatchModalReport && (
        <div className={`fixed inset-0 z-50 ${isBarangay ? 'bg-[#011025]/40' : 'bg-black/40'} backdrop-blur-xs flex items-center justify-center p-4`}>
          <div className={`bg-white rounded-[24px] max-w-md w-full p-6 shadow-xl border ${isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200'} animate-in zoom-in-95 duration-200`}>
            <div className="mb-1">
              <h3 className={`font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'} text-base tracking-tight`}>
                Dispatch DRRM Response Unit
              </h3>
            </div>
            <p className={`text-xs ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'} mb-4 font-normal`}>
              Mobilizing teams for {dispatchModalReport.hazard_type} in Brgy. {getBarangayName(dispatchModalReport.barangay_id)}
            </p>

            <form onSubmit={handleDispatchSubmit} className="space-y-4">
              <div>
                <label className={`block text-xs font-medium ${isBarangay ? 'text-[#011025]' : 'text-neutral-700'} mb-1`}>
                  Assign Response Unit
                </label>
                <select
                  value={assignedTeam}
                  onChange={(e) => setAssignedTeam(e.target.value)}
                  className={`w-full text-xs font-medium ${
                    isBarangay
                      ? 'bg-white border-[#7EA0C5]/40 text-[#011025] focus:border-[#5482B4] focus:ring-1 focus:ring-[#5482B4]/50'
                      : 'bg-neutral-50/70 border-neutral-200 text-neutral-800 focus:bg-white focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400/50'
                  } border rounded-xl p-2.5 outline-hidden transition-all`}
                >
                  <option value="">
                    {responders.length ? 'Select a unit' : 'No responder units configured yet'}
                  </option>
                  {responders.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}{r.unit ? ` · ${r.unit}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={`block text-xs font-medium ${isBarangay ? 'text-[#011025]' : 'text-neutral-700'} mb-1`}>
                  Dispatch Orders / Tactical Instructions
                </label>
                <textarea
                  rows={3}
                  value={dispatchNotes}
                  onChange={(e) => setDispatchNotes(e.target.value)}
                  placeholder="e.g. Bring 2 motorized rubber boats and water pumps; proceed to coastal zone perimeter..."
                  className={`w-full text-xs p-2.5 ${
                    isBarangay
                      ? 'bg-white border-[#7EA0C5]/40 text-[#011025] placeholder:text-[#7EA0C5] focus:border-[#5482B4] focus:ring-1 focus:ring-[#5482B4]/50'
                      : 'bg-neutral-50/70 border-neutral-200 text-neutral-800 focus:bg-white focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400/50'
                  } border rounded-xl outline-hidden transition-all`}
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDispatchModalReport(null)}
                  className={`px-4 py-2 text-xs font-medium ${
                    isBarangay ? 'text-[#5482B4] hover:bg-[#C2E8FF]/30' : 'text-neutral-600 hover:bg-neutral-100'
                  } rounded-full cursor-pointer transition-colors`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`px-4 py-2 text-xs font-medium text-white ${
                    isBarangay ? 'bg-[#052659] hover:bg-[#5482B4] border border-[#011025]' : 'bg-[#18181b] hover:bg-neutral-800'
                  } rounded-full shadow-xs flex items-center gap-1.5 cursor-pointer transition-all`}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Confirm Dispatch</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. Resolve Incident Modal */}
      {resolveModalReport && (
        <div className={`fixed inset-0 z-50 ${isBarangay ? 'bg-[#011025]/40' : 'bg-black/40'} backdrop-blur-xs flex items-center justify-center p-4`}>
          <div className={`bg-white rounded-[24px] max-w-md w-full p-6 shadow-xl border ${isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200'} animate-in zoom-in-95 duration-200`}>
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className={`w-4 h-4 ${isBarangay ? 'text-[#052659]' : 'text-neutral-800'}`} />
              <h3 className={`font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'} text-base tracking-tight`}>
                Mark Incident as Resolved
              </h3>
            </div>
            <p className={`text-xs ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'} mb-4 font-normal`}>
              Closing incident {resolveModalReport.hazard_type} in Brgy. {getBarangayName(resolveModalReport.barangay_id)}
            </p>

            <form onSubmit={handleResolveSubmit} className="space-y-4">
              <div>
                <label className={`block text-xs font-medium ${isBarangay ? 'text-[#011025]' : 'text-neutral-700'} mb-1`}>
                  Resolution Summary / Post-Action Report
                </label>
                <textarea
                  required
                  rows={3}
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  placeholder="e.g. Flood waters receded, road obstruction cleared, area safe for traffic."
                  className={`w-full text-xs p-2.5 ${
                    isBarangay
                      ? 'bg-white border-[#7EA0C5]/40 text-[#011025] placeholder:text-[#7EA0C5] focus:border-[#5482B4] focus:ring-1 focus:ring-[#5482B4]/50'
                      : 'bg-neutral-50/70 border-neutral-200 text-neutral-800 focus:bg-white focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400/50'
                  } border rounded-xl outline-hidden transition-all`}
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResolveModalReport(null)}
                  className={`px-4 py-2 text-xs font-medium ${
                    isBarangay ? 'text-[#5482B4] hover:bg-[#C2E8FF]/30' : 'text-neutral-600 hover:bg-neutral-100'
                  } rounded-full cursor-pointer transition-colors`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`px-4 py-2 text-xs font-medium text-white ${
                    isBarangay ? 'bg-[#052659] hover:bg-[#5482B4] border border-[#011025]' : 'bg-[#18181b] hover:bg-black'
                  } rounded-full shadow-xs flex items-center gap-1.5 cursor-pointer transition-all`}
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Confirm Incident Cleared</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. Reject / Dismiss Modal */}
      {rejectModalReport && (
        <div className={`fixed inset-0 z-50 ${isBarangay ? 'bg-[#011025]/40' : 'bg-black/40'} backdrop-blur-xs flex items-center justify-center p-4`}>
          <div className={`bg-white rounded-[24px] max-w-md w-full p-6 shadow-xl border ${isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200'} animate-in zoom-in-95 duration-200`}>
            <div className="flex items-center gap-2 mb-1">
              <Ban className={`w-4 h-4 ${isBarangay ? 'text-[#052659]' : 'text-neutral-800'}`} />
              <h3 className={`font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'} text-base tracking-tight`}>
                Reject / Dismiss Incident Report
              </h3>
            </div>
            <p className={`text-xs ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'} mb-4 font-normal`}>
              Dismissing report for {rejectModalReport.hazard_type} ({rejectModalReport.code})
            </p>

            <form onSubmit={handleRejectSubmit} className="space-y-4">
              <div>
                <label className={`block text-xs font-medium ${isBarangay ? 'text-[#011025]' : 'text-neutral-700'} mb-1`}>
                  Reason for Rejection
                </label>
                <select
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className={`w-full text-xs font-medium ${
                    isBarangay
                      ? 'bg-white border-[#7EA0C5]/40 text-[#011025] focus:border-[#5482B4] focus:ring-1 focus:ring-[#5482B4]/50'
                      : 'bg-neutral-50/70 border-neutral-200 text-neutral-800 focus:bg-white focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400/50'
                  } border rounded-xl p-2.5 outline-hidden transition-all`}
                >
                  <option value="False alarm / Duplicate ticket">
                    False alarm / Duplicate ticket
                  </option>
                  <option value="Inspected by patrol; no hazard found">
                    Inspected by patrol; no hazard found
                  </option>
                  <option value="Spam / Invalid coordinates">
                    Spam / Invalid coordinates
                  </option>
                  <option value="Resolved independently before dispatch">
                    Resolved independently before dispatch
                  </option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRejectModalReport(null)}
                  className={`px-4 py-2 text-xs font-medium ${
                    isBarangay ? 'text-[#5482B4] hover:bg-[#C2E8FF]/30' : 'text-neutral-600 hover:bg-neutral-100'
                  } rounded-full cursor-pointer transition-colors`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`px-4 py-2 text-xs font-medium text-white ${
                    isBarangay ? 'bg-[#052659] hover:bg-[#5482B4] border border-[#011025]' : 'bg-[#18181b] hover:bg-neutral-800'
                  } rounded-full shadow-xs flex items-center gap-1.5 cursor-pointer transition-all`}
                >
                  <Ban className="w-3.5 h-3.5" />
                  <span>Confirm Rejection</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
