import { t } from '../lib/i18n';
import React, { useState, useMemo, useEffect } from 'react';
import { useRepo } from '../hooks/useRepo';
import { ItemFocus, openable, useFocusItem } from '../hooks/useFocusItem';
import { DetailBar, DetailModal, DetailRow } from './DetailModal';
import { telHref } from '../lib/util';
import {
  EvacuationCenter,
  User,
  Barangay,
  EvacuationStatus
} from '../types';
import * as repo from '../services/repo';
import { canNavigate, classifyCoords, coordMessage, fmtCoords, locate, wazeUrl } from '../lib/geo';
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
  FileText,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ShieldAlert,
  Bell,
  TrendingUp
} from 'lucide-react';

// Facilities offered as one-tap choices; anything else goes in "Other facilities"
const FACILITY_PRESETS = ['Toilets', 'Drinking water', 'Generator', 'Kitchen', 'Medical station', 'PWD access', 'Breastfeeding area', 'Pet area'];

interface EvacuationDirectoryProps {
  evacuationCenters: EvacuationCenter[];
  currentUser: User;
  barangays: Barangay[];
  isOnline: boolean;
  onSelectOnMap?: (center: EvacuationCenter) => void;
  /** opened on one shelter (residents), e.g. from Home or a map popup */
  focus?: ItemFocus;
}

