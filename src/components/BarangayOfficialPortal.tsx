import React, { useState, useMemo, useEffect, useRef } from 'react';
import L from 'leaflet';
import {
  AlertTriangle,
  Users,
  ShieldAlert,
  Radio,
  Layers,
  MapPin,
  Clock,
  Shield,
  ExternalLink,
  Flame,
  Droplet,
  Zap,
  Wind,
  Truck,
  Plus,
  Minus,
  X,
  Send,
  AlertCircle,
  Megaphone,
  BellRing,
  Package,
  Construction,
  BookOpen,
  HelpCircle,
  ChevronRight
} from 'lucide-react';
import { Barangay, IncidentReport, EvacuationCenter, Advisory, User } from '../types';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import { BrandLoader, portalForRole } from '../brand';
import { CENTER } from '../lib/geo';

export interface BarangayOfficialPortalProps {
  reports: IncidentReport[];
  barangays: Barangay[];
  evacuationCenters: EvacuationCenter[];
  advisories: Advisory[];
  currentUser: User;
  onSelectReport?: (report: IncidentReport) => void;
  onOpenReportModal?: () => void;
  onNavigateTab?: (tab: string) => void;
  onNavigateView?: (view: 'Overview' | 'Trends' | 'Analytics') => void;
  onDataChanged?: () => void;
}

// Format relative time (e.g., "10h 51m ago", "15m ago")
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

