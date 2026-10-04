import React, { useState, useMemo, useEffect } from 'react';
import { User } from '../types';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import { canNavigate, wazeUrl } from '../lib/geo';
import { telHref } from '../lib/util';
import {
  AlertCircle,
  Phone,
  MapPin,
  Clock,
  Radio,
  CheckCircle2,
  Trash2,
  PhoneCall,
  Navigation,
  Compass,
  Plus,
  X,
  Check,
  ShieldAlert
} from 'lucide-react';

export interface SosEvent {
  id: string;
  citizenName: string;
  phoneNumber: string;
  locationStatus: 'no fix' | 'GPS locked';
  latitude?: number;
  longitude?: number;
  barangay?: string;
  timestamp: string; // ISO string
  status: 'Active' | 'Responding' | 'Resolved';
  notes?: string;
}

interface LdrrmcSosLogViewProps {
  currentUser: User;
  onSelectOnMap?: (coords: { latitude: number; longitude: number; label: string }) => void;
  onNavigateTab?: (tab: string) => void;
}

export const LdrrmcSosLogView: React.FC<LdrrmcSosLogViewProps> = ({
  currentUser,
  onSelectOnMap,
  onNavigateTab,
}) => {
  const isBarangay = currentUser?.role === 'barangay';

  // Every one-tap SOS in the sos_log table, refreshed on entry and kept live by Realtime
  const { sosLog } = useRepo();
  useEffect(() => {
    repo.loadSos();
  }, []);

  const events: SosEvent[] = useMemo(
    () =>
      sosLog.map((s) => ({
        id: s.id,
        citizenName: s.profile_name || 'Resident',
        phoneNumber: s.profile_phone,
        locationStatus: s.lat !== null && s.lng !== null ? 'GPS locked' : 'no fix',
        latitude: s.lat ?? undefined,
        longitude: s.lng ?? undefined,
        barangay: s.barangay || undefined,
        timestamp: s.created_at,
        status: s.status === 'resolved' ? 'Resolved' : s.status === 'acknowledged' ? 'Responding' : 'Active',
        notes: s.note || undefined,
      })),
    [sosLog]
  );

  const [filterStatus, setFilterStatus] = useState<'all' | 'Active' | 'Resolved'>('all');
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Format relative time: e.g. "9h 36m ago"
  const formatTimeAgo = (isoString: string) => {
    const diffMs = Date.now() - new Date(isoString).getTime();
    if (diffMs < 0) return 'just now';
    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    if (totalMinutes < 1) return 'just now';
    if (totalMinutes < 60) return `${totalMinutes}m ago`;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours < 24) {
      return `${hours}h ${mins}m ago`;
    }
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      if (filterStatus === 'Active' && ev.status === 'Resolved') return false;
      if (filterStatus === 'Resolved' && ev.status !== 'Resolved') return false;
      return true;
    });
  }, [events, filterStatus]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* 1. Header Section: SOS Log + Subtitle + Events Counter */}
      <div className="px-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className={`text-xl sm:text-2xl font-semibold tracking-tight ${
            isBarangay ? 'text-[#011025]' : 'text-neutral-900'
          }`}>
            SOS Log
          </h1>
          <p className={`text-xs sm:text-sm mt-0.5 max-w-2xl leading-relaxed ${
            isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'
          }`}>
            Every one-tap SOS received from a citizen, newest first.
          </p>
        </div>

        {/* Top Right Actions & Counter Pill */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className={`px-3.5 py-1.5 rounded-full text-xs font-mono font-medium shadow-2xs flex items-center gap-1.5 ${
            isBarangay
              ? 'bg-[#C2E8FF]/40 text-[#052659] border border-[#7EA0C5]/40'
              : 'bg-neutral-100 text-neutral-800 border border-neutral-200/80'
          }`}>
            <span className={`w-2 h-2 rounded-full animate-pulse ${isBarangay ? 'bg-[#052659]' : 'bg-[#18181b]'}`} />
            <span>{events.length} {events.length === 1 ? 'event' : 'events'}</span>
          </span>
        </div>
      </div>

      {/* Action Flash Notification */}
      {actionNotice && (
        <div className={`p-3.5 rounded-[20px] text-xs font-medium flex items-center justify-between animate-in fade-in ${
          isBarangay
            ? 'bg-[#C2E8FF]/30 border border-[#7EA0C5]/40 text-[#011025]'
            : 'bg-neutral-100/90 border border-neutral-200/80 text-neutral-800'
        }`}>
          <div className="flex items-center gap-2">
            <Check className={`w-4 h-4 shrink-0 ${isBarangay ? 'text-[#052659]' : 'text-neutral-800'}`} />
            <span>{actionNotice}</span>
          </div>
          <button onClick={() => setActionNotice(null)} className={`cursor-pointer ${
            isBarangay ? 'text-[#5482B4] hover:text-[#011025]' : 'text-neutral-400 hover:text-neutral-700'
          }`}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. SOS Events Table Card matching Reference Image List Styling */}
      <div className={`rounded-[24px] shadow-xs overflow-hidden ${
        isBarangay ? 'bg-white border border-[#7EA0C5]/30 shadow-[0_2px_12px_rgba(1,16,37,0.03)]' : 'bg-white border border-neutral-200/70'
      }`}>
        {/* Card Header Bar with Title, Filter Tabs, and Action Icons */}
        <div className={`px-6 py-4.5 border-b flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
          isBarangay ? 'bg-[#C2E8FF]/10 border-[#7EA0C5]/20' : 'bg-neutral-50/50 border-neutral-100'
        }`}>
          <h2 className={`text-sm font-semibold uppercase tracking-wide ${
            isBarangay ? 'text-[#011025]' : 'text-neutral-900'
          }`}>
            SOS Events
          </h2>

          {/* Filter Pills matching reference image time tabs */}
          <div className={`flex items-center gap-1 rounded-full p-1 text-xs font-medium self-start lg:self-auto border ${
            isBarangay ? 'bg-[#C2E8FF]/20 border-[#7EA0C5]/30' : 'bg-neutral-100/70 border-neutral-200/60'
          }`}>
            <button
              onClick={() => setFilterStatus('all')}
              className={`px-3.5 py-1 rounded-full transition-all cursor-pointer ${
                filterStatus === 'all'
                  ? isBarangay ? 'bg-[#052659] text-white shadow-2xs' : 'bg-[#2A2A2A] text-white shadow-2xs'
                  : isBarangay ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/40' : 'text-neutral-600 hover:text-neutral-900 hover:bg-white/60'
              }`}
            >
              All ({events.length})
            </button>
            <button
              onClick={() => setFilterStatus('Active')}
              className={`px-3.5 py-1 rounded-full transition-all cursor-pointer ${
                filterStatus === 'Active'
                  ? isBarangay ? 'bg-[#052659] text-white shadow-2xs' : 'bg-[#2A2A2A] text-white shadow-2xs'
                  : isBarangay ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/40' : 'text-neutral-600 hover:text-neutral-900 hover:bg-white/60'
              }`}
            >
              Active Distress ({events.filter((e) => e.status === 'Active').length})
            </button>
            <button
              onClick={() => setFilterStatus('Resolved')}
              className={`px-3.5 py-1 rounded-full transition-all cursor-pointer ${
                filterStatus === 'Resolved'
                  ? isBarangay ? 'bg-[#052659] text-white shadow-2xs' : 'bg-[#2A2A2A] text-white shadow-2xs'
                  : isBarangay ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/40' : 'text-neutral-600 hover:text-neutral-900 hover:bg-white/60'
              }`}
            >
              Handled ({events.filter((e) => e.status === 'Resolved').length})
            </button>
          </div>
        </div>

        {/* Table Body */}
        <div className="overflow-x-auto">
          {filteredEvents.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <div className={`w-12 h-12 rounded-2xl mx-auto flex items-center justify-center border ${
                isBarangay ? 'bg-[#C2E8FF]/30 text-[#052659] border-[#7EA0C5]/40' : 'bg-neutral-100 text-neutral-600 border-neutral-200'
              }`}>
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <p className={`text-xs sm:text-sm font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-800'}`}>
                No SOS events in this view
              </p>
              <p className={`text-[11px] max-w-sm mx-auto ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
                All incoming one-tap distress calls have been cleared or resolved.
              </p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse min-w-[760px]">
              <thead>
                <tr className={`text-[11px] font-medium border-b ${
                  isBarangay ? 'bg-[#C2E8FF]/5 text-[#5482B4] border-[#7EA0C5]/20' : 'bg-neutral-50/50 text-neutral-400 border-neutral-100'
                }`}>
                  <th className="px-6 py-3.5">Citizen / Caller</th>
                  <th className="px-6 py-3.5">Contact Number</th>
                  <th className="px-6 py-3.5">Location / GPS</th>
                  <th className="px-6 py-3.5">Reported</th>
                  <th className="px-6 py-3.5 text-right">Status & Actions</th>
                </tr>
              </thead>
              <tbody className={`text-xs ${isBarangay ? 'divide-y divide-[#7EA0C5]/15' : 'divide-y divide-neutral-100'}`}>
                {filteredEvents.map((event) => (
                  <tr
                    key={event.id}
                    className={`transition-colors ${
                      isBarangay ? 'hover:bg-[#C2E8FF]/15' : 'hover:bg-neutral-50/60'
                    }`}
                  >
                    {/* Citizen / Caller */}
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <span
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            isBarangay
                              ? event.status === 'Active'
                                ? 'bg-[#052659] animate-pulse ring-4 ring-[#C2E8FF]'
                                : 'bg-[#7EA0C5]/40'
                              : event.status === 'Active'
                              ? 'bg-[#18181b] animate-pulse ring-4 ring-neutral-200/60'
                              : 'bg-neutral-300'
                          }`}
                        />
                        <div>
                          <div className={`font-semibold text-sm ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
                            {event.citizenName}
                          </div>
                          {event.notes && (
                            <div
                              title={event.notes}
                              className={`text-[11px] truncate max-w-xs ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'} cursor-help`}
                            >
                              {event.notes}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Contact Number */}
                    <td className="px-6 py-4 font-mono text-xs">
                      <a
                        href={telHref(event.phoneNumber)}
                        className={`inline-flex items-center gap-1.5 font-semibold transition-colors ${
                          isBarangay ? 'text-[#011025] hover:text-[#052659]' : 'text-neutral-800 hover:text-black'
                        }`}
                      >
                        <Phone className={`w-3.5 h-3.5 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'}`} />
                        <span>{event.phoneNumber}</span>
                      </a>
                    </td>

                    {/* Location / GPS */}
                    <td className={`px-6 py-4 text-xs ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-600'}`}>
                      <div
                        className="inline-flex items-center gap-1.5 cursor-help"
                        title={
                          event.locationStatus === 'no fix'
                            ? 'GPS: No satellite fix'
                            : `Exact GPS Coordinates: ${event.latitude?.toFixed(5)}, ${event.longitude?.toFixed(5)}`
                        }
                      >
                        <MapPin className={`w-3.5 h-3.5 shrink-0 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'}`} />
                        <span className={`font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-800'}`}>
                          {event.barangay ? `Brgy. ${event.barangay}` : 'Lingayen'}
                        </span>
                        {event.latitude && event.longitude && (
                          <span className={`font-mono text-[10px] ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`}>
                            &bull; GPS ready
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Reported */}
                    <td className={`px-6 py-4 text-xs font-mono ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
                      <div className="inline-flex items-center gap-1.5">
                        <Clock className={`w-3.5 h-3.5 shrink-0 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'}`} />
                        <span>{formatTimeAgo(event.timestamp)}</span>
                      </div>
                    </td>

                    {/* Status & Actions */}
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2 shrink-0">
                        {/* Direct Dial Call Button */}
                        <a
                          href={telHref(event.phoneNumber)}
                          className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer shadow-2xs shrink-0 ${
                            isBarangay
                              ? 'bg-[#C2E8FF]/30 hover:bg-[#C2E8FF]/60 text-[#052659] border border-[#7EA0C5]/40'
                              : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-200'
                          }`}
                          title="Call citizen immediately"
                        >
                          <PhoneCall className="w-3.5 h-3.5" />
                        </a>

                        {/* Locate on Radar if coordinates present */}
                        {event.latitude && event.longitude && canNavigate(event.latitude, event.longitude) && (
                          <button
                            onClick={() => window.open(wazeUrl(event.latitude!, event.longitude!), '_blank', 'noopener,noreferrer')}
                            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer shadow-2xs shrink-0 ${
                              isBarangay
                                ? 'bg-[#C2E8FF]/30 hover:bg-[#C2E8FF]/60 text-[#052659] border border-[#7EA0C5]/40'
                                : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-200'
                            }`}
                            title="Navigate with Waze"
                          >
                            <Navigation className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* SOS Right Pill - Equal width/height container */}
                        <span className={`w-20 h-8 rounded-full inline-flex items-center justify-center text-center text-xs font-medium tracking-wide shadow-2xs shrink-0 ${
                          isBarangay
                            ? event.status === 'Active'
                              ? 'bg-[#052659] text-white border border-[#011025]/20'
                              : 'bg-[#5482B4] text-white'
                            : 'bg-[#70757a] text-white'
                        }`}>
                          {event.status === 'Active' ? 'SOS' : 'Handled'}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
