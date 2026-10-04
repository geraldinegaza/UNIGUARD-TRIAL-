import React, { useState, useMemo } from 'react';
import {
  EvacuationCenter,
  User,
  Barangay,
  EvacuationStatus
} from '../types';
import * as repo from '../services/repo';
import { canNavigate, classifyCoords, coordMessage, fmtCoords, wazeUrl } from '../lib/geo';
import {
  Building2,
  Users,
  MapPin,
  Check,
  Search,
  Download,
  Navigation,
  ShieldCheck,
  Radio,
  X,
  Phone,
  AlertTriangle,
  Layers,
  Compass,
  Home,
  CheckCircle,
  ExternalLink,
  Edit3,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ShieldAlert,
  Bell
} from 'lucide-react';

interface EvacuationDirectoryProps {
  evacuationCenters: EvacuationCenter[];
  currentUser: User;
  barangays: Barangay[];
  isOnline: boolean;
  onSelectOnMap?: (center: EvacuationCenter) => void;
}

export const EvacuationDirectory: React.FC<EvacuationDirectoryProps> = ({
  evacuationCenters,
  currentUser,
  barangays,
  isOnline,
  onSelectOnMap,
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'full' | 'closed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBarangay, setSelectedBarangay] = useState<string>('all');
  const [savedOfflineToast, setSavedOfflineToast] = useState<string | null>(null);
  
  // Quick Edit Modal
  const [editingCenter, setEditingCenter] = useState<EvacuationCenter | null>(null);
  const [editOccupancy, setEditOccupancy] = useState<number>(0);
  const [editStatus, setEditStatus] = useState<EvacuationStatus>('open');

  // Live counts for status pills (2 open, 1 full, 2 closed matching initial draft)
  const counts = useMemo(() => {
    return {
      all: evacuationCenters.length,
      open: evacuationCenters.filter((c) => c.status === 'open').length,
      full: evacuationCenters.filter((c) => c.status === 'full').length,
      closed: evacuationCenters.filter((c) => c.status === 'closed').length,
    };
  }, [evacuationCenters]);

  // Filtered evacuation centers
  const filteredCenters = useMemo(() => {
    return evacuationCenters.filter((center) => {
      if (statusFilter !== 'all' && center.status !== statusFilter) return false;
      if (selectedBarangay !== 'all' && center.barangay_id !== selectedBarangay) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = center.name.toLowerCase().includes(q);
        const matchesAddress = center.address.toLowerCase().includes(q);
        const matchesBarangay = center.barangay_id.toLowerCase().includes(q);
        const matchesHash = center.id.toLowerCase().includes(q);
        if (!matchesName && !matchesAddress && !matchesBarangay && !matchesHash) return false;
      }
      return true;
    });
  }, [evacuationCenters, statusFilter, selectedBarangay, searchQuery]);

  const flash = (message: string) => {
    setSavedOfflineToast(message);
    setTimeout(() => setSavedOfflineToast(null), 3000);
  };

  // Status Change Handler (Direct toggle from card buttons)
  const handleQuickStatusChange = async (center: EvacuationCenter, newStatus: EvacuationStatus) => {
    try {
      await repo.updateCenter(center.id, { status: newStatus });
      flash(`Updated ${center.name} status to ${newStatus.toUpperCase()}`);
    } catch (err: any) {
      flash(err.message || 'Could not update the shelter');
    }
  };

  // Waze navigation is only offered for a clean, in-town coordinate
  const navigateTo = (center: { name: string; latitude: number; longitude: number; has_location: boolean }, notify: (m: string) => void) => {
    if (center.has_location && canNavigate(center.latitude, center.longitude)) {
      window.open(wazeUrl(center.latitude, center.longitude), '_blank', 'noopener,noreferrer');
      return;
    }
    const state = center.has_location ? classifyCoords(center.latitude, center.longitude) : 'missing';
    notify(coordMessage(state) || 'Navigation is unavailable for this location.');
  };

  const handleOpenEdit = (center: EvacuationCenter) => {
    setEditingCenter(center);
    setEditOccupancy(center.current_occupancy);
    setEditStatus(center.status);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCenter) return;

    try {
      await repo.updateCenter(editingCenter.id, {
        current_occupancy: Number(editOccupancy),
        status: editStatus,
      });
      flash(`Updated capacity for ${editingCenter.name}`);
      setEditingCenter(null);
    } catch (err: any) {
      flash(err.message || 'Could not update the shelter');
    }
  };

  const getBarangayDisplayName = (barangayId: string) => {
    const found = barangays.find((b) => b.id.toLowerCase() === barangayId.toLowerCase());
    if (found) return found.name;
    return barangayId
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  // Check if current user is a citizen resident
  const isResident = currentUser?.role === 'citizen';
  const isBarangay = currentUser?.role === 'barangay';

  // Resident state & data matching the Home tab design and style
  const [residentFilter, setResidentFilter] = useState<'all' | 'open' | 'full' | 'closed'>('all');
  const [residentSearchQuery, setResidentSearchQuery] = useState<string>('');
  const [residentSelectedBarangay, setResidentSelectedBarangay] = useState<string>('all');
  const [savedOfflineNotice, setSavedOfflineNotice] = useState<string | null>(null);

  const residentSheltersList = useMemo(
    () =>
      evacuationCenters.map((c) => ({
        id: c.id,
        raw: c,
        name: c.name,
        status: c.status,
        barangay_id: c.barangay_id,
        barangay: c.barangay_name || getBarangayDisplayName(c.barangay_id),
        address: c.address,
        occupied: c.current_occupancy,
        capacity: c.capacity,
        notes: c.notes || '',
        latitude: c.latitude,
        longitude: c.longitude,
      })),
    [evacuationCenters, barangays]
  );

  const residentCounts = useMemo(() => ({
    all: residentSheltersList.length,
    open: residentSheltersList.filter((s) => s.status === 'open').length,
    full: residentSheltersList.filter((s) => s.status === 'full').length,
    closed: residentSheltersList.filter((s) => s.status === 'closed').length,
  }), [residentSheltersList]);

  // Filtered resident shelters with search & barangay filter
  const filteredResidentShelters = useMemo(() => {
    return residentSheltersList.filter((s) => {
      if (residentFilter !== 'all' && s.status !== residentFilter) return false;
      if (residentSelectedBarangay !== 'all' && s.barangay_id !== residentSelectedBarangay) return false;
      if (residentSearchQuery.trim()) {
        const q = residentSearchQuery.toLowerCase().trim();
        const matchesName = s.name.toLowerCase().includes(q);
        const matchesBarangay = s.barangay.toLowerCase().includes(q);
        const matchesNotes = s.notes.toLowerCase().includes(q);
        const matchesAddress = (s.address || '').toLowerCase().includes(q);
        if (!matchesName && !matchesBarangay && !matchesNotes && !matchesAddress) return false;
      }
      return true;
    });
  }, [residentSheltersList, residentFilter, residentSelectedBarangay, residentSearchQuery]);

  // If currentUser is a resident, render with the exact design and layout of the Home tab
  if (isResident) {
    return (
      <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-200">
        {/* Section: Evacuation Directory & Live Status (Matching Home's Container & Section Card Style) */}
        <div className="bg-white rounded-3xl border border-neutral-100/80 overflow-hidden shadow-xl hover:shadow-2xl transition-shadow">
          <div className="p-6 sm:p-7 pb-5 border-b border-neutral-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white">
            <div>
              <h3 className="text-base sm:text-lg font-bold text-neutral-900 tracking-tight">
                Evacuation Directory & Live Status
              </h3>
              <p className="text-xs text-neutral-500 mt-0.5">
                Real-time intake capacities, facility amenities, and driving routes across Lingayen
              </p>
            </div>

            <span className="text-xs font-bold text-red-900 bg-red-50 border border-red-900/20 px-3.5 py-1.5 rounded-full w-fit">
              {filteredResidentShelters.length} of {residentSheltersList.length} shelters shown
            </span>
          </div>

          {/* Filter & Search Toolbar */}
          <div className="p-6 sm:p-7 pt-5 pb-5 border-b border-neutral-100 bg-neutral-50/40 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
            {/* Filter segmented buttons matching Home style */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
              <button
                onClick={() => setResidentFilter('all')}
                className={`px-4 py-2 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  residentFilter === 'all'
                    ? 'bg-red-900 text-white shadow-md'
                    : 'bg-white text-neutral-700 border border-neutral-200 hover:border-red-900/40 hover:bg-red-50/30'
                }`}
              >
                <span>All</span>
                <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                  residentFilter === 'all' ? 'bg-white/20 text-white' : 'bg-neutral-100 text-neutral-700'
                }`}>
                  {residentCounts.all}
                </span>
              </button>

              <button
                onClick={() => setResidentFilter('open')}
                className={`px-4 py-2 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  residentFilter === 'open'
                    ? 'bg-red-900 text-white shadow-md'
                    : 'bg-white text-neutral-700 border border-neutral-200 hover:border-red-900/40 hover:bg-red-50/30'
                }`}
              >
                <span>Open</span>
                <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                  residentFilter === 'open' ? 'bg-white/20 text-white' : 'bg-neutral-100 text-neutral-700'
                }`}>
                  {residentCounts.open}
                </span>
              </button>

              <button
                onClick={() => setResidentFilter('full')}
                className={`px-4 py-2 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  residentFilter === 'full'
                    ? 'bg-red-900 text-white shadow-md'
                    : 'bg-white text-neutral-700 border border-neutral-200 hover:border-red-900/40 hover:bg-red-50/30'
                }`}
              >
                <span>Full</span>
                <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                  residentFilter === 'full' ? 'bg-white/20 text-white' : 'bg-neutral-100 text-neutral-700'
                }`}>
                  {residentCounts.full}
                </span>
              </button>

              <button
                onClick={() => setResidentFilter('closed')}
                className={`px-4 py-2 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  residentFilter === 'closed'
                    ? 'bg-red-900 text-white shadow-md'
                    : 'bg-white text-neutral-700 border border-neutral-200 hover:border-red-900/40 hover:bg-red-50/30'
                }`}
              >
                <span>Closed</span>
                <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                  residentFilter === 'closed' ? 'bg-white/20 text-white' : 'bg-neutral-100 text-neutral-700'
                }`}>
                  {residentCounts.closed}
                </span>
              </button>
            </div>

            {/* Search and Barangay Selector */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={residentSearchQuery}
                  onChange={(e) => setResidentSearchQuery(e.target.value)}
                  placeholder="Search shelter name or street..."
                  className="w-full pl-9 pr-8 py-2 text-xs bg-white border border-neutral-200 rounded-xl focus:border-red-900 focus:outline-hidden transition-colors"
                />
                {residentSearchQuery && (
                  <button
                    onClick={() => setResidentSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <select
                value={residentSelectedBarangay}
                onChange={(e) => setResidentSelectedBarangay(e.target.value)}
                className="py-2 px-3 text-xs bg-white border border-neutral-200 rounded-xl focus:border-red-900 focus:outline-hidden text-neutral-700 font-medium cursor-pointer"
              >
                <option value="all">All Barangays</option>
                {barangays.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Shelters Grid */}
          <div className="p-6 sm:p-7">
            {filteredResidentShelters.length === 0 ? (
              <div className="text-center py-12 text-neutral-400 space-y-2">
                <Building2 className="w-10 h-10 mx-auto text-neutral-300" />
                <p className="text-sm font-semibold text-neutral-600">No evacuation centers match your search</p>
                <p className="text-xs text-neutral-400">Try adjusting your filter or search query</p>
                <button
                  onClick={() => {
                    setResidentFilter('all');
                    setResidentSearchQuery('');
                    setResidentSelectedBarangay('all');
                  }}
                  className="mt-2 text-xs font-bold text-red-900 hover:underline cursor-pointer"
                >
                  Clear all filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredResidentShelters.map((s) => {
                  const percent = s.capacity > 0 ? Math.round((s.occupied / s.capacity) * 100) : 0;
                  const remaining = Math.max(0, s.capacity - s.occupied);
                  const rawCenter = s.raw || evacuationCenters.find((c) => c.id === s.id);

                  return (
                    <div
                      key={s.id}
                      className="p-6 rounded-3xl border border-neutral-100 bg-neutral-50/50 hover:bg-red-50/30 transition-all duration-300 flex flex-col justify-between space-y-5 shadow-xs hover:shadow-lg group"
                    >
                      <div className="space-y-3.5">
                        {/* Top: Name & Status Badge */}
                        <div className="flex items-start justify-between gap-3">
                          <h4 className="text-base font-bold text-neutral-900 group-hover:text-red-900 transition-colors leading-snug line-clamp-2">
                            {s.name}
                          </h4>

                          <span
                            className={`text-xs font-bold uppercase px-3 py-1 rounded-full shrink-0 shadow-2xs ${
                              s.status === 'open'
                                ? 'bg-red-50 text-red-900 border border-red-900/30'
                                : s.status === 'full'
                                ? 'bg-neutral-900 text-white border border-neutral-900'
                                : 'bg-neutral-200 text-neutral-600 border border-neutral-300'
                            }`}
                          >
                            {s.status}
                          </span>
                        </div>

                        {/* Location & Slots info */}
                        <div className="space-y-1.5 text-xs text-neutral-600 font-medium">
                          <div className="flex items-center gap-2">
                            <MapPin className="w-3.5 h-3.5 text-red-900 shrink-0" />
                            <span className="truncate">Brgy. {s.barangay}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Users className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                            <span className="font-mono tabular-nums text-neutral-800">
                              {s.occupied} / {s.capacity} evacuees
                            </span>
                          </div>
                        </div>

                        {/* Capacity Progress Bar */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-500 font-mono">
                            <span>{percent}% occupied</span>
                            <span>{remaining} slots left</span>
                          </div>
                          <div className="w-full bg-neutral-200/80 h-2 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                s.status === 'open'
                                  ? 'bg-gradient-to-r from-red-700 to-red-900'
                                  : s.status === 'full'
                                  ? 'bg-neutral-800'
                                  : 'bg-neutral-400'
                              }`}
                              style={{ width: `${Math.min(100, percent)}%` }}
                            />
                          </div>
                        </div>

                        {/* Notes */}
                        <p className="text-xs text-neutral-500 leading-relaxed line-clamp-2">
                          {s.notes}
                        </p>
                      </div>

                      {/* Card Action Buttons */}
                      <div className="pt-4 border-t border-neutral-200/70 flex items-center gap-2">
                        <button
                          onClick={() =>
                            navigateTo(s.raw, (m) => {
                              setSavedOfflineNotice(m);
                              setTimeout(() => setSavedOfflineNotice(null), 3000);
                            })
                          }
                          className="flex-1 bg-red-900 hover:bg-red-800 text-white py-2.5 px-3 rounded-xl text-xs font-bold transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                        >
                          <Compass className="w-3.5 h-3.5" />
                          <span>Navigate with Waze</span>
                        </button>

                        <button
                          onClick={async () => {
                            await repo.saveOffline();
                            setSavedOfflineNotice('Shelter list saved for offline use');
                            setTimeout(() => setSavedOfflineNotice(null), 3000);
                          }}
                          className="w-10 h-10 rounded-xl bg-white hover:bg-red-50 text-red-900 border border-red-900/20 flex items-center justify-center transition-all shadow-xs cursor-pointer active:scale-95 shrink-0"
                          title="Download offline coordinates"
                        >
                          <Download className="w-4 h-4" />
                        </button>

                        {onSelectOnMap && rawCenter && (
                          <button
                            onClick={() => onSelectOnMap(rawCenter)}
                            className="w-10 h-10 rounded-xl bg-white hover:bg-red-50 text-red-900 border border-red-900/20 flex items-center justify-center transition-all shadow-xs cursor-pointer active:scale-95 shrink-0"
                            title="View shelter on Map"
                          >
                            <MapPin className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Offline Notification Toast */}
        {savedOfflineNotice && (
          <div className="fixed bottom-6 right-6 bg-neutral-900 text-white px-5 py-3 rounded-2xl shadow-2xl text-xs font-bold animate-in slide-in-from-bottom-2 z-50 flex items-center gap-2 border border-white/20">
            <Check className="w-4 h-4 text-emerald-400" />
            <span>{savedOfflineNotice}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-7 animate-in fade-in duration-300">
      {/* 1. Header Section: Evacuation Centers + Subtitle + Live Status Counter Pills */}
      <div className="px-1 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className={`text-xl sm:text-2xl font-semibold tracking-tight ${
            isBarangay ? 'text-[#011025]' : 'text-neutral-900'
          }`}>
            Evacuation Centers
          </h1>
          <p className={`text-xs sm:text-sm mt-0.5 max-w-2xl leading-relaxed ${
            isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'
          }`}>
            Keep capacity and availability accurate so residents arrive at a shelter with space.
          </p>
        </div>

        {/* Right Status Counter Pills */}
        <div className={`flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none p-1.5 rounded-full border w-fit max-w-full ${
          isBarangay
            ? 'bg-[#C2E8FF]/20 border-[#7EA0C5]/30'
            : 'bg-neutral-100/60 border-neutral-200/60'
        }`}>
          {/* All Filter Pill */}
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
              statusFilter === 'all'
                ? isBarangay ? 'bg-[#052659] text-white shadow-2xs' : 'bg-[#2A2A2A] text-white shadow-2xs'
                : isBarangay ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/40' : 'text-neutral-600 hover:text-neutral-900 hover:bg-white/60'
            }`}
          >
            <span>All</span>
            <span
              className={`font-mono text-[10px] px-1.5 py-0.2 rounded-full font-medium ${
                statusFilter === 'all'
                  ? 'bg-white/20 text-white'
                  : isBarangay
                  ? 'bg-[#C2E8FF]/60 text-[#052659]'
                  : 'bg-neutral-200/80 text-neutral-700'
              }`}
            >
              {counts.all}
            </span>
          </button>

          {/* Open Pill */}
          <button
            onClick={() => setStatusFilter(statusFilter === 'open' ? 'all' : 'open')}
            className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
              statusFilter === 'open'
                ? isBarangay ? 'bg-[#052659] text-white shadow-2xs' : 'bg-[#2A2A2A] text-white shadow-2xs'
                : isBarangay ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/40' : 'text-neutral-600 hover:text-neutral-900 hover:bg-white/60'
            }`}
          >
            <Home className="w-3.5 h-3.5" />
            <span>{counts.open} open</span>
          </button>

          {/* Full Pill */}
          <button
            onClick={() => setStatusFilter(statusFilter === 'full' ? 'all' : 'full')}
            className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
              statusFilter === 'full'
                ? isBarangay ? 'bg-[#052659] text-white shadow-2xs' : 'bg-[#2A2A2A] text-white shadow-2xs'
                : isBarangay ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/40' : 'text-neutral-600 hover:text-neutral-900 hover:bg-white/60'
            }`}
          >
            <Home className="w-3.5 h-3.5" />
            <span>{counts.full} full</span>
          </button>

          {/* Closed Pill */}
          <button
            onClick={() => setStatusFilter(statusFilter === 'closed' ? 'all' : 'closed')}
            className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
              statusFilter === 'closed'
                ? isBarangay ? 'bg-[#052659] text-white shadow-2xs' : 'bg-[#2A2A2A] text-white shadow-2xs'
                : isBarangay ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/40' : 'text-neutral-600 hover:text-neutral-900 hover:bg-white/60'
            }`}
          >
            <Home className="w-3.5 h-3.5" />
            <span>{counts.closed} closed</span>
          </button>
        </div>
      </div>

      {/* 2. Filter & Search Controls */}
      <div className={`rounded-[24px] p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 ${
        isBarangay ? 'bg-white border border-[#7EA0C5]/30 shadow-[0_2px_12px_rgba(1,16,37,0.03)]' : 'bg-white border border-neutral-200/70'
      }`}>
        <div className="relative flex-1">
          <Search className={`w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none ${
            isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'
          }`} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by shelter name, barangay, or hash ID..."
            className={`w-full pl-10 pr-9 py-2.5 text-xs font-medium rounded-full focus:outline-hidden transition-all shadow-2xs ${
              isBarangay
                ? 'text-[#011025] placeholder-[#5482B4]/60 bg-[#C2E8FF]/10 hover:bg-[#C2E8FF]/20 focus:bg-white border border-[#7EA0C5]/30 focus:border-[#052659] focus:ring-2 focus:ring-[#C2E8FF]'
                : 'text-neutral-800 placeholder-neutral-400 bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white border border-neutral-200 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50'
            }`}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className={`absolute right-3.5 top-1/2 -translate-y-1/2 cursor-pointer ${
                isBarangay ? 'text-[#5482B4] hover:text-[#011025]' : 'text-neutral-400 hover:text-neutral-700'
              }`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedBarangay}
            onChange={(e) => setSelectedBarangay(e.target.value)}
            className={`text-xs font-medium rounded-full px-4 py-2.5 focus:outline-hidden shadow-2xs cursor-pointer ${
              isBarangay
                ? 'text-[#011025] bg-[#C2E8FF]/10 hover:bg-[#C2E8FF]/20 focus:bg-white border border-[#7EA0C5]/30 focus:border-[#052659]'
                : 'text-neutral-800 bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white border border-neutral-200 focus:border-neutral-400'
            }`}
          >
            <option value="all">All Barangays</option>
            {barangays.map((b) => (
              <option key={b.id} value={b.id}>
                Brgy. {b.name}
              </option>
            ))}
          </select>

          <span className={`text-xs font-medium whitespace-nowrap pl-1 ${
            isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'
          }`}>
            {filteredCenters.length} of {evacuationCenters.length} shelters
          </span>
        </div>
      </div>

      {/* 3. Shelter Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {filteredCenters.map((center) => {
          const percent = center.capacity > 0 ? Math.round((center.current_occupancy / center.capacity) * 100) : 0;
          const hashDisplay = center.id;
          const coordsDisplay = center.has_location ? fmtCoords(center.latitude, center.longitude) : 'No coordinates recorded';

          return (
            <div
              key={center.id}
              className={`rounded-[20px] sm:rounded-[24px] shadow-xs transition-all p-5 flex flex-col justify-between space-y-4 ${
                isBarangay
                  ? 'bg-white border border-[#7EA0C5]/30 shadow-[0_2px_12px_rgba(1,16,37,0.03)] hover:border-[#5482B4]/60 hover:shadow-md'
                  : 'bg-white border border-neutral-200/70 hover:border-neutral-300 hover:shadow-sm'
              }`}
            >
              <div className="space-y-3">
                {/* Header row: Shelter Name + Status Badge */}
                <div className="flex items-start justify-between gap-2">
                  <h3 className={`text-sm sm:text-base font-semibold leading-snug ${
                    isBarangay ? 'text-[#011025]' : 'text-neutral-900'
                  }`}>
                    {center.name}
                  </h3>

                  {center.status === 'open' && (
                    <span className={`text-[10px] font-medium uppercase px-2.5 py-0.5 rounded-full shadow-2xs shrink-0 ${
                      isBarangay
                        ? 'bg-[#C2E8FF]/60 text-[#052659] border border-[#7EA0C5]/40'
                        : 'bg-neutral-100 text-neutral-800 border border-neutral-200'
                    }`}>
                      OPEN
                    </span>
                  )}
                  {center.status === 'full' && (
                    <span className={`text-[10px] font-medium uppercase px-2.5 py-0.5 rounded-full shadow-2xs shrink-0 ${
                      isBarangay
                        ? 'bg-[#052659] text-white border border-[#011025]/40'
                        : 'bg-[#18181b] text-white'
                    }`}>
                      FULL
                    </span>
                  )}
                  {center.status === 'closed' && (
                    <span className={`text-[10px] font-medium uppercase px-2.5 py-0.5 rounded-full shadow-2xs shrink-0 ${
                      isBarangay
                        ? 'bg-[#5482B4] text-white border border-[#5482B4]'
                        : 'bg-[#70757a] text-white'
                    }`}>
                      CLOSED
                    </span>
                  )}
                </div>

                {/* Barangay with Location Pin */}
                <div className={`flex items-center gap-1.5 text-xs ${
                  isBarangay ? 'text-[#5482B4]' : 'text-neutral-600'
                }`}>
                  <MapPin className={`w-3.5 h-3.5 shrink-0 ${
                    isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'
                  }`} />
                  <span className={`font-semibold ${
                    isBarangay ? 'text-[#011025]' : 'text-neutral-800'
                  }`}>{getBarangayDisplayName(center.barangay_id)}</span>
                </div>

                {/* Unique Hash / Layer Identifier matching draft */}
                <div className={`flex items-center gap-1.5 text-[11px] font-mono ${
                  isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'
                }`}>
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{hashDisplay}</span>
                </div>

                {/* GPS Coordinates matching draft */}
                <div className={`flex items-center gap-1.5 text-[11px] font-mono ${
                  isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'
                }`}>
                  <Compass className={`w-3.5 h-3.5 shrink-0 ${
                    isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'
                  }`} />
                  <span>{coordsDisplay}</span>
                </div>

                {/* Occupancy Header & Metrics matching draft */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className={`font-medium ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-600'}`}>Occupancy</span>
                    <span className={`font-mono font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
                      {center.current_occupancy} / {center.capacity} &bull; {percent}%
                    </span>
                  </div>

                  {/* Visual Progress Bar */}
                  <div className={`w-full h-2 rounded-full overflow-hidden border ${
                    isBarangay ? 'bg-[#C2E8FF]/20 border-[#7EA0C5]/30' : 'bg-neutral-100 border-neutral-200/60'
                  }`}>
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isBarangay
                          ? center.status === 'full'
                            ? 'bg-[#052659]'
                            : percent > 85
                            ? 'bg-[#052659]'
                            : percent > 0
                            ? 'bg-[#5482B4]'
                            : 'bg-[#7EA0C5]/40'
                          : center.status === 'full'
                          ? 'bg-[#70757a]'
                          : percent > 85
                          ? 'bg-[#18181b]'
                          : percent > 0
                          ? 'bg-[#18181b]'
                          : 'bg-neutral-300'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                    />
                  </div>
                </div>

                {/* GIS / Source Note matching draft */}
                <p className={`text-[11px] leading-relaxed font-normal pt-1 ${
                  isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'
                }`}>
                  {center.notes}
                </p>
              </div>

              {/* Bottom Actions: 3-Segment Status Switcher + Navigate with Waze */}
              <div className={`space-y-2.5 pt-3 border-t ${isBarangay ? 'border-[#7EA0C5]/20' : 'border-neutral-100'}`}>
                {/* 3-Segment Status Switcher: Open | Full | Closed */}
                <div className={`grid grid-cols-3 gap-1 p-1 rounded-full border ${
                  isBarangay ? 'bg-[#C2E8FF]/20 border-[#7EA0C5]/30' : 'bg-neutral-100/70 border-neutral-200/60'
                }`}>
                  <button
                    onClick={() => handleQuickStatusChange(center, 'open')}
                    className={`py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer ${
                      center.status === 'open'
                        ? isBarangay ? 'bg-[#052659] text-white shadow-2xs' : 'bg-[#2A2A2A] text-white shadow-2xs'
                        : isBarangay ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/40' : 'text-neutral-600 hover:text-neutral-900 hover:bg-white/60'
                    }`}
                  >
                    Open
                  </button>

                  <button
                    onClick={() => handleQuickStatusChange(center, 'full')}
                    className={`py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer ${
                      center.status === 'full'
                        ? isBarangay ? 'bg-[#052659] text-white shadow-2xs' : 'bg-[#2A2A2A] text-white shadow-2xs'
                        : isBarangay ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/40' : 'text-neutral-600 hover:text-neutral-900 hover:bg-white/60'
                    }`}
                  >
                    Full
                  </button>

                  <button
                    onClick={() => handleQuickStatusChange(center, 'closed')}
                    className={`py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer ${
                      center.status === 'closed'
                        ? isBarangay ? 'bg-[#052659] text-white shadow-2xs' : 'bg-[#2A2A2A] text-white shadow-2xs'
                        : isBarangay ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/40' : 'text-neutral-600 hover:text-neutral-900 hover:bg-white/60'
                    }`}
                  >
                    Closed
                  </button>
                </div>

                {/* Navigate with Waze Full-Width Button */}
                <button
                  onClick={() => navigateTo(center, flash)}
                  className={`w-full py-2.5 px-4 rounded-full text-xs font-medium transition flex items-center justify-center gap-2 cursor-pointer shadow-xs active:scale-98 ${
                    isBarangay
                      ? 'bg-[#052659] hover:bg-[#031c42] text-white border border-[#011025]/20'
                      : 'bg-[#18181b] hover:bg-neutral-800 text-white'
                  }`}
                >
                  <Navigation className="w-3.5 h-3.5" />
                  <span>Navigate with Waze</span>
                </button>

                {/* Secondary Utility Actions: Edit Occupancy & Pin on Map */}
                <div className="flex items-center justify-between text-[11px] pt-1">
                  <button
                    onClick={() => handleOpenEdit(center)}
                    className={`flex items-center gap-1 cursor-pointer font-medium ${
                      isBarangay ? 'text-[#5482B4] hover:text-[#052659]' : 'text-neutral-500 hover:text-neutral-900'
                    }`}
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>Edit Occupants</span>
                  </button>

                  {onSelectOnMap && (
                    <button
                      onClick={() => onSelectOnMap(center)}
                      className={`font-semibold cursor-pointer hover:underline ${
                        isBarangay ? 'text-[#052659] hover:text-[#011025]' : 'text-neutral-900 hover:text-black'
                      }`}
                    >
                      Locate on Radar &rarr;
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Offline Toast Notification */}
      {savedOfflineToast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-full shadow-2xl text-xs font-medium flex items-center gap-2.5 animate-in slide-in-from-bottom-2 ${
          isBarangay
            ? 'bg-[#052659] text-white border border-[#7EA0C5]/40'
            : 'bg-[#18181b] text-white border border-neutral-800'
        }`}>
          <Check className={`w-4 h-4 ${isBarangay ? 'text-[#C2E8FF]' : 'text-neutral-300'}`} />
          <span>{savedOfflineToast}</span>
        </div>
      )}

      {/* Admin Update Evacuation Stats Modal */}
      {editingCenter && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className={`bg-white rounded-[24px] max-w-md w-full p-6 shadow-2xl animate-in zoom-in-95 ${
            isBarangay ? 'border border-[#7EA0C5]/40' : 'border border-neutral-200/80'
          }`}>
            <h3 className={`font-semibold text-base mb-1 ${
              isBarangay ? 'text-[#011025]' : 'text-neutral-900'
            }`}>
              Update Evacuation Shelter Capacity
            </h3>
            <p className={`text-xs mb-4 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
              {editingCenter.name}
            </p>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className={`block text-xs font-semibold mb-1 ${
                  isBarangay ? 'text-[#052659]' : 'text-neutral-700'
                }`}>Shelter Status</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as EvacuationStatus)}
                  className={`w-full text-xs font-medium rounded-xl p-2.5 outline-hidden cursor-pointer transition-all ${
                    isBarangay
                      ? 'bg-[#C2E8FF]/10 text-[#011025] border border-[#7EA0C5]/40 focus:bg-white focus:border-[#052659]'
                      : 'bg-neutral-50/70 border border-neutral-200 focus:bg-white focus:border-neutral-400'
                  }`}
                >
                  <option value="open">Open (Available)</option>
                  <option value="full">Full (At Max Capacity)</option>
                  <option value="closed">Closed</option>
                </select>
              </div>

              <div>
                <label className={`block text-xs font-semibold mb-1 ${
                  isBarangay ? 'text-[#052659]' : 'text-neutral-700'
                }`}>
                  Current Occupant Headcount (Max Capacity: {editingCenter.capacity})
                </label>
                <input
                  type="number"
                  min="0"
                  max={editingCenter.capacity * 1.5}
                  value={editOccupancy}
                  onChange={(e) => setEditOccupancy(Number(e.target.value))}
                  className={`w-full text-xs font-mono p-2.5 rounded-xl outline-hidden transition-all ${
                    isBarangay
                      ? 'bg-[#C2E8FF]/10 text-[#011025] border border-[#7EA0C5]/40 focus:bg-white focus:border-[#052659]'
                      : 'bg-neutral-50/70 border border-neutral-200 focus:bg-white focus:border-neutral-400'
                  }`}
                />
              </div>

              <div className={`flex items-center justify-end gap-2.5 pt-2 border-t ${
                isBarangay ? 'border-[#7EA0C5]/20' : 'border-neutral-100'
              }`}>
                <button
                  type="button"
                  onClick={() => setEditingCenter(null)}
                  className={`px-4 py-2 text-xs font-medium rounded-full cursor-pointer transition-colors ${
                    isBarangay ? 'text-[#5482B4] hover:bg-[#C2E8FF]/30' : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`px-5 py-2 text-xs font-medium text-white rounded-full shadow-xs cursor-pointer transition-colors ${
                    isBarangay ? 'bg-[#052659] hover:bg-[#031c42] border border-[#011025]/20' : 'bg-[#18181b] hover:bg-neutral-800'
                  }`}
                >
                  Save Updates
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
