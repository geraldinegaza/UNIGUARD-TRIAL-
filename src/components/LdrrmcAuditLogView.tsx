import React, { useState, useEffect } from 'react';
import { SystemAuditLog, User } from '../types';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import {
  FileText,
  Search,
  Filter,
  Clock,
  Download,
  RotateCw,
  Inbox,
  ShieldCheck,
  ShieldAlert,
  Radio,
  Truck,
  CheckCircle2,
  Users,
  AlertTriangle,
  Layers,
  Sparkles
} from 'lucide-react';

export interface LdrrmcAuditLogViewProps {
  currentUser: User;
}

export const LdrrmcAuditLogView: React.FC<LdrrmcAuditLogViewProps> = ({ currentUser }) => {
  const isBarangay = currentUser?.role === 'barangay';

  // Every privileged action from the audit_log table, newest first
  const logs = useRepo().audit;
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadLogs = async () => {
    setIsRefreshing(true);
    setLoadError(null);
    try {
      await repo.loadAudit(200);
    } catch (err: any) {
      setLoadError(err.message || 'Could not load the audit log');
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  // Filter logs
  const filteredLogs = logs.filter((log) => {
    if (selectedCategory !== 'all') {
      if (selectedCategory === 'role_changes' && !log.event_type.startsWith('user.')) return false;
      if (selectedCategory === 'declarations' && log.event_type !== 'emergency.declared') return false;
      if (selectedCategory === 'directory_edits' && !['emergency_hotlines', 'evacuation_centers'].includes(log.entity)) return false;
      if (selectedCategory === 'dispatches' && !log.event_type.startsWith('report.')) return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchDesc = log.description.toLowerCase().includes(q);
      const matchActor = log.actor_name.toLowerCase().includes(q);
      const matchTarget = (log.target_id || '').toLowerCase().includes(q);
      return matchDesc || matchActor || matchTarget;
    }
    return true;
  });

  // Export CSV handler
  const handleExportCsv = () => {
    const headers = ['Timestamp', 'Event Type', 'Actor', 'Description', 'Target Reference'];
    const rows = filteredLogs.map((log) => [
      `"${new Date(log.timestamp).toISOString()}"`,
      `"${log.event_type}"`,
      `"${log.actor_name}"`,
      `"${log.description.replace(/"/g, '""')}"`,
      `"${log.target_id}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `lingayen-audit-log-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getEventBadge = (type: SystemAuditLog['event_type'], description: string) => {
    const descLower = description.toLowerCase();
    if (type.startsWith('user.')) {
      return (
        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wider uppercase shadow-2xs ${
          isBarangay ? 'bg-[#052659] text-white' : 'bg-[#18181b] text-white'
        }`}>
          Role Change
        </span>
      );
    }
    if (type === 'emergency.declared') {
      return (
        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wider uppercase shadow-2xs ${
          isBarangay ? 'bg-[#031c42] text-white border border-[#7EA0C5]/40' : 'bg-neutral-800 text-white'
        }`}>
          Declaration / Broadcast
        </span>
      );
    }
    if (descLower.includes('hotline') || descLower.includes('directory')) {
      return (
        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wider uppercase shadow-2xs ${
          isBarangay ? 'bg-[#5482B4] text-white' : 'bg-neutral-700 text-white'
        }`}>
          Directory Edit
        </span>
      );
    }
    if (type === 'report.responder_assigned' || (type === 'report.status_changed' && descLower.includes('to dispatched'))) {
      return (
        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wider uppercase shadow-2xs ${
          isBarangay ? 'bg-[#052659] text-white' : 'bg-neutral-800 text-white'
        }`}>
          Dispatch Order
        </span>
      );
    }
    if (type === 'report.status_changed' && descLower.includes('to resolved')) {
      return (
        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wider uppercase shadow-2xs ${
          isBarangay ? 'bg-[#7EA0C5] text-white' : 'bg-neutral-600 text-white'
        }`}>
          Incident Resolved
        </span>
      );
    }
    return (
      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wider uppercase ${
        isBarangay ? 'bg-[#C2E8FF]/50 text-[#052659] border border-[#7EA0C5]/40' : 'bg-neutral-100 text-neutral-700 border border-neutral-200/80'
      }`}>
        Privileged Action
      </span>
    );
  };

  return (
    <div className="space-y-6 sm:space-y-7 animate-in fade-in duration-300">
      {/* 1. Header Section matching initial draft: Title + Subtitle + Buttons (Refresh, Export CSV) */}
      <div className="px-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className={`text-xl sm:text-2xl font-semibold tracking-tight ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
            Audit Log
          </h1>
          <p className={`text-xs sm:text-sm mt-0.5 max-w-2xl leading-relaxed ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
            Every privileged action, newest first.
          </p>
        </div>

        {/* Top Right Action Buttons matching draft: Refresh + Export CSV */}
        <div className="flex items-center gap-2.5 self-start sm:self-auto shrink-0">
          <button
            onClick={loadLogs}
            disabled={isRefreshing}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-full shadow-2xs transition-colors cursor-pointer disabled:opacity-50 ${
              isBarangay
                ? 'bg-white hover:bg-[#C2E8FF]/20 text-[#052659] border border-[#7EA0C5]/40'
                : 'bg-white hover:bg-neutral-50 text-neutral-700 border border-neutral-200/80'
            }`}
          >
            <RotateCw className={`w-3.5 h-3.5 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'} ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={handleExportCsv}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-full shadow-xs transition-colors cursor-pointer shrink-0 ${
              isBarangay ? 'bg-[#052659] hover:bg-[#031c42] text-white' : 'bg-[#18181b] hover:bg-neutral-800 text-white'
            }`}
          >
            <Download className="w-4 h-4" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Search and Category Filter Tabs */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className={`w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none ${
            isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'
          }`} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by action, actor, or reference target..."
            className={`w-full pl-10 pr-4 py-2 rounded-full text-xs font-medium focus:outline-hidden shadow-2xs transition-all ${
              isBarangay
                ? 'bg-[#C2E8FF]/10 hover:bg-[#C2E8FF]/20 focus:bg-white border border-[#7EA0C5]/40 text-[#011025] placeholder-[#7EA0C5] focus:border-[#052659] focus:ring-2 focus:ring-[#C2E8FF]/50'
                : 'bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white border border-neutral-200 text-neutral-800 placeholder-neutral-400 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50'
            }`}
          />
        </div>

        <div className={`flex items-center gap-1 p-1 rounded-full self-start overflow-x-auto shadow-2xs ${
          isBarangay ? 'bg-[#C2E8FF]/20 border border-[#7EA0C5]/30' : 'bg-neutral-100/90 border border-neutral-200/80'
        }`}>
          {[
            { id: 'all', label: `All (${logs.length})` },
            { id: 'role_changes', label: 'Role Changes' },
            { id: 'declarations', label: 'Declarations' },
            { id: 'directory_edits', label: 'Directory Edits' },
            { id: 'dispatches', label: 'Dispatches' },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                selectedCategory === cat.id
                  ? isBarangay
                    ? 'bg-[#052659] text-white shadow-2xs'
                    : 'bg-[#2A2A2A] text-white shadow-2xs'
                  : isBarangay
                    ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/40'
                    : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-200/60'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Main Section Card: List of Audit Logs or Empty State (Matching Draft Screenshot) */}
      {filteredLogs.length === 0 ? (
        <div className={`rounded-[24px] p-16 text-center space-y-3 shadow-xs ${
          isBarangay ? 'bg-white border border-[#7EA0C5]/30 shadow-[0_2px_12px_rgba(1,16,37,0.03)]' : 'bg-white border border-neutral-200/70'
        }`}>
          <div className={`w-12 h-12 rounded-2xl mx-auto flex items-center justify-center shadow-2xs ${
            isBarangay ? 'bg-[#C2E8FF]/30 text-[#052659] border border-[#7EA0C5]/40' : 'bg-neutral-100 text-neutral-600 border border-neutral-200'
          }`}>
            <Inbox className="w-6 h-6" />
          </div>
          <h3 className={`text-sm font-semibold tracking-tight ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
            {loadError ? 'Could not load the audit log' : 'Nothing recorded yet'}
          </h3>
          <p className={`text-xs max-w-sm mx-auto leading-relaxed ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
            {loadError || 'Role changes, declarations and directory edits show up here.'}
          </p>
        </div>
      ) : (
        <div className={`bg-white rounded-[24px] shadow-xs divide-y overflow-hidden ${
          isBarangay
            ? 'border border-[#7EA0C5]/30 shadow-[0_2px_12px_rgba(1,16,37,0.03)] divide-[#7EA0C5]/15'
            : 'border border-neutral-200/70 divide-neutral-100'
        }`}>
          {filteredLogs.map((log) => {
            const dateObj = new Date(log.timestamp);
            const dateFormatted = dateObj.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
            const timeFormatted = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

            return (
              <div
                key={log.id}
                className={`p-5 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                  isBarangay ? 'hover:bg-[#C2E8FF]/10' : 'hover:bg-neutral-50/50'
                }`}
              >
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="mt-0.5 shrink-0">
                    {getEventBadge(log.event_type, log.description)}
                  </div>

                  <div className="space-y-1 min-w-0">
                    <p className={`text-xs sm:text-sm font-semibold leading-snug ${
                      isBarangay ? 'text-[#011025]' : 'text-neutral-900'
                    }`}>
                      {log.description}
                    </p>
                    <div className={`flex flex-wrap items-center gap-2 text-xs ${
                      isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'
                    }`}>
                      <span className={`font-normal ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-600'}`}>
                        Actor: <span className={`font-medium ${isBarangay ? 'text-[#011025]' : 'text-neutral-800'}`}>{log.actor_name}</span>
                      </span>
                      <span>&bull;</span>
                      <span className={`font-mono text-[11px] ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`}>
                        Target: {log.target_id}
                      </span>
                    </div>
                  </div>
                </div>

                <div className={`flex items-center gap-1.5 text-xs font-mono shrink-0 md:text-right ${
                  isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'
                }`}>
                  <Clock className={`w-3.5 h-3.5 shrink-0 ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`} />
                  <span>{dateFormatted} at {timeFormatted}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
