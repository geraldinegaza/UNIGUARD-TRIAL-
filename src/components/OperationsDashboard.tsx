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
  HelpCircle
} from 'lucide-react';
import { Barangay, IncidentReport, EvacuationCenter, Advisory, User } from '../types';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import { BrandLoader, portalForRole } from '../brand';
import { CENTER } from '../lib/geo';

interface OperationsDashboardProps {
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

export const OperationsDashboard: React.FC<OperationsDashboardProps> = ({
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
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [showLayersDropdown, setShowLayersDropdown] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [isDeclareEmergencyModalOpen, setIsDeclareEmergencyModalOpen] = useState(false);

  // Form State for Declare Emergency Modal
  const [emergencyTitle, setEmergencyTitle] = useState('Emergency declaration: municipality-wide response activated');
  const [emergencyScope, setEmergencyScope] = useState('Municipality-wide (Lingayen)');
  const [emergencyMessage, setEmergencyMessage] = useState('');
  const [emergencySeverity, setEmergencySeverity] = useState<'critical' | 'high'>('critical');
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastSuccessNotice, setBroadcastSuccessNotice] = useState<string | null>(null);

  // Live module data and connection state from the store
  const store = useRepo();
  const isRealtimeActive = store.source === 'supabase' && store.online;

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

  // Initialize Leaflet Map with Esri World Street Map Tiles (matching initial draft screenshot)
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: CENTER,
        zoom: 14,
        zoomControl: false,
        attributionControl: true,
      });

      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Leaflet | Tiles &copy; Esri &mdash; Source: Esri, HERE, Garmin, FAO, NOAA, USGS, &copy; OpenStreetMap contributors, and the GIS User Community',
        maxZoom: 18,
        minZoom: 11,
      }).addTo(map);

      const markersGroup = L.layerGroup().addTo(map);
      markersLayerGroupRef.current = markersGroup;
      mapInstanceRef.current = map;

      // Ensure proper tile sizing after mount
      const timer = setTimeout(() => {
        map.invalidateSize();
      }, 300);

      return () => {
        clearTimeout(timer);
      };
    }
  }, []);

  // Zoom controls for the map
  const handleZoomIn = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.zoomIn();
    }
  };

  const handleZoomOut = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.zoomOut();
    }
  };

  // Metrics Calculations matching the 4 stat cards in initial draft screenshot
  const isOpen = (r: IncidentReport) => r.status !== 'resolved' && r.status !== 'rejected';
  const activeIncidents = useMemo(() => {
    return reports.filter(isOpen);
  }, [reports]);

  // Units deployed: responder units currently assigned to open incidents
  const unitsDeployed = useMemo(() => {
    return reports.filter(isOpen).reduce((n, r) => n + r.assigned_units, 0);
  }, [reports]);

  // Critical areas: emergency severity, not resolved
  const criticalAreas = useMemo(() => {
    return reports.filter((r) => isOpen(r) && r.severity === 'emergency').length;
  }, [reports]);

  // Sort newest first
  const sortedReports = useMemo(() => {
    return [...reports].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [reports]);

  // Selected incident object
  const activeSelectedIncident = useMemo(() => {
    return reports.find((r) => r.id === selectedIncidentId) || null;
  }, [reports, selectedIncidentId]);

  // Operational Module Counts matching portal modules
  const reliefActiveCount = store.relief.filter((r) => r.active).length;
  const roadWorkActiveCount = store.roadWork.filter((r) => r.status === 'active').length;
  const guidesPublishedCount = store.guides.length;
  const faqsPublishedCount = store.faqs.length;

  // Update Markers, Routes, and Overlays on the Real Map (matching initial draft screenshot)
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersGroup = markersLayerGroupRef.current;
    if (!map || !markersGroup) return;

    markersGroup.clearLayers();

    const badge = (text: string, bg: string) =>
      `<div style="background-color: ${bg}; color: #ffffff; font-size: 10px; font-weight: 800; font-family: ui-sans-serif, system-ui, sans-serif; padding: 2.5px 7px; border-radius: 6px; border: 1.5px solid #ffffff; box-shadow: 0 2px 6px rgba(0,0,0,0.35); text-align: center; letter-spacing: 0.5px; cursor: pointer; white-space: nowrap;">${text}</div>`;
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

    // 1. Road Status overlay (cyan waypoints, one per road with coordinates)
    if (layers.perimeters) {
      store.roadStatus.forEach((road) => {
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
          `<div style="font-weight: bold; font-size: 11px;">${esc(road.road_name)} · ${road.status}</div><div style="font-size: 10px; color: #64748b;">${esc(road.note)}</div>`,
          { direction: 'top', offset: [0, -12] }
        );
      });
    }

    // 2. Shelters & Relief Hubs (EVAC and REL badges)
    if (layers.shelters) {
      evacuationCenters.forEach((evac) => {
        if (!evac.has_location) return;
        // Green when open, orange when full, slate when closed
        const bg = evac.status === 'open' ? '#16a34a' : evac.status === 'full' ? '#ea580c' : '#475569';
        const evacIcon = L.divIcon({
          className: 'bg-transparent',
          html: badge('EVAC', bg),
          iconSize: [44, 22],
          iconAnchor: [22, 11],
        });

        const m = L.marker([evac.latitude, evac.longitude], { icon: evacIcon }).addTo(markersGroup);
        m.bindTooltip(
          `<div style="font-weight: bold; font-size: 11px;">${esc(evac.name)}</div><div style="font-size: 10px; color: #64748b;">Capacity: ${evac.current_occupancy}/${evac.capacity} evacuees</div>`,
          { direction: 'top', offset: [0, -12] }
        );
      });

      // Purple REL (Relief) badges for active distributions with coordinates
      store.relief.forEach((r) => {
        if (!r.active || r.lat === null || r.lng === null) return;
        const relIcon = L.divIcon({
          className: 'bg-transparent',
          html: badge('REL', '#8b5cf6'),
          iconSize: [40, 22],
          iconAnchor: [20, 11],
        });
        const relMarker = L.marker([r.lat, r.lng], { icon: relIcon }).addTo(markersGroup);
        relMarker.bindPopup(`
          <div style="font-family: ui-sans-serif, system-ui, sans-serif; padding: 4px 2px; min-width: 130px;">
            <div style="font-weight: 800; font-size: 11px; color: #0f172a;">${esc(r.title)}</div>
            <div style="font-size: 10px; color: #64748b; margin-top: 1px;">${esc(r.location_name || r.barangay)}</div>
          </div>
        `, { offset: [0, -12] });
      });
    }

    // 3. Active Incident Hazard Pins (Red circles with optional pulse)
    if (layers.hazards) {
      sortedReports
        .filter((r) => isOpen(r) && r.has_location)
        .forEach((rep) => {
          const isSelected = selectedIncidentId === rep.id;
          const isEmergency = rep.severity === 'emergency';

          const hazardHtml = `
            <div style="position: relative; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
              ${(isEmergency && isRealtimeActive) ? '<span style="position: absolute; width: 28px; height: 28px; border-radius: 9999px; background: rgba(220, 38, 38, 0.45); animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></span>' : ''}
              <span style="position: relative; width: ${isSelected ? '18px' : '13px'}; height: ${isSelected ? '18px' : '13px'}; border-radius: 9999px; background: #dc2626; border: 2.5px solid #ffffff; box-shadow: 0 2px 6px rgba(0,0,0,0.4);"></span>
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

    // 4. Deployed Units (QRU badges on incidents with assigned responder units)
    if (layers.units) {
      reports
        .filter((r) => isOpen(r) && r.has_location && r.assigned_units > 0)
        .forEach((rep) => {
          const label = `${rep.assigned_units} unit${rep.assigned_units > 1 ? 's' : ''}`;
          const unitIcon = L.divIcon({
            className: 'bg-transparent',
            html: `<div style="background-color: #18181b; color: #ffffff; font-size: 9px; font-weight: 800; font-family: ui-sans-serif, system-ui, sans-serif; padding: 2px 6px; border-radius: 6px; border: 1.5px solid #ffffff; box-shadow: 0 2px 6px rgba(0,0,0,0.35); text-align: center; cursor: pointer; white-space: nowrap;">QRU: ${label}</div>`,
            iconSize: [80, 20],
            iconAnchor: [40, 10],
          });
          const m = L.marker([rep.latitude + 0.0018, rep.longitude - 0.0018], { icon: unitIcon }).addTo(markersGroup);
          m.bindTooltip(`Assigned: ${label}`, { direction: 'top' });
        });
    }
  }, [reports, evacuationCenters, layers, selectedIncidentId, isRealtimeActive, sortedReports, store.roadStatus, store.relief]);

  // Helper to get Barangay Name
  const getBarangayName = (barangayId: string) => {
    const b = barangays.find((brgy) => brgy.id === barangayId);
    return b ? b.name : barangayId;
  };

  // Hazard Type count distribution for "Incidents by Hazard Type"
  const hazardDistribution = useMemo(() => {
    const map: Record<string, number> = {};
    reports.forEach((r) => {
      const type = r.hazard_type.toUpperCase();
      map[type] = (map[type] || 0) + 1;
    });

    const total = reports.length || 1;
    return Object.entries(map)
      .map(([type, count]) => ({
        type,
        count,
        percentage: Math.round((count / total) * 100),
      }))
      .sort((a, b) => b.count - a.count);
  }, [reports]);

  // Readiness Metrics
  const openSheltersCount = useMemo(() => {
    return evacuationCenters.filter((c) => c.status === 'open').length;
  }, [evacuationCenters]);

  const shelterCapacityRate = useMemo(() => {
    const total = evacuationCenters.reduce((acc, c) => acc + c.capacity, 0);
    const occupied = evacuationCenters.reduce((acc, c) => acc + c.current_occupancy, 0);
    return total > 0 ? Math.round((occupied / total) * 100) : 0;
  }, [evacuationCenters]);

  // Share of reports that reached the three confirmations needed to auto-verify
  const corroborationRate = useMemo(() => {
    if (reports.length === 0) return 0;
    return Math.round((reports.filter((r) => r.corroboration_count >= 3).length / reports.length) * 100);
  }, [reports]);

  // Handle Emergency Declaration broadcast. A municipality-wide red alert runs
  // through the declare_emergency server function (LGU only, audited, pushed to
  // subscribed devices); a targeted or lower severity one is a normal advisory.
  const handleDeclareEmergencySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emergencyTitle.trim() || isBroadcasting) return;

    const targetBrgy =
      emergencyScope === 'Municipality-wide (Lingayen)'
        ? null
        : barangays.find((b) => b.name.toLowerCase() === emergencyScope.toLowerCase())?.id || null;

    setIsBroadcasting(true);
    try {
      if (!targetBrgy && emergencySeverity === 'critical') {
        const res = await repo.declareEmergency(emergencyTitle.trim(), emergencyMessage.trim());
        setBroadcastSuccessNotice(`Emergency declaration broadcast to ${res.devices} devices`);
      } else {
        await repo.createAdvisory({
          title: emergencyTitle.trim(),
          content: emergencyMessage.trim(),
          type: 'emergency_alert',
          severity: emergencySeverity,
          target_barangay_id: targetBrgy,
        });
        setBroadcastSuccessNotice(`Emergency directive published to ${emergencyScope}`);
      }
      if (onDataChanged) onDataChanged();
      setTimeout(() => {
        setBroadcastSuccessNotice(null);
        setIsDeclareEmergencyModalOpen(false);
      }, 1500);
    } catch (err: any) {
      setBroadcastSuccessNotice(err.message || 'Could not broadcast the declaration.');
      setTimeout(() => setBroadcastSuccessNotice(null), 4000);
    } finally {
      setIsBroadcasting(false);
    }
  };

  // Geographic mapping projection into SVG coordinate space (1000 x 560)
  const latMin = 15.998;
  const latMax = 16.046;
  const lngMin = 120.190;
  const lngMax = 120.252;

  const projectToMap = (lat: number, lng: number) => {
    const x = ((lng - lngMin) / (lngMax - lngMin)) * 940 + 30;
    const y = ((latMax - lat) / (latMax - latMin)) * 500 + 30;
    return {
      x: Math.max(30, Math.min(970, x)),
      y: Math.max(30, Math.min(530, y)),
    };
  };

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-300">
      {/* 1. Header Section: Operations Dashboard + Analytics + Declare Emergency */}
      <div className="px-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-semibold text-neutral-900 tracking-tight">
              Operations Dashboard
            </h1>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-medium bg-neutral-100 text-neutral-600 border border-neutral-200/80">
              COMMAND CENTER
            </span>
          </div>
          <p className="text-xs sm:text-sm text-neutral-500 font-normal mt-0.5">
            Real-time monitoring and incident command overview for Lingayen, Pangasinan.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto flex-wrap">
          {/* Analytics Shortcut Button (Redirects to Analytics in LDRRMC navigation) */}
          {(onNavigateTab || onNavigateView) && (
            <button
              onClick={() => {
                if (onNavigateTab) {
                  onNavigateTab('analytics');
                } else if (onNavigateView) {
                  onNavigateView('Analytics');
                }
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium text-neutral-700 bg-white hover:bg-neutral-50 border border-neutral-200/80 transition-all shadow-2xs cursor-pointer active:scale-95"
            >
              <Layers className="w-3.5 h-3.5 text-neutral-600" />
              <span>Analytics</span>
            </button>
          )}

          {/* Declare Emergency Action Button (from Initial Draft) */}
          <button
            onClick={() => setIsDeclareEmergencyModalOpen(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-medium text-white bg-[#18181b] hover:bg-[#27272a] transition-all shadow-xs cursor-pointer active:scale-95 border border-neutral-900"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-white fill-white/10" />
            <span>Declare Emergency</span>
          </button>
        </div>
      </div>

      {/* 2. Top Metric Cards (4 KPI Cards from Initial Draft: Active Incidents, Units Deployed, Critical Areas, System Status) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5 w-full">
        {/* Card 1: ACTIVE INCIDENTS */}
        <div className="bg-[#18181b] text-white rounded-[22px] p-5 shadow-sm min-w-0 w-full flex flex-col justify-between relative group border border-neutral-800">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium tracking-normal text-neutral-400 uppercase">
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
              <span className="w-6 h-6 rounded-full border border-white/20 text-neutral-400 flex items-center justify-center text-[11px]">
                ↗
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-white/10 flex items-center gap-2 text-xs text-neutral-400 font-normal">
            <span className="w-1.5 h-1.5 rounded-full bg-neutral-300" />
            <span>Live from the incident queue</span>
          </div>
        </div>

        {/* Card 2: UNITS DEPLOYED */}
        <div className="bg-[#18181b] text-white rounded-[22px] p-5 shadow-sm min-w-0 w-full flex flex-col justify-between relative group border border-neutral-800">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium tracking-normal text-neutral-400 uppercase">
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
              <span className="w-6 h-6 rounded-full border border-white/20 text-neutral-400 flex items-center justify-center text-[11px]">
                ↗
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-white/10 flex items-center gap-2 text-xs text-neutral-400 font-normal">
            <span className="w-1.5 h-1.5 rounded-full bg-neutral-300" />
            <span>Assigned responders</span>
          </div>
        </div>

        {/* Card 3: CRITICAL AREAS */}
        <div className="bg-[#18181b] text-white rounded-[22px] p-5 shadow-sm min-w-0 w-full flex flex-col justify-between relative group border border-neutral-800">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium tracking-normal text-neutral-400 uppercase">
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
              <span className="w-6 h-6 rounded-full border border-white/20 text-neutral-400 flex items-center justify-center text-[11px]">
                ↗
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-white/10 flex items-center gap-2 text-xs text-neutral-400 font-normal">
            <span className="w-1.5 h-1.5 rounded-full bg-neutral-300" />
            <span>Emergency severity, not resolved</span>
          </div>
        </div>

        {/* Card 4: SYSTEM STATUS */}
        <div className="bg-[#18181b] text-white rounded-[22px] p-5 shadow-sm min-w-0 w-full flex flex-col justify-between relative group border border-neutral-800">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium tracking-normal text-neutral-400 uppercase">
                SYSTEM STATUS
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-2xl sm:text-3xl font-bold text-white tracking-tight font-sans">
                  {isRealtimeActive ? 'LIVE' : 'STABLE'}
                </span>
                <span className="inline-flex h-2 w-2 rounded-full bg-neutral-300" />
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center">
                <Radio className="w-4 h-4 text-white" />
              </div>
              <span className="w-6 h-6 rounded-full border border-white/20 text-neutral-400 flex items-center justify-center text-[11px]">
                ↗
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-white/10 flex items-center gap-2 text-xs text-neutral-400 font-normal">
            <span className="w-1.5 h-1.5 rounded-full bg-neutral-300" />
            <span>{isRealtimeActive ? 'Realtime connected' : 'Serving cached data'}</span>
          </div>
        </div>
      </div>
      {/* 3. Middle Section: Live Operations Map (Left) + Recent Incidents (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start w-full">
        {/* Left Column: Live Operations Map (8 cols) */}
        <div className="lg:col-span-8 bg-white rounded-[26px] border border-neutral-100 shadow-[0_2px_12px_rgba(0,0,0,0.03)] overflow-hidden flex flex-col min-w-0 w-full">
          {/* Map Header with Realtime and Layers Controls */}
          <div className="px-6 py-5 border-b border-neutral-100 flex flex-wrap items-center justify-between gap-3 bg-white">
            <div>
              <h2 className="text-base font-semibold text-neutral-900 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-neutral-700" />
                <span>Live Operations Map</span>
              </h2>
              <p className="text-xs text-neutral-400 font-normal mt-0.5">
                Active incident perimeters and deployed units
              </p>
            </div>

            {/* Controls: Realtime button + Layers toggle */}
            <div className="flex items-center gap-2 relative">
              <button
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all border cursor-pointer ${
                  isRealtimeActive
                    ? 'bg-[#18181b] text-white border-neutral-900 shadow-2xs'
                    : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isRealtimeActive ? 'bg-white animate-pulse' : 'bg-neutral-300'
                  }`}
                />
                <span>Realtime</span>
              </button>

              <div className="relative">
                <button
                  onClick={() => setShowLayersDropdown((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium text-neutral-700 bg-white hover:bg-neutral-50 border border-neutral-200 transition-colors cursor-pointer shadow-2xs"
                >
                  <Layers className="w-3.5 h-3.5 text-neutral-600" />
                  <span>Layers</span>
                </button>

                {/* Layer Menu Dropdown */}
                {showLayersDropdown && (
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-neutral-200 p-2 z-30 animate-in fade-in slide-in-from-top-2">
                    <p className="text-[10px] font-bold text-neutral-400 uppercase px-2 py-1">
                      Map Layers
                    </p>
                    <label className="flex items-center gap-2.5 px-2 py-1.5 hover:bg-neutral-50 rounded-xl cursor-pointer text-xs font-medium text-neutral-700">
                      <input
                        type="checkbox"
                        checked={layers.hazards}
                        onChange={(e) =>
                          setLayers((prev) => ({ ...prev, hazards: e.target.checked }))
                        }
                        className="rounded text-neutral-900 focus:ring-neutral-900 w-3.5 h-3.5"
                      />
                      <span>Active Incidents</span>
                    </label>

                    <label className="flex items-center gap-2.5 px-2 py-1.5 hover:bg-neutral-50 rounded-xl cursor-pointer text-xs font-medium text-neutral-700">
                      <input
                        type="checkbox"
                        checked={layers.perimeters}
                        onChange={(e) =>
                          setLayers((prev) => ({ ...prev, perimeters: e.target.checked }))
                        }
                        className="rounded text-neutral-900 focus:ring-neutral-900 w-3.5 h-3.5"
                      />
                      <span>Road Status</span>
                    </label>

                    <label className="flex items-center gap-2.5 px-2 py-1.5 hover:bg-neutral-50 rounded-xl cursor-pointer text-xs font-medium text-neutral-700">
                      <input
                        type="checkbox"
                        checked={layers.units}
                        onChange={(e) =>
                          setLayers((prev) => ({ ...prev, units: e.target.checked }))
                        }
                        className="rounded text-neutral-900 focus:ring-neutral-900 w-3.5 h-3.5"
                      />
                      <span>Deployed Units</span>
                    </label>

                    <label className="flex items-center gap-2.5 px-2 py-1.5 hover:bg-neutral-50 rounded-xl cursor-pointer text-xs font-medium text-neutral-700">
                      <input
                        type="checkbox"
                        checked={layers.shelters}
                        onChange={(e) =>
                          setLayers((prev) => ({ ...prev, shelters: e.target.checked }))
                        }
                        className="rounded text-neutral-900 focus:ring-neutral-900 w-3.5 h-3.5"
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
            {/* Real Map Canvas */}
            <div ref={mapContainerRef} className="w-full h-full" style={{ zIndex: 1 }} />

            {/* On-Map Floating Zoom Controls */}
            <div className="absolute top-4 right-4 z-10 pointer-events-auto">
              {/* Map Zoom Controls */}
              <div className="flex flex-col shadow-md rounded-2xl overflow-hidden border border-slate-200 bg-white">
                <button
                  onClick={handleZoomIn}
                  className="w-8 h-8 flex items-center justify-center text-neutral-700 hover:text-neutral-900 hover:bg-neutral-50 border-b border-slate-200 transition-colors cursor-pointer"
                  title="Zoom in"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  onClick={handleZoomOut}
                  className="w-8 h-8 flex items-center justify-center text-neutral-700 hover:text-neutral-900 hover:bg-neutral-50 transition-colors cursor-pointer"
                  title="Zoom out"
                >
                  <Minus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Map Floating Incident Inspector Popup (When an incident is selected) */}
            {activeSelectedIncident && (
              <div className="absolute bottom-4 left-4 right-4 sm:right-auto sm:w-96 bg-white rounded-[24px] border border-neutral-200 shadow-xl p-5 z-20 animate-in fade-in slide-in-from-bottom-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-sans text-xs font-semibold text-neutral-900 bg-neutral-100 px-2 py-0.5 rounded-full border border-neutral-200">
                      {activeSelectedIncident.code}
                    </span>
                    <span className="text-xs font-semibold text-neutral-900 uppercase">
                      {activeSelectedIncident.hazard_type}
                    </span>
                  </div>

                  <button
                    onClick={() => setSelectedIncidentId(null)}
                    className="text-neutral-400 hover:text-neutral-600 p-1 rounded-full hover:bg-neutral-100 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <p className="text-xs text-neutral-600 mt-2 line-clamp-2">
                  {activeSelectedIncident.description}
                </p>

                <div className="mt-3 pt-2.5 border-t border-neutral-100 grid grid-cols-2 gap-2 text-[11px] text-neutral-500">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-neutral-700 shrink-0" />
                    <span className="truncate">{getBarangayName(activeSelectedIncident.barangay_id)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-neutral-700 shrink-0" />
                    <span>{activeSelectedIncident.corroboration_count} corroborations</span>
                  </div>
                </div>

                {activeSelectedIncident.assigned_units > 0 && (
                  <div className="mt-2 bg-neutral-50 p-2 rounded-xl border border-neutral-200 flex items-center gap-2 text-xs text-neutral-800 font-medium">
                    <Truck className="w-4 h-4 text-neutral-700 shrink-0" />
                    <span className="truncate">Units: {activeSelectedIncident.assigned_units} deployed</span>
                  </div>
                )}

                <div className="mt-3 flex items-center gap-2">
                  {onNavigateTab && (
                    <button
                      onClick={() => onNavigateTab('incidents')}
                      className="flex-1 py-2 px-3 bg-[#18181b] hover:bg-[#27272a] text-white text-xs font-medium rounded-full transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Command Triage</span>
                    </button>
                  )}
                  {onSelectReport && (
                    <button
                      onClick={() => onSelectReport(activeSelectedIncident)}
                      className="py-2 px-4 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-medium rounded-full border border-neutral-200 transition-colors cursor-pointer"
                    >
                      View
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Recent Incidents Panel (Matching clean white card from image.png) */}
        <div className="lg:col-span-4 bg-white text-neutral-900 rounded-[26px] border border-neutral-100 shadow-[0_2px_12px_rgba(0,0,0,0.03)] overflow-hidden flex flex-col min-w-0 w-full h-auto min-h-[400px] sm:min-h-[460px] lg:h-[585px]">
          {/* Panel Header */}
          <div className="px-6 py-5 border-b border-neutral-100 flex items-center justify-between bg-white">
            <div>
              <h2 className="text-base font-semibold text-neutral-900">
                Recent Incidents
              </h2>
              <p className="text-xs text-neutral-400 font-normal mt-0.5">
                Newest first, all barangays
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold text-neutral-900 font-sans tracking-tight">
                {sortedReports.length}
              </span>
              {/* View All Button from Initial Draft Screenshot */}
              {onNavigateTab && (
                <button
                  onClick={() => onNavigateTab('incidents')}
                  className="text-xs font-medium text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 px-3.5 py-1.5 rounded-full transition-colors cursor-pointer"
                >
                  View All
                </button>
              )}
            </div>
          </div>

          {/* Incident List */}
          <div className="flex-1 overflow-y-auto divide-y divide-neutral-100 p-3.5 space-y-2">
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
                      ? 'bg-neutral-100 border-neutral-300 text-neutral-900 shadow-2xs'
                      : 'bg-white hover:bg-neutral-50/90 border-neutral-100 hover:border-neutral-200 text-neutral-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-6 h-6 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-700 shrink-0">
                        {isEmergency ? (
                          <AlertTriangle className="w-3.5 h-3.5 text-neutral-900" />
                        ) : (
                          <Shield className="w-3.5 h-3.5 text-neutral-600" />
                        )}
                      </div>

                      <h3 className="text-xs font-semibold text-neutral-900 uppercase tracking-tight truncate">
                        {report.hazard_type}
                      </h3>
                    </div>

                    <span className="font-sans text-[10px] font-medium text-neutral-600 bg-neutral-100 border border-neutral-200/60 px-2 py-0.5 rounded-full shrink-0">
                      {report.code}
                    </span>
                  </div>

                  <div className="mt-1.5 flex items-center justify-between text-xs text-neutral-500">
                    <div className="flex items-center gap-1 min-w-0">
                      <MapPin className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                      <span className="font-normal truncate">
                        {getBarangayName(report.barangay_id)}
                      </span>
                    </div>
                    <span className="text-[11px] text-neutral-400 shrink-0">{formatRelativeTime(report.created_at)}</span>
                  </div>

                  {/* Progressive Disclosure: Details revealed on hover or click */}
                  <div className={`overflow-hidden transition-all duration-200 ${
                    isSelected
                      ? 'max-h-36 mt-2 pt-2 border-t border-neutral-200 opacity-100'
                      : 'max-h-0 group-hover:max-h-36 group-hover:mt-2 group-hover:pt-2 group-hover:border-t group-hover:border-neutral-100 opacity-0 group-hover:opacity-100'
                  }`}>
                    {report.description && (
                      <p className="text-[11px] text-neutral-600 line-clamp-2 leading-relaxed">
                        {report.description}
                      </p>
                    )}
                    <div className="mt-1.5 flex items-center justify-between text-[10px] text-neutral-400">
                      <span className="inline-flex items-center gap-1 font-mono">
                        <span className="w-1.5 h-1.5 rounded-full bg-neutral-400" />
                        {report.corroboration_count} corroborations
                      </span>
                      <span className="text-neutral-600 font-medium">Click to inspect map</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 4. Bottom Section: Structured Analytic Overviews */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 sm:gap-6 items-stretch w-full">
        {/* Card 1: Incidents by Hazard Type (Style Transfer: Progress Card) */}
        <div className="bg-white rounded-[26px] border border-neutral-100 shadow-[0_2px_12px_rgba(0,0,0,0.03)] p-6 flex flex-col justify-between min-w-0 w-full relative group">
          <div>
            <div className="flex items-center justify-between pb-3.5 border-b border-neutral-100">
              <div>
                <h2 className="text-base font-semibold text-neutral-900 tracking-tight">
                  Incidents by Hazard Type
                </h2>
                <p className="text-[11px] text-neutral-400 font-normal">Municipal distribution</p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-sans text-[10px] font-medium text-neutral-600 bg-neutral-100 border border-neutral-200/60 px-2.5 py-0.5 rounded-full">
                  {reports.length} ON RECORD
                </span>
                <span className="w-6 h-6 rounded-full border border-neutral-200 text-neutral-400 flex items-center justify-center text-[11px]">
                  ↗
                </span>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {hazardDistribution.map((item, index) => (
                <div key={item.type} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-neutral-700 tracking-normal">
                      {item.type}
                    </span>
                    <span className="font-sans font-semibold text-neutral-900">{item.count}</span>
                  </div>
                  {/* Segmented/Modern Progress Bar matching reference image */}
                  <div className="h-2.5 w-full bg-neutral-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        index === 0
                          ? 'bg-[#18181b]'
                          : index === 1
                          ? 'bg-[#767b87]'
                          : 'bg-neutral-300'
                      }`}
                      style={{ width: `${Math.max(8, item.percentage)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[11px] text-neutral-400 mt-5 pt-3.5 border-t border-neutral-100 font-normal">
            Automated aggregation across all municipal hazard channels.
          </p>
        </div>

        {/* Card 2: Active Advisories */}
        <div className="bg-white rounded-[26px] border border-neutral-100 shadow-[0_2px_12px_rgba(0,0,0,0.03)] p-6 flex flex-col justify-between min-w-0 w-full relative group">
          <div>
            <div className="flex items-center justify-between pb-3.5 border-b border-neutral-100">
              <div>
                <h2 className="text-base font-semibold text-neutral-900 tracking-tight">
                  Active Advisories
                </h2>
                <p className="text-[11px] text-neutral-400 font-normal">Public warnings</p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-sans text-[10px] font-medium text-neutral-600 bg-neutral-100 border border-neutral-200/60 px-2.5 py-0.5 rounded-full">
                  {advisories.filter((a) => a.severity !== 'low').length} live
                </span>
                <span className="w-6 h-6 rounded-full border border-neutral-200 text-neutral-400 flex items-center justify-center text-[11px]">
                  ↗
                </span>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {advisories.slice(0, 3).map((advisory) => {
                const isEmergency =
                  advisory.severity === 'critical' || advisory.severity === 'high';
                return (
                  <div
                    key={advisory.id}
                    onClick={() => {
                      if (onNavigateTab) onNavigateTab('advisories');
                    }}
                    className="p-3.5 rounded-2xl border border-neutral-100 hover:border-neutral-200 bg-neutral-50/50 hover:bg-neutral-100/60 transition-all cursor-pointer space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h4 className="text-xs font-semibold text-neutral-900 truncate">
                          {advisory.title}
                        </h4>
                      </div>

                      <span
                        className={`text-[9px] font-medium uppercase px-2.5 py-0.5 rounded-full shrink-0 ${
                          isEmergency
                            ? 'bg-[#18181b] text-white'
                            : 'bg-neutral-200 text-neutral-700'
                        }`}
                      >
                        {isEmergency ? 'EMERGENCY' : 'WARNING'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 font-normal">
                      <MapPin className="w-3 h-3 text-neutral-400 shrink-0" />
                      <span className="truncate">
                        {advisory.target_barangay_id
                          ? getBarangayName(advisory.target_barangay_id)
                          : 'Municipality of Lingayen & Coastal Sectors'}
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
              className="mt-5 pt-3.5 border-t border-neutral-100 text-xs font-medium text-neutral-600 hover:text-neutral-950 flex items-center justify-between w-full cursor-pointer"
            >
              <span>View all emergency bulletins</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Card 3: Readiness (Style Transfer: Time Tracker style) */}
        <div className="bg-white rounded-[26px] border border-neutral-100 shadow-[0_2px_12px_rgba(0,0,0,0.03)] p-6 flex flex-col justify-between min-w-0 w-full relative group">
          <div>
            <div className="flex items-center justify-between pb-3.5 border-b border-neutral-100">
              <div>
                <h2 className="text-base font-semibold text-neutral-900 tracking-tight">
                  Readiness
                </h2>
                <p className="text-[11px] text-neutral-400 font-normal">Operational status</p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-sans text-[10px] font-medium text-neutral-700 bg-neutral-100 border border-neutral-200/60 px-2.5 py-0.5 rounded-full">
                  Operational
                </span>
                <span className="w-6 h-6 rounded-full border border-neutral-200 text-neutral-400 flex items-center justify-center text-[11px]">
                  ↗
                </span>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {/* Metric 1: Shelters Open */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-600 font-normal">Shelters open</span>
                  <span className="font-sans font-semibold text-neutral-900">
                    {openSheltersCount} / {evacuationCenters.length} ({shelterCapacityRate}% full)
                  </span>
                </div>
                <div className="h-2.5 w-full bg-neutral-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#18181b] rounded-full"
                    style={{
                      width: `${Math.round(
                        (openSheltersCount / Math.max(1, evacuationCenters.length)) * 100
                      )}%`,
                    }}
                  />
                </div>
              </div>

              {/* Metric 2: Units Assigned */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-600 font-normal">Units assigned</span>
                  <span className="font-sans font-semibold text-neutral-900">
                    {unitsDeployed} active {unitsDeployed === 1 ? 'crew' : 'crews'}
                  </span>
                </div>
                <div className="h-2.5 w-full bg-neutral-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#767b87] rounded-full"
                    style={{ width: `${Math.min(100, Math.max(15, unitsDeployed * 35))}%` }}
                  />
                </div>
              </div>

              {/* Metric 3: Corroboration Rate */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-600 font-normal">Corroboration rate</span>
                  <span className="font-sans font-semibold text-neutral-900">
                    {corroborationRate}% verified
                  </span>
                </div>
                <div className="h-2.5 w-full bg-neutral-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-neutral-400 rounded-full"
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
          className="bg-white rounded-[22px] p-5 border border-neutral-200/70 shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:border-neutral-300 hover:shadow-xs transition-all cursor-pointer group flex flex-col justify-between"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="w-10 h-10 rounded-2xl bg-neutral-100 text-neutral-800 flex items-center justify-center border border-neutral-200/60 shadow-2xs group-hover:bg-[#18181b] group-hover:text-white transition-colors shrink-0">
              <Package className="w-5 h-5" />
            </div>
            <span className="w-6 h-6 rounded-full border border-neutral-200 text-neutral-400 group-hover:text-neutral-700 flex items-center justify-center text-[11px] transition-colors">
              ↗
            </span>
          </div>
          <div className="mt-4 space-y-0.5">
            <h3 className="text-sm font-semibold text-neutral-900 tracking-tight group-hover:text-black">
              Relief Distributions
            </h3>
            <p className="text-xs text-neutral-500 font-normal">
              {reliefActiveCount} active
            </p>
          </div>
        </div>

        {/* Module 2: Road Work Posts */}
        <div
          onClick={() => onNavigateTab && onNavigateTab('road_work')}
          className="bg-white rounded-[22px] p-5 border border-neutral-200/70 shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:border-neutral-300 hover:shadow-xs transition-all cursor-pointer group flex flex-col justify-between"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="w-10 h-10 rounded-2xl bg-neutral-100 text-neutral-800 flex items-center justify-center border border-neutral-200/60 shadow-2xs group-hover:bg-[#18181b] group-hover:text-white transition-colors shrink-0">
              <Construction className="w-5 h-5" />
            </div>
            <span className="w-6 h-6 rounded-full border border-neutral-200 text-neutral-400 group-hover:text-neutral-700 flex items-center justify-center text-[11px] transition-colors">
              ↗
            </span>
          </div>
          <div className="mt-4 space-y-0.5">
            <h3 className="text-sm font-semibold text-neutral-900 tracking-tight group-hover:text-black">
              Road Work Posts
            </h3>
            <p className="text-xs text-neutral-500 font-normal">
              {roadWorkActiveCount} active
            </p>
          </div>
        </div>

        {/* Module 3: Preparedness Guides */}
        <div
          onClick={() => onNavigateTab && onNavigateTab('guides')}
          className="bg-white rounded-[22px] p-5 border border-neutral-200/70 shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:border-neutral-300 hover:shadow-xs transition-all cursor-pointer group flex flex-col justify-between"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="w-10 h-10 rounded-2xl bg-neutral-100 text-neutral-800 flex items-center justify-center border border-neutral-200/60 shadow-2xs group-hover:bg-[#18181b] group-hover:text-white transition-colors shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <span className="w-6 h-6 rounded-full border border-neutral-200 text-neutral-400 group-hover:text-neutral-700 flex items-center justify-center text-[11px] transition-colors">
              ↗
            </span>
          </div>
          <div className="mt-4 space-y-0.5">
            <h3 className="text-sm font-semibold text-neutral-900 tracking-tight group-hover:text-black">
              Preparedness Guides
            </h3>
            <p className="text-xs text-neutral-500 font-normal">
              {guidesPublishedCount} published
            </p>
          </div>
        </div>

        {/* Module 4: FAQ Entries */}
        <div
          onClick={() => onNavigateTab && onNavigateTab('faqs')}
          className="bg-white rounded-[22px] p-5 border border-neutral-200/70 shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:border-neutral-300 hover:shadow-xs transition-all cursor-pointer group flex flex-col justify-between"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="w-10 h-10 rounded-2xl bg-neutral-100 text-neutral-800 flex items-center justify-center border border-neutral-200/60 shadow-2xs group-hover:bg-[#18181b] group-hover:text-white transition-colors shrink-0">
              <HelpCircle className="w-5 h-5" />
            </div>
            <span className="w-6 h-6 rounded-full border border-neutral-200 text-neutral-400 group-hover:text-neutral-700 flex items-center justify-center text-[11px] transition-colors">
              ↗
            </span>
          </div>
          <div className="mt-4 space-y-0.5">
            <h3 className="text-sm font-semibold text-neutral-900 tracking-tight group-hover:text-black">
              FAQ Entries
            </h3>
            <p className="text-xs text-neutral-500 font-normal">
              {faqsPublishedCount} published
            </p>
          </div>
        </div>
      </div>

      {/* 5. Declare Emergency Modal (Triggered by Declare Emergency button) */}
      {isDeclareEmergencyModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-[28px] max-w-lg w-full border border-neutral-200 shadow-2xl p-7 space-y-5 animate-in zoom-in-95">
            <div className="flex items-start justify-between gap-3 pb-3.5 border-b border-neutral-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-[#18181b] text-white flex items-center justify-center shadow-xs">
                  <Megaphone className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-neutral-900">
                    Declare Emergency Directive
                  </h3>
                  <p className="text-xs text-neutral-400 font-normal">
                    LDRRMC Lingayen Municipal Incident Command
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsDeclareEmergencyModalOpen(false)}
                className="p-1.5 text-neutral-400 hover:text-neutral-600 rounded-full hover:bg-neutral-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {broadcastSuccessNotice ? (
              <div className="p-6 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-neutral-100 text-neutral-900 flex items-center justify-center mx-auto border border-neutral-200">
                  <BellRing className="w-6 h-6 animate-bounce" />
                </div>
                <h4 className="text-sm font-semibold text-neutral-900">
                  {broadcastSuccessNotice}
                </h4>
                <p className="text-xs text-neutral-500">
                  Advisory banner active and pushed to all resident device inboxes.
                </p>
              </div>
            ) : (
              <form onSubmit={handleDeclareEmergencySubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1.5">
                    Directive / Warning Title
                  </label>
                  <input
                    type="text"
                    value={emergencyTitle}
                    onChange={(e) => setEmergencyTitle(e.target.value)}
                    required
                    placeholder="e.g. Signal No. 2 Tropical Storm Warning"
                    className="w-full px-4 py-2.5 text-xs font-medium text-neutral-900 border border-neutral-200 rounded-2xl focus:outline-hidden focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1.5">
                      Alert Severity
                    </label>
                    <select
                      value={emergencySeverity}
                      onChange={(e) => setEmergencySeverity(e.target.value as 'critical' | 'high')}
                      className="w-full px-3.5 py-2.5 text-xs font-medium text-neutral-900 border border-neutral-200 rounded-2xl focus:outline-hidden focus:border-neutral-900"
                    >
                      <option value="critical">CRITICAL (Red Alert)</option>
                      <option value="high">HIGH (Severe Warning)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1.5">
                      Jurisdiction Scope
                    </label>
                    <select
                      value={emergencyScope}
                      onChange={(e) => setEmergencyScope(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-xs font-medium text-neutral-900 border border-neutral-200 rounded-2xl focus:outline-hidden focus:border-neutral-900"
                    >
                      <option value="Municipality-wide (Lingayen)">Municipality-wide</option>
                      {barangays.map((b) => (
                        <option key={b.id} value={b.name}>
                          Brgy. {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-700 mb-1.5">
                    Emergency Directives & Public Instructions
                  </label>
                  <textarea
                    rows={3}
                    value={emergencyMessage}
                    onChange={(e) => setEmergencyMessage(e.target.value)}
                    required
                    placeholder="Specify evacuation routes, staging shelters, and emergency numbers..."
                    className="w-full px-4 py-2.5 text-xs font-normal text-neutral-900 border border-neutral-200 rounded-2xl focus:outline-hidden focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
                  />
                </div>

                <div className="pt-2 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setIsDeclareEmergencyModalOpen(false)}
                    className="px-5 py-2.5 rounded-full text-xs font-medium text-neutral-700 hover:bg-neutral-100 border border-neutral-200 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isBroadcasting}
                    className="px-6 py-2.5 rounded-full text-xs font-medium text-white bg-[#18181b] hover:bg-[#27272a] transition-all shadow-xs cursor-pointer disabled:opacity-50 flex items-center gap-2"
                  >
                    {isBroadcasting ? (
                      <BrandLoader
                        mode="inline"
                        portal={portalForRole(currentUser.role)}
                        process="publish"
                        variant="reverse"
                        context={{ count: barangays.length }}
                      />
                    ) : (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5 text-white" />
                        <span>Broadcast Emergency Directive</span>
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