export const EvacuationDirectory: React.FC<EvacuationDirectoryProps> = ({
  evacuationCenters,
  currentUser,
  barangays,
  isOnline,
  onSelectOnMap,
  focus,
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'full' | 'closed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBarangay, setSelectedBarangay] = useState<string>('all');
  const [savedOfflineToast, setSavedOfflineToast] = useState<string | null>(null);
  
  // Quick Edit Modal
  const [editingCenter, setEditingCenter] = useState<EvacuationCenter | null>(null);
  // Details: the full record of one shelter (reference build "Details")
  const [detailCenter, setDetailCenter] = useState<EvacuationCenter | null>(null);
  // Edit Location opens the editor with the coordinates focused
  const [focusLocation, setFocusLocation] = useState(false);
  const [editOccupancy, setEditOccupancy] = useState<number>(0);
  const [editStatus, setEditStatus] = useState<EvacuationStatus>('open');
  const [editFacilities, setEditFacilities] = useState<string[]>([]);
  const [editOtherFacilities, setEditOtherFacilities] = useState('');
  const [editContactPerson, setEditContactPerson] = useState('');
  const [editContactPhone, setEditContactPhone] = useState('');
  const [editNeedsPatrol, setEditNeedsPatrol] = useState(false);
  // Edit Location: the pin residents navigate to
  const [editLat, setEditLat] = useState('');
  const [editLng, setEditLng] = useState('');
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const { shelterTrend } = useRepo();
  const staffView = currentUser?.role !== 'citizen';
  useEffect(() => {
    if (staffView) repo.loadShelterTrend().catch(() => {});
  }, [staffView]);

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
    const facilities = center.facilities || [];
    setEditFacilities(facilities.filter((f) => FACILITY_PRESETS.includes(f)));
    setEditOtherFacilities(facilities.filter((f) => !FACILITY_PRESETS.includes(f)).join(', '));
    setEditContactPerson(center.contact_person || '');
    setEditContactPhone(center.contact_phone || '');
    setEditNeedsPatrol(!!center.needs_patrol);
    setEditLat(center.has_location ? String(center.latitude) : '');
    setEditLng(center.has_location ? String(center.longitude) : '');
    setLocationNote(center.has_location ? null : 'No location yet. Residents cannot navigate here until one is set.');
  };

  const useMyLocation = async () => {
    setLocating(true);
    setLocationNote(null);
    try {
      const pos = await locate();
      setEditLat(String(pos.lat));
      setEditLng(String(pos.lng));
      setLocationNote(`Your position, accurate to about ${pos.accuracy} m. Stand at the shelter entrance for the best pin.`);
    } catch (err: any) {
      setLocationNote(err?.message || 'Could not read your location.');
    } finally {
      setLocating(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCenter) return;

    // coordinates are saved only when they changed, and only when they are in Lingayen
    const lat = parseFloat(editLat);
    const lng = parseFloat(editLng);
    const typed = editLat.trim() !== '' || editLng.trim() !== '';
    const moved =
      typed && (!editingCenter.has_location || lat !== editingCenter.latitude || lng !== editingCenter.longitude);
    if (moved) {
      const state = classifyCoords(lat, lng);
      if (state !== 'ok') {
        setLocationNote(coordMessage(state).replace('The stored coordinates are', 'These coordinates are') || 'Check the coordinates.');
        return;
      }
    }

    try {
      const others = editOtherFacilities.split(',').map((f) => f.trim()).filter(Boolean);
      await repo.updateCenter(editingCenter.id, {
        ...(moved ? { latitude: lat, longitude: lng } : {}),
        current_occupancy: Number(editOccupancy),
        status: editStatus,
        facilities: Array.from(new Set([...editFacilities, ...others])),
        contact_person: editContactPerson.trim(),
        contact_phone: editContactPhone.trim(),
        // sent only when changed, so saving a shelter works the same as before otherwise
        ...(editNeedsPatrol !== !!editingCenter.needs_patrol ? { needs_patrol: editNeedsPatrol } : {}),
      });
      flash(`Updated ${editingCenter.name}`);
      repo.loadShelterTrend().catch(() => {});
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
        facilities: c.facilities || [],
        contact_person: c.contact_person || '',
        contact_phone: c.contact_phone || '',
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

  // the Details pop-up, for residents (read-only) and staff (with Edit / Edit Location)
  const detailView = detailCenter
    ? (() => {
        const c = evacuationCenters.find((x) => x.id === detailCenter.id) || detailCenter;
        const pct = c.capacity > 0 ? Math.min(100, Math.round((c.current_occupancy / c.capacity) * 100)) : 0;
        const tone = isResident ? 'resident' : isBarangay ? 'barangay' : 'staff';
        const statusLabel = c.status === 'open' ? 'Open' : c.status === 'full' ? 'Full' : 'Closed';
        const btn = 'inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold cursor-pointer transition-colors';
        const dark = isResident ? 'bg-red-900 hover:bg-red-800 text-white' : isBarangay ? 'bg-[#052659] hover:bg-[#011025] text-white' : 'bg-[#18181b] hover:bg-neutral-800 text-white';
        const soft = isResident ? 'bg-red-50 text-red-900 border border-red-900/20 hover:bg-red-100' : 'bg-white text-neutral-800 border border-neutral-200 hover:bg-neutral-100';
        return (
          <DetailModal
            title={c.name}
            subtitle={c.barangay_name ? `Barangay ${c.barangay_name}` : undefined}
            tone={tone}
            onClose={() => setDetailCenter(null)}
            actions={
              <>
                {c.contact_phone && (
                  <a href={telHref(c.contact_phone)} className={`${btn} ${soft}`}>
                    <Phone className="w-3.5 h-3.5" />
                    {t('Call')}
                  </a>
                )}
                {onSelectOnMap && c.has_location && (
                  <button type="button" onClick={() => { setDetailCenter(null); onSelectOnMap(c); }} className={`${btn} ${soft}`}>
                    <MapPin className="w-3.5 h-3.5" />
                    {t('Show on map')}
                  </button>
                )}
                {!isResident && (
                  <button type="button" onClick={() => { setDetailCenter(null); setFocusLocation(true); handleOpenEdit(c); }} className={`${btn} ${soft}`}>
                    <MapPin className="w-3.5 h-3.5" />
                    {t('Edit Location')}
                  </button>
                )}
                {!isResident && (
                  <button type="button" onClick={() => { setDetailCenter(null); setFocusLocation(false); handleOpenEdit(c); }} className={`${btn} ${soft}`}>
                    <Edit3 className="w-3.5 h-3.5" />
                    {t('Edit')}
                  </button>
                )}
                {c.has_location && canNavigate(c.latitude, c.longitude) && (
                  <a href={wazeUrl(c.latitude, c.longitude)} target="_blank" rel="noopener noreferrer" className={`${btn} ${dark}`}>
                    <Compass className="w-3.5 h-3.5" />
                    {t('Navigate with Waze')}
                  </a>
                )}
              </>
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  c.status === 'open' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : c.status === 'full' ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-neutral-100 text-neutral-500 border border-neutral-200'
                }`}
              >
                {t(statusLabel)}
              </span>
              <span className="text-xs font-mono text-neutral-600">
                {c.current_occupancy} / {c.capacity} {t('slots')} · {pct}%
              </span>
            </div>
            <DetailBar pct={pct} color={pct >= 100 ? '#B91C1C' : pct >= 80 ? '#D97706' : '#15803D'} />
            {(c.facilities || []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {(c.facilities || []).map((f) => (
                  <span key={f} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-neutral-100 text-neutral-700">
                    <Check className="w-3 h-3" />
                    {f}
                  </span>
                ))}
              </div>
            )}
            <div>
              <DetailRow tone={tone} label={t('Barangay')} value={c.barangay_name} />
              <DetailRow tone={tone} label={t('Address')} value={c.address} />
              <DetailRow tone={tone} label={t('Capacity')} value={c.capacity} />
              <DetailRow tone={tone} label={t('Current occupancy')} value={c.current_occupancy} />
              <DetailRow tone={tone} label={t('Slots left')} value={Math.max(0, c.capacity - c.current_occupancy)} />
              <DetailRow tone={tone} label={t('Contact person')} value={c.contact_person} />
              <DetailRow
                tone={tone}
                label={t('Contact phone')}
                value={c.contact_phone ? <a href={telHref(c.contact_phone)} className="underline">{c.contact_phone}</a> : ''}
              />
              <DetailRow tone={tone} label={t('Coordinates')} value={c.has_location ? fmtCoords(c.latitude, c.longitude) : t('Not recorded')} />
              {c.notes && <DetailRow tone={tone} label={t('Notes')} value={c.notes} />}
              {!isResident && <DetailRow tone={tone} label={t('Needs a PNP patrol')} value={c.needs_patrol ? t('Yes') : t('No')} />}
            </div>
            {c.has_location && !canNavigate(c.latitude, c.longitude) && (
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                {coordMessage(classifyCoords(c.latitude, c.longitude))}
              </p>
            )}
          </DetailModal>
        );
      })()
    : null;

  // opened on one shelter: clear whatever filter would hide it, then bring it into view
  useEffect(() => {
    if (!focus) return;
    setResidentFilter('all');
    setResidentSelectedBarangay('all');
    setResidentSearchQuery('');
  }, [focus]);
  useFocusItem(focus ? `shelter-${focus.id}` : null, focus?.key);

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
                {t("Real-time intake capacities, facility amenities, and driving routes across Lingayen")}
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
                <span>{t("All")}</span>
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
                <span>{t("Open")}</span>
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
                <span>{t("Full")}</span>
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
                <span>{t("Closed")}</span>
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
                  placeholder={t("Search shelter name or street...")}
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
                <option value="all">{t("All Barangays")}</option>
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
                <p className="text-sm font-semibold text-neutral-600">{t("No evacuation centers match your search")}</p>
                <p className="text-xs text-neutral-400">{t("Try adjusting your filter or search query")}</p>
                <button
                  onClick={() => {
                    setResidentFilter('all');
                    setResidentSearchQuery('');
                    setResidentSelectedBarangay('all');
                  }}
                  className="mt-2 text-xs font-bold text-red-900 hover:underline cursor-pointer"
                >
                  {t("Clear all filters")}
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
                      id={`shelter-${s.id}`}
                      {...openable(() => rawCenter && setDetailCenter(rawCenter))}
                      aria-label={`${s.name}: ${t('Details')}`}
                      className="p-6 rounded-3xl border border-neutral-100 bg-neutral-50/50 hover:bg-red-50/30 transition-all duration-300 flex flex-col justify-between space-y-5 shadow-xs hover:shadow-lg group cursor-pointer"
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

                        {s.facilities.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {s.facilities.map((f) => (
                              <span key={f} className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-900 border border-red-900/10">
                                {f}
                              </span>
                            ))}
                          </div>
                        )}

                        {s.contact_phone && (
                          <a
                            href={telHref(s.contact_phone)}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-900 hover:underline"
                          >
                            <Phone className="w-3.5 h-3.5" />
                            <span>{s.contact_person ? `${s.contact_person} · ` : ''}{s.contact_phone}</span>
                          </a>
                        )}
                      </div>

                      {/* Card Action Buttons: taps here act on the button, not the card */}
                      <div className="pt-4 border-t border-neutral-200/70 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
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
                          <span>{t("Navigate with Waze")}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => rawCenter && setDetailCenter(rawCenter)}
                          className="px-3.5 h-10 rounded-xl bg-white hover:bg-red-50 text-red-900 border border-red-900/20 text-xs font-bold transition-all shadow-xs cursor-pointer active:scale-95 shrink-0"
                        >
                          {t("Details")}
                        </button>

                        <button
                          onClick={async () => {
                            await repo.saveOffline();
                            setSavedOfflineNotice('Shelter list saved for offline use');
                            setTimeout(() => setSavedOfflineNotice(null), 3000);
                          }}
                          className="w-10 h-10 rounded-xl bg-white hover:bg-red-50 text-red-900 border border-red-900/20 flex items-center justify-center transition-all shadow-xs cursor-pointer active:scale-95 shrink-0"
                          title={t("Download offline coordinates")}
                        >
                          <Download className="w-4 h-4" />
                        </button>

                        {onSelectOnMap && rawCenter?.has_location && (
                          <button
                            onClick={() => onSelectOnMap(rawCenter)}
                            className="w-10 h-10 rounded-xl bg-white hover:bg-red-50 text-red-900 border border-red-900/20 flex items-center justify-center transition-all shadow-xs cursor-pointer active:scale-95 shrink-0"
                            title={t("View shelter on Map")}
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

        {detailView}

        {/* Offline Notification Toast */}
        {savedOfflineNotice && (
          <div className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-4 sm:right-6 max-w-[calc(100vw-2rem)] bg-neutral-900 text-white px-5 py-3 rounded-2xl shadow-2xl text-xs font-bold animate-in slide-in-from-bottom-2 z-50 flex items-center gap-2 border border-white/20">
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
            {t("Evacuation Centers")}
          </h1>
          <p className={`text-xs sm:text-sm mt-0.5 max-w-2xl leading-relaxed ${
            isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'
          }`}>
            {t("Keep capacity and availability accurate so residents arrive at a shelter with space.")}
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
            <span>{t("All")}</span>
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
            placeholder={t("Search by shelter name, barangay, or hash ID...")}
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
            <option value="all">{t("All Barangays")}</option>
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

      {/* Occupancy over time, from shelter_occupancy_log */}
      {shelterTrend.length > 1 && (() => {
        const points = shelterTrend.slice(-14);
        const peak = Math.max(1, ...points.map((p) => Math.max(p.occupancy, p.capacity)));
        const last = points[points.length - 1];
        return (
          <div className={`bg-white rounded-[24px] border overflow-hidden ${isBarangay ? 'border-[#7EA0C5]/30' : 'border-neutral-200/70'}`}>
            <div className={`px-5 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-2 border-b ${
              isBarangay ? 'bg-[#C2E8FF]/10 border-[#7EA0C5]/20' : 'bg-neutral-50/50 border-neutral-100'
            }`}>
              <h2 className={`text-sm font-semibold uppercase tracking-wide flex items-center gap-2 ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
                <TrendingUp className="w-4 h-4" />
                {t("Occupancy Trend")}
              </h2>
              <span className={`text-[11px] font-mono ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
                {last.occupancy} of {last.capacity} places used on the latest day
              </span>
            </div>
            <div className="px-5 sm:px-6 py-4">
              <div className="h-28 flex items-end gap-1.5" role="img" aria-label={t("Daily evacuees against capacity")}>
                {points.map((p) => (
                  <div key={p.day} className="flex-1 h-full flex items-end relative group" title={`${p.day}: ${p.occupancy} of ${p.capacity}`}>
                    <div
                      className={`absolute bottom-0 inset-x-0 rounded-t-md ${isBarangay ? 'bg-[#C2E8FF]/50' : 'bg-neutral-100'}`}
                      style={{ height: `${(p.capacity / peak) * 100}%` }}
                    />
                    <div
                      className={`relative w-full rounded-t-md ${isBarangay ? 'bg-[#052659]' : 'bg-[#18181b]'}`}
                      style={{ height: `${Math.max(2, (p.occupancy / peak) * 100)}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className={`mt-2 flex justify-between text-[10px] font-mono ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'}`}>
                <span>{points[0].day}</span>
                <span>{last.day}</span>
              </div>
              <p className={`mt-2 text-[11px] ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
                Dark bars are evacuees each day; the light bars behind them are the total capacity.
              </p>
            </div>
          </div>
        );
      })()}

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
                      {t("OPEN")}
                    </span>
                  )}
                  {center.status === 'full' && (
                    <span className={`text-[10px] font-medium uppercase px-2.5 py-0.5 rounded-full shadow-2xs shrink-0 ${
                      isBarangay
                        ? 'bg-[#052659] text-white border border-[#011025]/40'
                        : 'bg-[#18181b] text-white'
                    }`}>
                      {t("FULL")}
                    </span>
                  )}
                  {center.status === 'closed' && (
                    <span className={`text-[10px] font-medium uppercase px-2.5 py-0.5 rounded-full shadow-2xs shrink-0 ${
                      isBarangay
                        ? 'bg-[#5482B4] text-white border border-[#5482B4]'
                        : 'bg-[#70757a] text-white'
                    }`}>
                      {t("CLOSED")}
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
                    <span className={`font-medium ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-600'}`}>{t("Occupancy")}</span>
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

                {(center.facilities || []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {(center.facilities || []).map((f) => (
                      <span
                        key={f}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                          isBarangay ? 'bg-[#C2E8FF]/30 text-[#052659] border-[#7EA0C5]/40' : 'bg-neutral-100 text-neutral-700 border-neutral-200'
                        }`}
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                )}

                {(center.contact_person || center.contact_phone) && (
                  <div className={`flex items-center gap-1.5 text-[11px] ${isBarangay ? 'text-[#011025]' : 'text-neutral-700'}`}>
                    <Phone className="w-3 h-3 shrink-0" />
                    <span className="truncate">{center.contact_person || 'Contact'}</span>
                    {center.contact_phone && (
                      <a href={telHref(center.contact_phone)} className="font-mono font-semibold hover:underline shrink-0">
                        {center.contact_phone}
                      </a>
                    )}
                  </div>
                )}
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
                    {t("Open")}
                  </button>

                  <button
                    onClick={() => handleQuickStatusChange(center, 'full')}
                    className={`py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer ${
                      center.status === 'full'
                        ? isBarangay ? 'bg-[#052659] text-white shadow-2xs' : 'bg-[#2A2A2A] text-white shadow-2xs'
                        : isBarangay ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/40' : 'text-neutral-600 hover:text-neutral-900 hover:bg-white/60'
                    }`}
                  >
                    {t("Full")}
                  </button>

                  <button
                    onClick={() => handleQuickStatusChange(center, 'closed')}
                    className={`py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer ${
                      center.status === 'closed'
                        ? isBarangay ? 'bg-[#052659] text-white shadow-2xs' : 'bg-[#2A2A2A] text-white shadow-2xs'
                        : isBarangay ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/40' : 'text-neutral-600 hover:text-neutral-900 hover:bg-white/60'
                    }`}
                  >
                    {t("Closed")}
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
                  <span>{t("Navigate with Waze")}</span>
                </button>

                {/* Secondary Utility Actions: Edit Occupancy & Pin on Map */}
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] pt-1">
                  <button
                    onClick={() => setDetailCenter(center)}
                    className={`flex items-center gap-1 cursor-pointer font-semibold ${
                      isBarangay ? 'text-[#052659] hover:text-[#011025]' : 'text-neutral-800 hover:text-black'
                    }`}
                  >
                    <FileText className="w-3 h-3" />
                    <span>{t("Details")}</span>
                  </button>
                  <button
                    onClick={() => {
                      setFocusLocation(false);
                      handleOpenEdit(center);
                    }}
                    className={`flex items-center gap-1 cursor-pointer font-medium ${
                      isBarangay ? 'text-[#5482B4] hover:text-[#052659]' : 'text-neutral-500 hover:text-neutral-900'
                    }`}
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>{t("Edit Shelter")}</span>
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
        <div className={`fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-4 sm:right-6 max-w-[calc(100vw-2rem)] z-50 px-4 py-3 rounded-full shadow-2xl text-xs font-medium flex items-center gap-2.5 animate-in slide-in-from-bottom-2 ${
          isBarangay
            ? 'bg-[#052659] text-white border border-[#7EA0C5]/40'
            : 'bg-[#18181b] text-white border border-neutral-800'
        }`}>
          <Check className={`w-4 h-4 ${isBarangay ? 'text-[#C2E8FF]' : 'text-neutral-300'}`} />
          <span>{savedOfflineToast}</span>
        </div>
      )}

      {/* Admin Update Evacuation Stats Modal */}
      {detailView}

      {editingCenter && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className={`bg-white rounded-[24px] max-w-md w-full max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 shadow-2xl animate-in zoom-in-95 ${
            isBarangay ? 'border border-[#7EA0C5]/40' : 'border border-neutral-200/80'
          }`}>
            <h3 className={`font-semibold text-base mb-1 ${
              isBarangay ? 'text-[#011025]' : 'text-neutral-900'
            }`}>
              {t("Update Evacuation Shelter")}
            </h3>
            <p className={`text-xs mb-4 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
              {editingCenter.name}
            </p>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className={`block text-xs font-semibold mb-1 ${
                  isBarangay ? 'text-[#052659]' : 'text-neutral-700'
                }`}>{t("Shelter Status")}</label>
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
                  <option value="closed">{t("Closed")}</option>
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

              <div>
                <span className={`block text-xs font-semibold mb-1 ${
                  isBarangay ? 'text-[#052659]' : 'text-neutral-700'
                }`}>{t("Facilities")}</span>
                <div className="flex flex-wrap gap-1.5">
                  {FACILITY_PRESETS.map((f) => {
                    const on = editFacilities.includes(f);
                    return (
                      <button
                        key={f}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setEditFacilities((cur) => (on ? cur.filter((x) => x !== f) : [...cur, f]))}
                        className={`px-3 py-1.5 min-h-[32px] rounded-full text-[11px] font-medium border cursor-pointer transition-colors ${
                          on
                            ? isBarangay ? 'bg-[#052659] text-white border-[#052659]' : 'bg-[#18181b] text-white border-[#18181b]'
                            : isBarangay ? 'bg-white text-[#052659] border-[#7EA0C5]/40' : 'bg-white text-neutral-700 border-neutral-200'
                        }`}
                      >
                        {f}
                      </button>
                    );
                  })}
                </div>
                <input
                  type="text"
                  value={editOtherFacilities}
                  onChange={(e) => setEditOtherFacilities(e.target.value)}
                  placeholder={t("Other facilities, separated by commas")}
                  className={`mt-2 w-full text-xs p-2.5 rounded-xl outline-hidden transition-all ${
                    isBarangay
                      ? 'bg-[#C2E8FF]/10 text-[#011025] border border-[#7EA0C5]/40 focus:bg-white focus:border-[#052659]'
                      : 'bg-neutral-50/70 border border-neutral-200 focus:bg-white focus:border-neutral-400'
                  }`}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={`block text-xs font-semibold mb-1 ${
                  isBarangay ? 'text-[#052659]' : 'text-neutral-700'
                }`}>{t("Contact person")}</label>
                  <input type="text" value={editContactPerson} onChange={(e) => setEditContactPerson(e.target.value)} placeholder={t("Camp manager")} className={`w-full text-xs p-2.5 rounded-xl outline-hidden transition-all ${
                    isBarangay
                      ? 'bg-[#C2E8FF]/10 text-[#011025] border border-[#7EA0C5]/40 focus:bg-white focus:border-[#052659]'
                      : 'bg-neutral-50/70 border border-neutral-200 focus:bg-white focus:border-neutral-400'
                  }`} />
                </div>
                <div>
                  <label className={`block text-xs font-semibold mb-1 ${
                  isBarangay ? 'text-[#052659]' : 'text-neutral-700'
                }`}>{t("Contact number")}</label>
                  <input type="tel" inputMode="tel" value={editContactPhone} onChange={(e) => setEditContactPhone(e.target.value)} placeholder="0917 000 0000" className={`w-full text-xs p-2.5 rounded-xl outline-hidden transition-all ${
                    isBarangay
                      ? 'bg-[#C2E8FF]/10 text-[#011025] border border-[#7EA0C5]/40 focus:bg-white focus:border-[#052659]'
                      : 'bg-neutral-50/70 border border-neutral-200 focus:bg-white focus:border-neutral-400'
                  }`} />
                </div>
              </div>

              {/* Edit Location: the pin on the map and the Waze destination */}
              <div className={`p-3 rounded-xl space-y-2.5 ${isBarangay ? 'bg-[#C2E8FF]/10 border border-[#7EA0C5]/40' : 'bg-neutral-50/70 border border-neutral-200'}`}>
                <span className={`block text-xs font-semibold ${isBarangay ? 'text-[#052659]' : 'text-neutral-700'}`}>{t("Location")}</span>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    autoFocus={focusLocation}
                    value={editLat}
                    onChange={(e) => setEditLat(e.target.value)}
                    inputMode="decimal"
                    placeholder="16.0206"
                    aria-label={t("Latitude")}
                    className={`w-full text-xs font-mono rounded-xl p-2.5 outline-hidden bg-white border ${isBarangay ? 'border-[#7EA0C5]/40 focus:border-[#052659]' : 'border-neutral-200 focus:border-neutral-400'}`}
                  />
                  <input
                    value={editLng}
                    onChange={(e) => setEditLng(e.target.value)}
                    inputMode="decimal"
                    placeholder="120.2306"
                    aria-label={t("Longitude")}
                    className={`w-full text-xs font-mono rounded-xl p-2.5 outline-hidden bg-white border ${isBarangay ? 'border-[#7EA0C5]/40 focus:border-[#052659]' : 'border-neutral-200 focus:border-neutral-400'}`}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={useMyLocation}
                    disabled={locating}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[11px] font-semibold cursor-pointer disabled:opacity-50 ${
                      isBarangay ? 'bg-[#C2E8FF]/40 text-[#052659] hover:bg-[#C2E8FF]/70' : 'bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                    }`}
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    {locating ? t("Locating…") : t("Use my location")}
                  </button>
                  {canNavigate(parseFloat(editLat), parseFloat(editLng)) && (
                    <a
                      href={wazeUrl(parseFloat(editLat), parseFloat(editLng))}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`text-[11px] font-semibold underline ${isBarangay ? 'text-[#052659]' : 'text-neutral-700'}`}
                    >
                      {t("Check in Waze")}
                    </a>
                  )}
                </div>
                {locationNote && <p className={`text-[11px] ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>{locationNote}</p>}
              </div>

              {/* the PNP console lists the shelters flagged here */}
              <label className={`flex items-start gap-2.5 p-3 rounded-xl cursor-pointer ${
                isBarangay ? 'bg-[#C2E8FF]/10 border border-[#7EA0C5]/40' : 'bg-neutral-50/70 border border-neutral-200'
              }`}>
                <input
                  type="checkbox"
                  checked={editNeedsPatrol}
                  onChange={(e) => setEditNeedsPatrol(e.target.checked)}
                  className={`mt-0.5 w-4 h-4 shrink-0 ${isBarangay ? 'accent-[#052659]' : 'accent-neutral-900'}`}
                />
                <span>
                  <span className={`block text-xs font-semibold ${isBarangay ? 'text-[#052659]' : 'text-neutral-700'}`}>{t("Needs a PNP patrol")}</span>
                  <span className={`block text-[11px] mt-0.5 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>{t("The PNP sees this shelter on its console until you clear it.")}</span>
                </span>
              </label>

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
                  {t("Cancel")}
                </button>
                <button
                  type="submit"
                  className={`px-5 py-2 text-xs font-medium text-white rounded-full shadow-xs cursor-pointer transition-colors ${
                    isBarangay ? 'bg-[#052659] hover:bg-[#031c42] border border-[#011025]/20' : 'bg-[#18181b] hover:bg-neutral-800'
                  }`}
                >
                  {t("Save Updates")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