export const BarangayOfficialPortal: React.FC<BarangayOfficialPortalProps> = ({
  reports,
  barangays,
  evacuationCenters,
  advisories,
  currentUser,
  onSelectReport,
  onOpenReportModal,
  onNavigateTab,
  onNavigateView,
  onDataChanged,
}) => {
  // 1. Identify and scope strictly to the Official's Barangay Jurisdiction
  const store = useRepo();
  const userBarangayId = currentUser.barangay_id || '';
  const barangayName = currentUser.barangay_name || barangays.find((b) => b.id === userBarangayId)?.name || '';

  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const isRealtimeActive = store.source === 'supabase' && store.online;
  const [showLayersDropdown, setShowLayersDropdown] = useState(false);
  const [isDeclareEmergencyModalOpen, setIsDeclareEmergencyModalOpen] = useState(false);

  // Form State for Declare Emergency Modal (Scoped to Barangay)
  const [emergencyTitle, setEmergencyTitle] = useState('');
  const [emergencyScope, setEmergencyScope] = useState(`Barangay ${barangayName}`);
  const [emergencyMessage, setEmergencyMessage] = useState('');
  const [emergencySeverity, setEmergencySeverity] = useState<'critical' | 'high'>('critical');
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastSuccessNotice, setBroadcastSuccessNotice] = useState<string | null>(null);

  // Layer Visibility
  const [layers, setLayers] = useState({
    hazards: true,
    perimeters: true,
    units: true,
    shelters: true,
  });

  // Leaflet Real Map References
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerGroupRef = useRef<L.LayerGroup | null>(null);

  // ==============================================================
  // DATA SCOPING (Critical Logic Rule): Strictly Local Barangay Data
  // ==============================================================

  // Scoped Incident Reports for this Barangay
  const scopedReports = useMemo(() => {
    return reports.filter((r) => r.barangay_id === userBarangayId);
  }, [reports, userBarangayId]);

  // Scoped Evacuation Centers (Located in this Barangay)
  const scopedShelters = useMemo(() => {
    return evacuationCenters.filter((c) => c.barangay_id === userBarangayId);
  }, [evacuationCenters, userBarangayId]);

  // The map centres on the barangay's own shelters or incidents, else on the municipality
  const mapCenter = useMemo<[number, number]>(() => {
    const shelter = scopedShelters.find((c) => c.has_location);
    if (shelter) return [shelter.latitude, shelter.longitude];
    const report = scopedReports.find((r) => r.has_location);
    if (report) return [report.latitude, report.longitude];
    return CENTER;
  }, [scopedShelters, scopedReports]);
  const currentBarangay = { latitude: mapCenter[0], longitude: mapCenter[1] };

  // Scoped Advisories (Municipality-wide bulletins + alerts specifically directed to this Barangay)
  const scopedAdvisories = useMemo(() => {
    return advisories.filter(
      (a) => !a.target_barangay_id || a.target_barangay_id === userBarangayId
    );
  }, [advisories, userBarangayId]);

  // Metrics Calculations (Strictly Scoped to Barangay)
  const isOpen = (r: IncidentReport) => r.status !== 'resolved' && r.status !== 'rejected';
  const activeIncidents = useMemo(() => {
    return scopedReports.filter(isOpen);
  }, [scopedReports]);

  const unitsDeployed = useMemo(() => {
    return scopedReports.filter(isOpen).reduce((n, r) => n + r.assigned_units, 0);
  }, [scopedReports]);

  const criticalAreas = useMemo(() => {
    return scopedReports.filter((r) => isOpen(r) && r.severity === 'emergency').length;
  }, [scopedReports]);

  // Sort newest first
  const sortedReports = useMemo(() => {
    return [...scopedReports].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [scopedReports]);

  // Selected incident object
  const activeSelectedIncident = useMemo(() => {
    return scopedReports.find((r) => r.id === selectedIncidentId) || null;
  }, [scopedReports, selectedIncidentId]);

  // Operational Module Counts (Scoped to Barangay)
  const reliefActiveCount = store.relief.filter((r) => r.active && r.barangay === barangayName).length;
  const roadWorkActiveCount = store.roadWork.filter(
    (r) => r.status === 'active' && (r.citywide || r.barangay === barangayName)
  ).length;
  const guidesPublishedCount = store.guides.length;
  const faqsPublishedCount = store.faqs.length;

  // Readiness Metrics
  const openSheltersCount = useMemo(() => {
    return scopedShelters.filter((c) => c.status === 'open').length;
  }, [scopedShelters]);

  const shelterCapacityRate = useMemo(() => {
    const total = scopedShelters.reduce((acc, c) => acc + c.capacity, 0);
    const occupied = scopedShelters.reduce((acc, c) => acc + c.current_occupancy, 0);
    return total > 0 ? Math.round((occupied / total) * 100) : 0;
  }, [scopedShelters]);

  // Share of reports that reached the three confirmations needed to auto-verify
  const corroborationRate = useMemo(() => {
    if (scopedReports.length === 0) return 0;
    return Math.round((scopedReports.filter((r) => r.corroboration_count >= 3).length / scopedReports.length) * 100);
  }, [scopedReports]);

  // Hazard Type count distribution for "Incidents by Hazard Type"
  const hazardDistribution = useMemo(() => {
    const map: Record<string, number> = {};
    scopedReports.forEach((r) => {
      const type = r.hazard_type.toUpperCase();
      map[type] = (map[type] || 0) + 1;
    });

    const total = scopedReports.length || 1;
    return Object.entries(map)
      .map(([type, count]) => ({
        type,
        count,
        percentage: Math.round((count / total) * 100),
      }))
      .sort((a, b) => b.count - a.count);
  }, [scopedReports]);

  // ==============================================================
  // Leaflet Real Map: Initialized & Centered on the Barangay
  // ==============================================================
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [currentBarangay.latitude, currentBarangay.longitude],
        zoom: 15,
        zoomControl: false,
        attributionControl: true,
      });

      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
        {
          attribution:
            'Leaflet | Tiles &copy; Esri &mdash; Source: Esri, HERE, Garmin, FAO, NOAA, USGS, &copy; OpenStreetMap contributors, and the GIS User Community',
          maxZoom: 18,
          minZoom: 11,
        }
      ).addTo(map);

      const markersGroup = L.layerGroup().addTo(map);
      markersLayerGroupRef.current = markersGroup;
      mapInstanceRef.current = map;

      const timer = setTimeout(() => {
        map.invalidateSize();
      }, 300);

      return () => {
        clearTimeout(timer);
      };
    } else {
      mapInstanceRef.current.setView([currentBarangay.latitude, currentBarangay.longitude], 15);
    }
  }, [mapCenter]);

  // Zoom controls for the map
  const handleZoomIn = () => {
    if (mapInstanceRef.current) mapInstanceRef.current.zoomIn();
  };

  const handleZoomOut = () => {
    if (mapInstanceRef.current) mapInstanceRef.current.zoomOut();
  };

  // Update Markers, Local Perimeters, Shelters, and Overlays on the Leaflet Map
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersGroup = markersLayerGroupRef.current;
    if (!map || !markersGroup) return;

    markersGroup.clearLayers();

    const badge = (text: string, bg: string) =>
      `<div style="background-color: ${bg}; color: #ffffff; font-size: 10px; font-weight: 800; font-family: ui-sans-serif, system-ui, sans-serif; padding: 2.5px 7px; border-radius: 6px; border: 1.5px solid #C2E8FF; box-shadow: 0 2px 6px rgba(1,16,37,0.35); text-align: center; letter-spacing: 0.5px; cursor: pointer; white-space: nowrap;">${text}</div>`;
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

    // 1. Road Status overlay for this Barangay (one waypoint per road with coordinates)
    if (layers.perimeters) {
      store.roadStatus
        .filter((road) => road.barangay === barangayName)
        .forEach((road) => {
          if (road.lat === null || road.lng === null) return;
          const color = road.status === 'blocked' ? '#dc2626' : road.status === 'caution' ? '#f59e0b' : '#00BCD4';
          const donutIcon = L.divIcon({
            className: 'bg-transparent',
            html: `<div style="width: 22px; height: 22px; border-radius: 9999px; border: 5px solid ${color}; background: #ffffff; box-shadow: 0 2px 8px rgba(0,188,212,0.6);"></div>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          });
          const m = L.marker([road.lat, road.lng], { icon: donutIcon }).addTo(markersGroup);
          m.bindTooltip(
            `<div style="font-weight: bold; font-size: 11px; color: #011025;">${esc(road.road_name)} · ${road.status}</div><div style="font-size: 10px; color: #5482B4;">${esc(road.note)}</div>`,
            { direction: 'top', offset: [0, -12] }
          );
        });
    }

    // 2. Local Evacuation Centers & Barangay Relief Distributions
    if (layers.shelters) {
      scopedShelters.forEach((evac) => {
        if (!evac.has_location) return;
        const bg = evac.status === 'open' ? '#16a34a' : '#052659';
        const evacIcon = L.divIcon({
          className: 'bg-transparent',
          html: badge('EVAC', bg),
          iconSize: [44, 22],
          iconAnchor: [22, 11],
        });

        const m = L.marker([evac.latitude, evac.longitude], { icon: evacIcon }).addTo(markersGroup);
        m.bindTooltip(
          `<div style="font-weight: bold; font-size: 11px; color: #011025;">${esc(evac.name)}</div><div style="font-size: 10px; color: #5482B4;">Capacity: ${evac.current_occupancy}/${evac.capacity} evacuees</div>`,
          { direction: 'top', offset: [0, -12] }
        );
      });

      // Navy REL (Relief) badges for this Barangay's active distributions
      store.relief
        .filter((r) => r.active && r.barangay === barangayName && r.lat !== null && r.lng !== null)
        .forEach((r) => {
          const relIcon = L.divIcon({
            className: 'bg-transparent',
            html: badge('REL', '#052659'),
            iconSize: [40, 22],
            iconAnchor: [20, 11],
          });
          const relMarker = L.marker([r.lat as number, r.lng as number], { icon: relIcon }).addTo(markersGroup);
          relMarker.bindPopup(`
            <div style="font-family: ui-sans-serif, system-ui, sans-serif; padding: 4px 2px; min-width: 140px;">
              <div style="font-weight: 800; font-size: 11px; color: #011025;">${esc(r.title)}</div>
              <div style="font-size: 10px; color: #5482B4; margin-top: 1px;">${esc(r.location_name || r.barangay)}</div>
            </div>
          `, { offset: [0, -12] });
        });
    }

    // 3. Active Incident Hazard Pins (Scoped to this Barangay)
    if (layers.hazards) {
      sortedReports
        .filter((r) => isOpen(r) && r.has_location)
        .forEach((rep) => {
          const isSelected = selectedIncidentId === rep.id;
          const isEmergency = rep.severity === 'emergency';

          const hazardHtml = `
            <div style="position: relative; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
              ${(isEmergency && isRealtimeActive) ? '<span style="position: absolute; width: 28px; height: 28px; border-radius: 9999px; background: rgba(220, 38, 38, 0.45); animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></span>' : ''}
              <span style="position: relative; width: ${isSelected ? '18px' : '13px'}; height: ${isSelected ? '18px' : '13px'}; border-radius: 9999px; background: #dc2626; border: 2.5px solid #ffffff; box-shadow: 0 2px 6px rgba(1,16,37,0.35);"></span>
            </div>
          `;

          const hazardIcon = L.divIcon({
            className: 'bg-transparent',
            html: hazardHtml,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          });

          const marker = L.marker([rep.latitude, rep.longitude], { icon: hazardIcon }).addTo(markersGroup);
          marker.on('click', () => {
            setSelectedIncidentId(rep.id);
          });
        });
    }

    // 4. Deployed Units (responder units assigned to this Barangay's incidents)
    if (layers.units) {
      scopedReports
        .filter((r) => isOpen(r) && r.has_location && r.assigned_units > 0)
        .forEach((rep) => {
          const label = `${rep.assigned_units} unit${rep.assigned_units > 1 ? 's' : ''}`;
          const unitIcon = L.divIcon({
            className: 'bg-transparent',
            html: `<div style="background-color: #052659; color: #ffffff; font-size: 9px; font-weight: 800; font-family: ui-sans-serif, system-ui, sans-serif; padding: 2px 6px; border-radius: 6px; border: 1.5px solid #C2E8FF; box-shadow: 0 2px 6px rgba(1,16,37,0.35); text-align: center; cursor: pointer; white-space: nowrap;">BDRRMC: ${label}</div>`,
            iconSize: [96, 20],
            iconAnchor: [48, 10],
          });
          const m = L.marker([rep.latitude + 0.0012, rep.longitude - 0.0014], { icon: unitIcon }).addTo(markersGroup);
          m.bindTooltip(`Assigned: ${label}`, { direction: 'top' });
        });
    }
  }, [
    scopedReports,
    scopedShelters,
    layers,
    selectedIncidentId,
    isRealtimeActive,
    sortedReports,
    barangayName,
    store.roadStatus,
    store.relief,
  ]);

  // Handle Emergency Declaration broadcast (Scoped to Barangay jurisdiction):
  // an official publishes an emergency advisory targeted at their own barangay
  const handleDeclareEmergencySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emergencyTitle.trim() || !emergencyMessage.trim() || isBroadcasting) return;

    setIsBroadcasting(true);
    try {
      await repo.createAdvisory({
        title: emergencyTitle.trim(),
        content: emergencyMessage.trim(),
        type: 'emergency_alert',
        severity: emergencySeverity,
        target_barangay_id: userBarangayId || null,
      });
      setBroadcastSuccessNotice(`Emergency Directive successfully broadcasted for Barangay ${barangayName}!`);
      if (onDataChanged) onDataChanged();
      setTimeout(() => {
        setBroadcastSuccessNotice(null);
        setIsDeclareEmergencyModalOpen(false);
      }, 1500);
    } catch (err: any) {
      setBroadcastSuccessNotice(err.message || 'Could not broadcast the directive.');
      setTimeout(() => setBroadcastSuccessNotice(null), 4000);
    } finally {
      setIsBroadcasting(false);
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-300">
      {/* 1. Header Section: Barangay Command Console + Barangay Analytics + Declare Emergency */}
      <div className="px-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-semibold text-[#011025] tracking-tight">
              Barangay Command Console
            </h1>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-medium bg-[#C2E8FF]/60 text-[#052659] border border-[#7EA0C5]/40">
              BRGY. {barangayName.toUpperCase()} COMMAND POST
            </span>
          </div>
          <p className="text-xs sm:text-sm text-[#5482B4] font-normal mt-0.5">
            Real-time monitoring and incident command overview for Barangay {barangayName}, Lingayen, Pangasinan.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto flex-wrap">
          {/* Barangay Analytics Shortcut Button */}
          {(onNavigateTab || onNavigateView) && (
            <button
              onClick={() => {
                if (onNavigateTab) {
                  onNavigateTab('analytics');
                } else if (onNavigateView) {
                  onNavigateView('Analytics');
                }
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium text-[#052659] bg-white hover:bg-[#C2E8FF]/30 border border-[#7EA0C5]/40 transition-all shadow-2xs cursor-pointer active:scale-95"
            >
              <Layers className="w-3.5 h-3.5 text-[#5482B4]" />
              <span>Barangay Analytics</span>
            </button>
          )}

          {/* Declare Emergency Action Button */}
          <button
            onClick={() => setIsDeclareEmergencyModalOpen(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-medium text-white bg-[#052659] hover:bg-[#5482B4] transition-all shadow-xs cursor-pointer active:scale-95 border border-[#011025]"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-white fill-white/10" />
            <span>Declare Emergency</span>
          </button>
        </div>
      </div>

      {/* 2. Top Metric Cards (4 KPI Cards strictly scoped to Barangay) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5 w-full">
        {/* Card 1: ACTIVE INCIDENTS */}
        <div className="bg-[#052659] text-white rounded-[22px] p-5 shadow-sm min-w-0 w-full flex flex-col justify-between relative group border border-[#011025]/30">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium tracking-normal text-[#C2E8FF] uppercase">
                ACTIVE INCIDENTS
              </p>
              <p className="text-2xl sm:text-3xl font-bold text-white mt-1.5 tracking-tight font-sans tabular-nums">
                {activeIncidents.length}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-white" />
              </div>
              <span className="w-6 h-6 rounded-full border border-white/20 text-[#C2E8FF] flex items-center justify-center text-[11px]">
                ↗
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-white/15 flex items-center gap-2 text-xs text-[#C2E8FF] font-normal">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7EA0C5]" />
            <span>Live in Barangay {barangayName}</span>
          </div>
        </div>

        {/* Card 2: UNITS DEPLOYED */}
        <div className="bg-[#052659] text-white rounded-[22px] p-5 shadow-sm min-w-0 w-full flex flex-col justify-between relative group border border-[#011025]/30">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium tracking-normal text-[#C2E8FF] uppercase">
                UNITS DEPLOYED
              </p>
              <p className="text-2xl sm:text-3xl font-bold text-white mt-1.5 tracking-tight font-sans tabular-nums">
                {unitsDeployed}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center">
                <Users className="w-4 h-4 text-white" />
              </div>
              <span className="w-6 h-6 rounded-full border border-white/20 text-[#C2E8FF] flex items-center justify-center text-[11px]">
                ↗
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-white/15 flex items-center gap-2 text-xs text-[#C2E8FF] font-normal">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7EA0C5]" />
            <span>Barangay responders assigned</span>
          </div>
        </div>

        {/* Card 3: CRITICAL AREAS */}
        <div className="bg-[#052659] text-white rounded-[22px] p-5 shadow-sm min-w-0 w-full flex flex-col justify-between relative group border border-[#011025]/30">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium tracking-normal text-[#C2E8FF] uppercase">
                CRITICAL AREAS
              </p>
              <p className="text-2xl sm:text-3xl font-bold text-white mt-1.5 tracking-tight font-sans tabular-nums">
                {criticalAreas}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center">
                <ShieldAlert className="w-4 h-4 text-white" />
              </div>
              <span className="w-6 h-6 rounded-full border border-white/20 text-[#C2E8FF] flex items-center justify-center text-[11px]">
                ↗
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-white/15 flex items-center gap-2 text-xs text-[#C2E8FF] font-normal">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7EA0C5]" />
            <span>Emergency severity in {barangayName}</span>
          </div>
        </div>

        {/* Card 4: SYSTEM STATUS */}
        <div className="bg-[#052659] text-white rounded-[22px] p-5 shadow-sm min-w-0 w-full flex flex-col justify-between relative group border border-[#011025]/30">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium tracking-normal text-[#C2E8FF] uppercase">
                SYSTEM STATUS
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-2xl sm:text-3xl font-bold text-white tracking-tight font-sans">
                  {isRealtimeActive ? 'LIVE' : 'STABLE'}
                </span>
                <span className="inline-flex h-2 w-2 rounded-full bg-[#C2E8FF]" />
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center">
                <Radio className="w-4 h-4 text-white" />
              </div>
              <span className="w-6 h-6 rounded-full border border-white/20 text-[#C2E8FF] flex items-center justify-center text-[11px]">
                ↗
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-white/15 flex items-center gap-2 text-xs text-[#C2E8FF] font-normal">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7EA0C5]" />
            <span>{isRealtimeActive ? 'BDRRMC relay connected' : 'Serving cached data'}</span>
          </div>
        </div>
      </div>
      {/* 3. Middle Section: Live Operations Map (Left) + Recent Incidents (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start w-full">
        {/* Left Column: Live Operations Map (8 cols) */}
        <div className="lg:col-span-8 bg-white rounded-[26px] border border-[#7EA0C5]/30 shadow-[0_2px_12px_rgba(1,16,37,0.03)] overflow-hidden flex flex-col min-w-0 w-full">
          {/* Map Header with Realtime and Layers Controls */}
          <div className="px-6 py-5 border-b border-[#7EA0C5]/20 flex flex-wrap items-center justify-between gap-3 bg-white">
            <div>
              <h2 className="text-base font-semibold text-[#011025] flex items-center gap-2">
                <MapPin className="w-4 h-4 text-[#052659]" />
                <span>Live Operations Map</span>
              </h2>
              <p className="text-xs text-[#5482B4] font-normal mt-0.5">
                Active incident perimeters and deployed units in Barangay {barangayName}
              </p>
            </div>

            {/* Controls: Realtime button + Layers toggle */}
            <div className="flex items-center gap-2 relative">
              <button
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all border cursor-pointer ${
                  isRealtimeActive
                    ? 'bg-[#052659] text-white border-[#011025] shadow-2xs'
                    : 'bg-white text-[#5482B4] border-[#7EA0C5]/40 hover:bg-[#C2E8FF]/20'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isRealtimeActive ? 'bg-white animate-pulse' : 'bg-[#7EA0C5]'
                  }`}
                />
                <span>Realtime</span>
              </button>

              <div className="relative">
                <button
                  onClick={() => setShowLayersDropdown((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium text-[#052659] bg-white hover:bg-[#C2E8FF]/20 border border-[#7EA0C5]/40 transition-colors cursor-pointer shadow-2xs"
                >
                  <Layers className="w-3.5 h-3.5 text-[#5482B4]" />
                  <span>Layers</span>
                </button>

                {/* Layer Menu Dropdown */}
                {showLayersDropdown && (
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-[#7EA0C5]/30 p-2 z-30 animate-in fade-in slide-in-from-top-2">
                    <p className="text-[10px] font-bold text-[#5482B4] uppercase px-2 py-1">
                      Map Layers
                    </p>
                    <label className="flex items-center gap-2.5 px-2 py-1.5 hover:bg-[#C2E8FF]/30 rounded-xl cursor-pointer text-xs font-medium text-[#011025]">
                      <input
                        type="checkbox"
                        checked={layers.hazards}
                        onChange={(e) =>
                          setLayers((prev) => ({ ...prev, hazards: e.target.checked }))
                        }
                        className="rounded text-[#052659] focus:ring-[#052659] w-3.5 h-3.5"
                      />
                      <span>Active Incidents</span>
                    </label>

                    <label className="flex items-center gap-2.5 px-2 py-1.5 hover:bg-[#C2E8FF]/30 rounded-xl cursor-pointer text-xs font-medium text-[#011025]">
                      <input
                        type="checkbox"
                        checked={layers.perimeters}
                        onChange={(e) =>
                          setLayers((prev) => ({ ...prev, perimeters: e.target.checked }))
                        }
                        className="rounded text-[#052659] focus:ring-[#052659] w-3.5 h-3.5"
                      />
                      <span>Road Status</span>
                    </label>

                    <label className="flex items-center gap-2.5 px-2 py-1.5 hover:bg-[#C2E8FF]/30 rounded-xl cursor-pointer text-xs font-medium text-[#011025]">
                      <input
                        type="checkbox"
                        checked={layers.units}
                        onChange={(e) =>
                          setLayers((prev) => ({ ...prev, units: e.target.checked }))
                        }
                        className="rounded text-[#052659] focus:ring-[#052659] w-3.5 h-3.5"
                      />
                      <span>Deployed Units</span>
                    </label>

                    <label className="flex items-center gap-2.5 px-2 py-1.5 hover:bg-[#C2E8FF]/30 rounded-xl cursor-pointer text-xs font-medium text-[#011025]">
                      <input
                        type="checkbox"
                        checked={layers.shelters}
                        onChange={(e) =>
                          setLayers((prev) => ({ ...prev, shelters: e.target.checked }))
                        }
                        className="rounded text-[#052659] focus:ring-[#052659] w-3.5 h-3.5"
                      />
                      <span>Evacuation Centers</span>
                    </label>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Interactive Map Canvas (Real Esri World Street Map Tiles & Overlays) */}
          <div className="relative isolate z-0 w-full h-[460px] sm:h-[520px] bg-[#f2efe9] overflow-hidden select-none">
            <div ref={mapContainerRef} className="w-full h-full" style={{ zIndex: 1 }} />

            {/* On-Map Floating Zoom Controls */}
            <div className="absolute top-4 right-4 z-10 pointer-events-auto">
              {/* Map Zoom Controls */}
              <div className="flex flex-col shadow-md rounded-2xl overflow-hidden border border-[#7EA0C5]/40 bg-white">
                <button
                  onClick={handleZoomIn}
                  className="w-8 h-8 flex items-center justify-center text-[#052659] hover:text-[#011025] hover:bg-[#C2E8FF]/20 border-b border-[#7EA0C5]/30 transition-colors cursor-pointer"
                  title="Zoom in"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  onClick={handleZoomOut}
                  className="w-8 h-8 flex items-center justify-center text-[#052659] hover:text-[#011025] hover:bg-[#C2E8FF]/20 transition-colors cursor-pointer"
                  title="Zoom out"
                >
                  <Minus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Map Floating Incident Inspector Popup (When an incident is selected) */}
            {activeSelectedIncident && (
              <div className="absolute bottom-4 left-4 right-4 sm:right-auto sm:w-96 bg-white rounded-[24px] border border-[#7EA0C5]/40 shadow-xl p-5 z-20 animate-in fade-in slide-in-from-bottom-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-sans text-xs font-semibold text-[#052659] bg-[#C2E8FF]/60 px-2 py-0.5 rounded-full border border-[#7EA0C5]/40">
                      {activeSelectedIncident.code}
                    </span>
                    <span className="text-xs font-semibold text-[#011025] uppercase">
                      {activeSelectedIncident.hazard_type}
                    </span>
                  </div>

                  <button
                    onClick={() => setSelectedIncidentId(null)}
                    className="text-[#7EA0C5] hover:text-[#011025] p-1 rounded-full hover:bg-[#C2E8FF]/30 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <p className="text-xs text-[#011025] mt-2 line-clamp-2">
                  {activeSelectedIncident.description}
                </p>

                <div className="mt-3 pt-2.5 border-t border-[#7EA0C5]/20 grid grid-cols-2 gap-2 text-[11px] text-[#5482B4]">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[#5482B4] shrink-0" />
                    <span className="truncate">Barangay {barangayName}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-[#5482B4] shrink-0" />
                    <span>{activeSelectedIncident.corroboration_count} corroborations</span>
                  </div>
                </div>

                {activeSelectedIncident.assigned_units > 0 && (
                  <div className="mt-2 bg-[#C2E8FF]/30 p-2 rounded-xl border border-[#7EA0C5]/30 flex items-center gap-2 text-xs text-[#011025] font-medium">
                    <Truck className="w-4 h-4 text-[#052659] shrink-0" />
                    <span className="truncate">Units: {activeSelectedIncident.assigned_units} deployed</span>
                  </div>
                )}

                <div className="mt-3 flex items-center gap-2">
                  {onNavigateTab && (
                    <button
                      onClick={() => onNavigateTab('incidents')}
                      className="flex-1 py-2 px-3 bg-[#052659] hover:bg-[#5482B4] text-white text-xs font-medium rounded-full transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Command Triage</span>
                    </button>
                  )}
                  {onSelectReport && (
                    <button
                      onClick={() => onSelectReport(activeSelectedIncident)}
                      className="py-2 px-4 bg-[#C2E8FF]/50 hover:bg-[#C2E8FF] text-[#052659] text-xs font-medium rounded-full border border-[#7EA0C5]/40 transition-colors cursor-pointer"
                    >
                      View
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Recent Incidents Panel (Scoped to Barangay) */}
        <div className="lg:col-span-4 bg-white text-[#011025] rounded-[26px] border border-[#7EA0C5]/30 shadow-[0_2px_12px_rgba(1,16,37,0.03)] overflow-hidden flex flex-col min-w-0 w-full h-auto min-h-[400px] sm:min-h-[460px] lg:h-[585px]">
          {/* Panel Header */}
          <div className="px-6 py-5 border-b border-[#7EA0C5]/20 flex items-center justify-between bg-white">
            <div>
              <h2 className="text-base font-semibold text-[#011025]">
                Recent Incidents
              </h2>
              <p className="text-xs text-[#5482B4] font-normal mt-0.5">
                Newest first, Barangay {barangayName}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold text-[#011025] font-sans tracking-tight">
                {sortedReports.length}
              </span>
              {onNavigateTab && (
                <button
                  onClick={() => onNavigateTab('incidents')}
                  className="text-xs font-medium text-[#052659] hover:text-white bg-[#C2E8FF]/50 hover:bg-[#052659] px-3.5 py-1.5 rounded-full border border-[#7EA0C5]/30 transition-colors cursor-pointer"
                >
                  View All
                </button>
              )}
            </div>
          </div>

          {/* Incident List */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#7EA0C5]/15 p-3.5 space-y-2">
            {sortedReports.map((report, index) => {
              const isSelected = selectedIncidentId === report.id;
              const isEmergency =
                report.hazard_type === 'Emergency SOS' ||
                report.hazard_type === 'Flood' ||
                report.hazard_type === 'Storm Surge';

              return (
                <div
                  key={report.id}
                  onClick={() => {
                    setSelectedIncidentId(isSelected ? null : report.id);
                    if (onSelectReport) onSelectReport(report);
                  }}
                  className={`group p-3 rounded-2xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#C2E8FF]/40 border-[#5482B4] text-[#011025] shadow-2xs'
                      : 'bg-white hover:bg-[#C2E8FF]/20 border-[#7EA0C5]/20 hover:border-[#7EA0C5]/50 text-[#011025]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-6 h-6 rounded-full bg-[#C2E8FF]/60 flex items-center justify-center text-[#052659] shrink-0">
                        {isEmergency ? (
                          <AlertTriangle className="w-3.5 h-3.5 text-[#052659]" />
                        ) : (
                          <Shield className="w-3.5 h-3.5 text-[#5482B4]" />
                        )}
                      </div>

                      <h3 className="text-xs font-semibold text-[#011025] uppercase tracking-tight truncate">
                        {report.hazard_type}
                      </h3>
                    </div>

                    <span className="font-sans text-[10px] font-medium text-[#052659] bg-[#C2E8FF]/40 border border-[#7EA0C5]/30 px-2 py-0.5 rounded-full shrink-0">
                      {report.code}
                    </span>
                  </div>

                  <div className="mt-1.5 flex items-center justify-between text-xs text-[#5482B4]">
                    <div className="flex items-center gap-1 min-w-0">
                      <MapPin className="w-3.5 h-3.5 text-[#5482B4] shrink-0" />
                      <span className="font-normal truncate">
                        Barangay {barangayName}
                      </span>
                    </div>
                    <span className="text-[11px] text-[#7EA0C5] shrink-0">{formatRelativeTime(report.created_at)}</span>
                  </div>

                  {/* Progressive Disclosure: Details revealed on hover or click */}
                  <div className={`overflow-hidden transition-all duration-200 ${
                    isSelected
                      ? 'max-h-36 mt-2 pt-2 border-t border-[#7EA0C5]/30 opacity-100'
                      : 'max-h-0 group-hover:max-h-36 group-hover:mt-2 group-hover:pt-2 group-hover:border-t group-hover:border-[#7EA0C5]/20 opacity-0 group-hover:opacity-100'
                  }`}>
                    {report.description && (
                      <p className="text-[11px] text-[#5482B4] line-clamp-2 leading-relaxed">
                        {report.description}
                      </p>
                    )}
                    <div className="mt-1.5 flex items-center justify-between text-[10px] text-[#7EA0C5]">
                      <span className="inline-flex items-center gap-1 font-mono">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#7EA0C5]" />
                        {report.corroboration_count} corroborations
                      </span>
                      <span className="text-[#052659] font-medium">Click to inspect map</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 4. Bottom Section: Structured Analytic Overviews (Scoped to Barangay) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 sm:gap-6 items-stretch w-full">
        {/* Card 1: Incidents by Hazard Type (Barangay Distribution) */}
        <div className="bg-white rounded-[26px] border border-[#7EA0C5]/30 shadow-[0_2px_12px_rgba(1,16,37,0.03)] p-6 flex flex-col justify-between min-w-0 w-full relative group">
          <div>
            <div className="flex items-center justify-between pb-3.5 border-b border-[#7EA0C5]/20">
              <div>
                <h2 className="text-base font-semibold text-[#011025] tracking-tight">
                  Incidents by Hazard Type
                </h2>
                <p className="text-[11px] text-[#7EA0C5] font-normal">
                  Barangay {barangayName} distribution
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-sans text-[10px] font-medium text-[#052659] bg-[#C2E8FF]/50 border border-[#7EA0C5]/40 px-2.5 py-0.5 rounded-full">
                  {scopedReports.length} ON RECORD
                </span>
                <span className="w-6 h-6 rounded-full border border-[#7EA0C5]/40 text-[#5482B4] flex items-center justify-center text-[11px]">
                  ↗
                </span>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {hazardDistribution.map((item, index) => (
                <div key={item.type} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[#011025] tracking-normal">
                      {item.type}
                    </span>
                    <span className="font-sans font-semibold text-[#011025]">{item.count}</span>
                  </div>
                  <div className="h-2.5 w-full bg-[#C2E8FF]/30 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        index === 0
                          ? 'bg-[#052659]'
                          : index === 1
                          ? 'bg-[#5482B4]'
                          : 'bg-[#7EA0C5]'
                      }`}
                      style={{ width: `${Math.max(8, item.percentage)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[11px] text-[#7EA0C5] mt-5 pt-3.5 border-t border-[#7EA0C5]/20 font-normal">
            Automated aggregation across Barangay {barangayName} hazard channels.
          </p>
        </div>

        {/* Card 2: Active Advisories */}
        <div className="bg-white rounded-[26px] border border-[#7EA0C5]/30 shadow-[0_2px_12px_rgba(1,16,37,0.03)] p-6 flex flex-col justify-between min-w-0 w-full relative group">
          <div>
            <div className="flex items-center justify-between pb-3.5 border-b border-[#7EA0C5]/20">
              <div>
                <h2 className="text-base font-semibold text-[#011025] tracking-tight">
                  Active Advisories
                </h2>
                <p className="text-[11px] text-[#7EA0C5] font-normal">
                  Public warnings affecting {barangayName}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-sans text-[10px] font-medium text-[#052659] bg-[#C2E8FF]/50 border border-[#7EA0C5]/40 px-2.5 py-0.5 rounded-full">
                  {scopedAdvisories.filter((a) => a.severity !== 'low').length} live
                </span>
                <span className="w-6 h-6 rounded-full border border-[#7EA0C5]/40 text-[#5482B4] flex items-center justify-center text-[11px]">
                  ↗
                </span>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {scopedAdvisories.slice(0, 3).map((advisory) => {
                const isEmergency =
                  advisory.severity === 'critical' || advisory.severity === 'high';
                return (
                  <div
                    key={advisory.id}
                    onClick={() => {
                      if (onNavigateTab) onNavigateTab('advisories');
                    }}
                    className="p-3.5 rounded-2xl border border-[#7EA0C5]/20 hover:border-[#5482B4] bg-[#C2E8FF]/15 hover:bg-[#C2E8FF]/35 transition-all cursor-pointer space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h4 className="text-xs font-semibold text-[#011025] truncate">
                          {advisory.title}
                        </h4>
                      </div>

                      <span
                        className={`text-[9px] font-medium uppercase px-2.5 py-0.5 rounded-full shrink-0 ${
                          isEmergency
                            ? 'bg-[#052659] text-white'
                            : 'bg-[#C2E8FF] text-[#052659] border border-[#7EA0C5]/40'
                        }`}
                      >
                        {isEmergency ? 'EMERGENCY' : 'WARNING'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 text-[11px] text-[#5482B4] font-normal">
                      <MapPin className="w-3 h-3 text-[#7EA0C5] shrink-0" />
                      <span className="truncate">
                        {advisory.target_barangay_id
                          ? `Barangay ${barangayName}`
                          : `Lingayen Coastal & Riverine Sectors (includes ${barangayName})`}
                      </span>
                      <span>•</span>
                      <span>{new Date(advisory.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {onNavigateTab && (
            <button
              onClick={() => onNavigateTab('advisories')}
              className="mt-5 pt-3.5 border-t border-[#7EA0C5]/20 text-xs font-medium text-[#052659] hover:text-[#5482B4] flex items-center justify-between w-full cursor-pointer"
            >
              <span>View all emergency bulletins</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Card 3: Barangay Readiness */}
        <div className="bg-white rounded-[26px] border border-[#7EA0C5]/30 shadow-[0_2px_12px_rgba(1,16,37,0.03)] p-6 flex flex-col justify-between min-w-0 w-full relative group">
          <div>
            <div className="flex items-center justify-between pb-3.5 border-b border-[#7EA0C5]/20">
              <div>
                <h2 className="text-base font-semibold text-[#011025] tracking-tight">
                  Barangay Readiness
                </h2>
                <p className="text-[11px] text-[#7EA0C5] font-normal">
                  BDRRMC operational status
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-sans text-[10px] font-medium text-[#052659] bg-[#C2E8FF]/50 border border-[#7EA0C5]/40 px-2.5 py-0.5 rounded-full">
                  Operational
                </span>
                <span className="w-6 h-6 rounded-full border border-[#7EA0C5]/40 text-[#5482B4] flex items-center justify-center text-[11px]">
                  ↗
                </span>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {/* Metric 1: Shelters Open */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#5482B4] font-normal">Barangay shelters open</span>
                  <span className="font-sans font-semibold text-[#011025]">
                    {openSheltersCount} / {scopedShelters.length} ({shelterCapacityRate}% full)
                  </span>
                </div>
                <div className="h-2.5 w-full bg-[#C2E8FF]/30 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#052659] rounded-full"
                    style={{
                      width: `${Math.round(
                        (openSheltersCount / Math.max(1, scopedShelters.length)) * 100
                      )}%`,
                    }}
                  />
                </div>
              </div>

              {/* Metric 2: Units Assigned */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#5482B4] font-normal">Barangay units assigned</span>
                  <span className="font-sans font-semibold text-[#011025]">
                    {unitsDeployed} active {unitsDeployed === 1 ? 'crew' : 'crews'}
                  </span>
                </div>
                <div className="h-2.5 w-full bg-[#C2E8FF]/30 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#5482B4] rounded-full"
                    style={{ width: `${Math.min(100, Math.max(20, unitsDeployed * 40))}%` }}
                  />
                </div>
              </div>

              {/* Metric 3: Corroboration Rate */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#5482B4] font-normal">Corroboration rate</span>
                  <span className="font-sans font-semibold text-[#011025]">
                    {corroborationRate}% verified
                  </span>
                </div>
                <div className="h-2.5 w-full bg-[#C2E8FF]/30 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#7EA0C5] rounded-full"
                    style={{ width: `${corroborationRate}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Operational Modules: Relief Distributions, Road Work Posts, Preparedness Guides, FAQ Entries */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 w-full">
        {/* Module 1: Relief Distributions */}
        <div
          onClick={() => onNavigateTab && onNavigateTab('relief')}
          className="bg-white rounded-[22px] p-5 border border-[#7EA0C5]/30 shadow-[0_2px_12px_rgba(1,16,37,0.03)] hover:border-[#5482B4] hover:shadow-xs transition-all cursor-pointer group flex flex-col justify-between"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#C2E8FF]/50 text-[#052659] flex items-center justify-center border border-[#7EA0C5]/30 shadow-2xs group-hover:bg-[#052659] group-hover:text-white transition-colors shrink-0">
              <Package className="w-5 h-5" />
            </div>
            <span className="w-6 h-6 rounded-full border border-[#7EA0C5]/40 text-[#7EA0C5] group-hover:text-[#052659] flex items-center justify-center text-[11px] transition-colors">
              ↗
            </span>
          </div>
          <div className="mt-4 space-y-0.5">
            <h3 className="text-sm font-semibold text-[#011025] tracking-tight group-hover:text-[#052659]">
              Relief Distributions
            </h3>
            <p className="text-xs text-[#5482B4] font-normal">
              {reliefActiveCount} active in {barangayName}
            </p>
          </div>
        </div>

        {/* Module 2: Road Work Posts */}
        <div
          onClick={() => onNavigateTab && onNavigateTab('road_work')}
          className="bg-white rounded-[22px] p-5 border border-[#7EA0C5]/30 shadow-[0_2px_12px_rgba(1,16,37,0.03)] hover:border-[#5482B4] hover:shadow-xs transition-all cursor-pointer group flex flex-col justify-between"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#C2E8FF]/50 text-[#052659] flex items-center justify-center border border-[#7EA0C5]/30 shadow-2xs group-hover:bg-[#052659] group-hover:text-white transition-colors shrink-0">
              <Construction className="w-5 h-5" />
            </div>
            <span className="w-6 h-6 rounded-full border border-[#7EA0C5]/40 text-[#7EA0C5] group-hover:text-[#052659] flex items-center justify-center text-[11px] transition-colors">
              ↗
            </span>
          </div>
          <div className="mt-4 space-y-0.5">
            <h3 className="text-sm font-semibold text-[#011025] tracking-tight group-hover:text-[#052659]">
              Road Work Posts
            </h3>
            <p className="text-xs text-[#5482B4] font-normal">
              {roadWorkActiveCount} active in jurisdiction
            </p>
          </div>
        </div>

        {/* Module 3: Preparedness Guides */}
        <div
          onClick={() => onNavigateTab && onNavigateTab('guides')}
          className="bg-white rounded-[22px] p-5 border border-[#7EA0C5]/30 shadow-[0_2px_12px_rgba(1,16,37,0.03)] hover:border-[#5482B4] hover:shadow-xs transition-all cursor-pointer group flex flex-col justify-between"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#C2E8FF]/50 text-[#052659] flex items-center justify-center border border-[#7EA0C5]/30 shadow-2xs group-hover:bg-[#052659] group-hover:text-white transition-colors shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <span className="w-6 h-6 rounded-full border border-[#7EA0C5]/40 text-[#7EA0C5] group-hover:text-[#052659] flex items-center justify-center text-[11px] transition-colors">
              ↗
            </span>
          </div>
          <div className="mt-4 space-y-0.5">
            <h3 className="text-sm font-semibold text-[#011025] tracking-tight group-hover:text-[#052659]">
              Preparedness Guides
            </h3>
            <p className="text-xs text-[#5482B4] font-normal">
              {guidesPublishedCount} published
            </p>
          </div>
        </div>

        {/* Module 4: FAQ Entries */}
        <div
          onClick={() => onNavigateTab && onNavigateTab('faqs')}
          className="bg-white rounded-[22px] p-5 border border-[#7EA0C5]/30 shadow-[0_2px_12px_rgba(1,16,37,0.03)] hover:border-[#5482B4] hover:shadow-xs transition-all cursor-pointer group flex flex-col justify-between"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#C2E8FF]/50 text-[#052659] flex items-center justify-center border border-[#7EA0C5]/30 shadow-2xs group-hover:bg-[#052659] group-hover:text-white transition-colors shrink-0">
              <HelpCircle className="w-5 h-5" />
            </div>
            <span className="w-6 h-6 rounded-full border border-[#7EA0C5]/40 text-[#7EA0C5] group-hover:text-[#052659] flex items-center justify-center text-[11px] transition-colors">
              ↗
            </span>
          </div>
          <div className="mt-4 space-y-0.5">
            <h3 className="text-sm font-semibold text-[#011025] tracking-tight group-hover:text-[#052659]">
              FAQ Entries
            </h3>
            <p className="text-xs text-[#5482B4] font-normal">
              {faqsPublishedCount} published
            </p>
          </div>
        </div>
      </div>

      {/* 5. Declare Emergency Modal (Scoped to Barangay) */}
      {isDeclareEmergencyModalOpen && (
        <div className="fixed inset-0 z-50 bg-[#011025]/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-[28px] max-w-lg w-full border border-[#7EA0C5]/30 shadow-2xl p-7 space-y-5 animate-in zoom-in-95">
            <div className="flex items-start justify-between gap-3 pb-3.5 border-b border-[#7EA0C5]/20">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-[#052659] text-white flex items-center justify-center shadow-xs">
                  <Megaphone className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-[#011025]">
                    Declare Barangay Emergency Directive
                  </h3>
                  <p className="text-xs text-[#7EA0C5] font-normal">
                    BDRRMC Barangay {barangayName} Incident Command
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsDeclareEmergencyModalOpen(false)}
                className="p-1.5 text-[#7EA0C5] hover:text-[#011025] rounded-full hover:bg-[#C2E8FF]/30 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {broadcastSuccessNotice ? (
              <div className="p-6 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-[#C2E8FF] text-[#052659] flex items-center justify-center mx-auto border border-[#7EA0C5]/40">
                  <BellRing className="w-6 h-6 animate-bounce" />
                </div>
                <h4 className="text-sm font-semibold text-[#011025]">
                  {broadcastSuccessNotice}
                </h4>
                <p className="text-xs text-[#5482B4]">
                  Advisory banner active and broadcasted to all residents in Barangay {barangayName}.
                </p>
              </div>
            ) : (
              <form onSubmit={handleDeclareEmergencySubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#011025] mb-1.5">
                    Directive / Warning Title
                  </label>
                  <input
                    type="text"
                    value={emergencyTitle}
                    onChange={(e) => setEmergencyTitle(e.target.value)}
                    required
                    placeholder="e.g. Flash Flood Evacuation Notice - Sector A"
                    className="w-full px-4 py-2.5 text-xs font-medium text-[#011025] placeholder:text-[#7EA0C5] border border-[#7EA0C5]/40 rounded-2xl focus:outline-hidden focus:border-[#052659] focus:ring-2 focus:ring-[#052659]/15"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#011025] mb-1.5">
                      Alert Severity
                    </label>
                    <select
                      value={emergencySeverity}
                      onChange={(e) => setEmergencySeverity(e.target.value as 'critical' | 'high')}
                      className="w-full px-3.5 py-2.5 text-xs font-medium text-[#011025] border border-[#7EA0C5]/40 rounded-2xl focus:outline-hidden focus:border-[#052659]"
                    >
                      <option value="critical">CRITICAL (Red Alert)</option>
                      <option value="high">HIGH (Severe Warning)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#011025] mb-1.5">
                      Jurisdiction Scope
                    </label>
                    <input
                      type="text"
                      disabled
                      value={`Barangay ${barangayName}`}
                      className="w-full px-3.5 py-2.5 text-xs font-medium text-[#5482B4] bg-[#C2E8FF]/20 border border-[#7EA0C5]/30 rounded-2xl cursor-not-allowed"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#011025] mb-1.5">
                    Emergency Directives & Public Instructions
                  </label>
                  <textarea
                    rows={3}
                    value={emergencyMessage}
                    onChange={(e) => setEmergencyMessage(e.target.value)}
                    required
                    placeholder="Specify evacuation routes, designated barangay shelters, and tanod assistance..."
                    className="w-full px-4 py-2.5 text-xs font-normal text-[#011025] placeholder:text-[#7EA0C5] border border-[#7EA0C5]/40 rounded-2xl focus:outline-hidden focus:border-[#052659] focus:ring-2 focus:ring-[#052659]/15"
                  />
                </div>

                <div className="pt-2 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setIsDeclareEmergencyModalOpen(false)}
                    className="px-5 py-2.5 rounded-full text-xs font-medium text-[#052659] hover:bg-[#C2E8FF]/30 border border-[#7EA0C5]/40 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isBroadcasting}
                    className="px-6 py-2.5 rounded-full text-xs font-medium text-white bg-[#052659] hover:bg-[#5482B4] transition-all shadow-xs cursor-pointer disabled:bg-[#7EA0C5] disabled:opacity-70 flex items-center gap-2 border border-[#011025]"
                  >
                    {isBroadcasting ? (
                      <BrandLoader
                        mode="inline"
                        portal={portalForRole(currentUser.role)}
                        process="publish"
                        variant="reverse"
                        context={{ barangayName: currentUser.barangay_name }}
                      />
                    ) : (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5 text-white" />
                        <span>Broadcast Barangay Directive</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
