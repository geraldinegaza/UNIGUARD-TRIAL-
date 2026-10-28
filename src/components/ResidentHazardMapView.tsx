import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { Plus, Minus, LocateFixed, Info } from 'lucide-react';

import { User } from '../types';
import { useRepo } from '../hooks/useRepo';
import { CENTER } from '../lib/geo';
import { t } from '../lib/i18n';
import { relTime } from '../lib/util';
import { ItemFocus } from '../hooks/useFocusItem';

// Resident Hazard Map (reference build): open hazard reports, relief
// distribution points, evacuation shelters and road status on one map, each a
// layer the resident can switch off to focus on one. Markers use the same
// badge style as the operations map; tapping one opens its details.

type LayerKey = 'hazards' | 'relief' | 'shelters' | 'roads';

const LAYERS: { key: LayerKey; label: string; color: string }[] = [
  { key: 'hazards', label: 'Hazards', color: '#B91C1C' },
  { key: 'relief', label: 'Relief', color: '#7C3AED' },
  { key: 'shelters', label: 'Shelters', color: '#15803D' },
  { key: 'roads', label: 'Road status', color: '#D97706' },
];

const esc = (s: string) => String(s || '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const badge = (text: string, bg: string) =>
  `<div style="background-color:${bg};color:#fff;font-size:10px;font-weight:800;font-family:ui-sans-serif,system-ui,sans-serif;padding:2.5px 7px;border-radius:6px;border:1.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);text-align:center;letter-spacing:.5px;cursor:pointer;white-space:nowrap">${text}</div>`;
const icon = (text: string, bg: string) => L.divIcon({ className: 'bg-transparent', html: badge(text, bg), iconSize: undefined, iconAnchor: [18, 10] });
// `open` adds a "View details" link to the page that item lives on ("shelters|<id>")
const popup = (title: string, lines: string[], open?: string) =>
  `<div style="font-family:ui-sans-serif,system-ui,sans-serif;min-width:160px"><div style="font-weight:800;font-size:13px;color:#171717">${esc(title)}</div>${lines
    .filter(Boolean)
    .map((l) => `<div style="font-size:11.5px;color:#525252;margin-top:3px">${esc(l)}</div>`)
    .join('')}${
    open
      ? `<button type="button" data-open="${esc(open)}" style="margin-top:8px;padding:5px 10px;border-radius:8px;background:#991B1B;color:#fff;font-size:11.5px;font-weight:700;border:0;cursor:pointer">${esc(t('View details'))}</button>`
      : ''
  }</div>`;

const SEVERITY: Record<string, { text: string; color: string }> = {
  emergency: { text: 'HIGH', color: '#B91C1C' },
  warning: { text: 'MED', color: '#EA580C' },
  advisory: { text: 'LOW', color: '#CA8A04' },
};

// a focus id is "<kind>:<id>": report, shelter or relief
const LAYER_OF: Record<string, LayerKey> = { report: 'hazards', shelter: 'shelters', relief: 'relief' };

export const ResidentHazardMapView: React.FC<{
  currentUser: User;
  /** opened on one item, e.g. "report:<id>" from Home or a report's "Show on map" */
  focus?: ItemFocus;
  /** a popup's "View details" */
  onOpenItem?: (tab: string, id?: string | null) => void;
}> = ({ currentUser, focus, onOpenItem }) => {
  const data = useRepo();
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ hazards: true, relief: true, shelters: true, roads: true });
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const groupRef = useRef<L.LayerGroup | null>(null);
  const meRef = useRef<L.Marker | null>(null);
  // every marker on the map by "<kind>:<id>", so a focus can find its marker
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const openRef = useRef(onOpenItem);
  openRef.current = onOpenItem;

  const hazards = useMemo(
    () => data.reports.filter((r) => r.has_location && r.status !== 'resolved' && r.status !== 'rejected'),
    [data.reports]
  );
  const relief = useMemo(() => data.relief.filter((r) => r.active && r.lat !== null && r.lng !== null), [data.relief]);
  const shelters = useMemo(() => data.centers.filter((c) => c.has_location), [data.centers]);
  const roads = useMemo(() => data.roadStatus.filter((r) => r.lat !== null && r.lng !== null && r.status !== 'passable'), [data.roadStatus]);
  const counts: Record<LayerKey, number> = { hazards: hazards.length, relief: relief.length, shelters: shelters.length, roads: roads.length };

  // start on the resident's own barangay when it has a shelter or a report on the map
  const start = useMemo<[number, number]>(() => {
    const s = shelters.find((c) => c.barangay_id === currentUser.barangay_id);
    if (s) return [s.latitude, s.longitude];
    const r = hazards.find((x) => x.barangay_id === currentUser.barangay_id);
    if (r) return [r.latitude, r.longitude];
    return CENTER;
  }, []);

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, { center: start, zoom: 14, zoomControl: false, attributionControl: true });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Leaflet | Tiles &copy; Esri &mdash; Source: Esri, HERE, Garmin, FAO, NOAA, USGS, &copy; OpenStreetMap contributors, and the GIS User Community',
      maxZoom: 18,
      minZoom: 11,
    }).addTo(map);
    groupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // a popup's "View details" opens the page the item lives on
    map.on('popupopen', (e: L.PopupEvent) => {
      const btn = e.popup.getElement()?.querySelector<HTMLButtonElement>('button[data-open]');
      if (!btn) return;
      btn.onclick = () => {
        const [tab, id] = (btn.dataset.open || '').split('|');
        openRef.current?.(tab, id || null);
      };
    });
    const timer = setTimeout(() => map.invalidateSize(), 300);
    return () => {
      clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      groupRef.current = null;
      meRef.current = null;
    };
  }, []);

  // the markers follow the data and the layer switches
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.clearLayers();
    markersRef.current.clear();
    const add = (key: string, m: L.Marker) => {
      markersRef.current.set(key, m);
      m.addTo(group);
    };
    if (layers.roads) {
      roads.forEach((r) => {
        const blocked = r.status === 'blocked';
        L.marker([r.lat as number, r.lng as number], { icon: icon(blocked ? '✕ ROAD' : '! ROAD', blocked ? '#DC2626' : '#D97706') })
          .bindPopup(
            popup(r.road_name || 'Road', [
              blocked ? 'Blocked' : r.status === 'one_lane' ? 'One lane open' : 'Under repair: use caution',
              r.barangay ? `Barangay ${r.barangay}` : '',
              r.note,
              r.updated_at ? `Updated ${relTime(r.updated_at)}` : '',
            ])
          )
          .addTo(group);
      });
    }
    if (layers.shelters) {
      shelters.forEach((c) => {
        const open = c.status === 'open';
        add(
          `shelter:${c.id}`,
          L.marker([c.latitude, c.longitude], { icon: icon('EVAC', open ? '#15803D' : c.status === 'full' ? '#B45309' : '#737373') }).bindPopup(
            popup(
              c.name,
              [
                `${c.status === 'open' ? 'Open' : c.status === 'full' ? 'Full' : 'Closed'} · ${c.current_occupancy} / ${c.capacity}`,
                c.barangay_name ? `Barangay ${c.barangay_name}` : '',
                c.address || '',
              ],
              `shelters|${c.id}`
            )
          )
        );
      });
    }
    if (layers.relief) {
      relief.forEach((r) => {
        add(
          `relief:${r.id}`,
          L.marker([r.lat as number, r.lng as number], { icon: icon('REL', '#7C3AED') }).bindPopup(
            popup(
              r.title || 'Relief distribution',
              [
                r.location_name,
                r.distribution_at ? new Date(r.distribution_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
                r.barangay ? `Barangay ${r.barangay}` : 'Municipality-wide',
              ],
              `relief|${r.id}`
            )
          )
        );
      });
    }
    if (layers.hazards) {
      hazards.forEach((r) => {
        const sev = SEVERITY[r.severity] || SEVERITY.advisory;
        add(
          `report:${r.id}`,
          L.marker([r.latitude, r.longitude], { icon: icon(sev.text, sev.color), zIndexOffset: 500 }).bindPopup(
            popup(
              r.hazard_type,
              [
                `${r.code} · ${r.status === 'unverified' ? 'reported' : r.status}`,
                r.barangay_name ? `Barangay ${r.barangay_name}` : '',
                `Reported ${relTime(r.created_at)}`,
              ],
              // only your own reports have a page to open
              r.is_mine ? `my_reports|${r.id}` : undefined
            )
          )
        );
      });
    }
  }, [layers, hazards, relief, shelters, roads]);

  // opened on one item: switch its layer on, fly to it and open its popup
  const focusedKey = useRef<number | null>(null);
  useEffect(() => {
    if (!focus || focusedKey.current === focus.key) return;
    const kind = focus.id.split(':')[0];
    const layer = LAYER_OF[kind];
    if (layer && !layers[layer]) {
      setLayers((s) => ({ ...s, [layer]: true })); // runs again once the markers are back
      return;
    }
    const map = mapRef.current;
    const marker = markersRef.current.get(focus.id);
    if (!map) return;
    focusedKey.current = focus.key; // once; switching layers later leaves the view alone
    if (marker) {
      map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.8 });
      map.once('moveend', () => marker.openPopup());
      return;
    }
    // a report that is no longer open is not a hazard marker; show where it was
    const rep = kind === 'report' ? data.reports.find((r) => `report:${r.id}` === focus.id && r.has_location) : undefined;
    if (rep && groupRef.current) {
      const m = L.marker([rep.latitude, rep.longitude], { icon: icon(rep.status === 'resolved' ? 'DONE' : 'REP', '#525252') })
        .bindPopup(popup(rep.hazard_type, [`${rep.code} · ${rep.status}`, rep.barangay_name ? `Barangay ${rep.barangay_name}` : '']))
        .addTo(groupRef.current);
      map.flyTo(m.getLatLng(), 16, { duration: 0.8 });
      map.once('moveend', () => m.openPopup());
    } else {
      setNotice('That place has no location on the map.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key, layers]);

  const locate = () => {
    if (!('geolocation' in navigator)) {
      setNotice('This device cannot share its location.');
      return;
    }
    setLocating(true);
    setNotice(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const map = mapRef.current;
        if (!map) return;
        const at: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        meRef.current?.remove();
        meRef.current = L.marker(at, {
          icon: L.divIcon({
            className: 'bg-transparent',
            html: '<span style="display:block;width:16px;height:16px;border-radius:9999px;background:#2563EB;border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.25)"></span>',
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          }),
          zIndexOffset: 1000,
        })
          .bindTooltip(t('You are here'), { direction: 'top', offset: [0, -10], permanent: true })
          .addTo(map);
        map.flyTo(at, Math.max(map.getZoom(), 16), { duration: 0.8 });
      },
      () => {
        setLocating(false);
        setNotice('Your location is not available. Allow location access and try again.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  return (
    <div className="space-y-5 sm:space-y-6 animate-in fade-in duration-200">
      <div>
        <p className="text-xs sm:text-sm text-neutral-500">
          {t('Hazards, relief, shelters and road status around you. Switch a layer off to focus on one; tap a marker for its details.')}
        </p>
      </div>

      {/* layer switches */}
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('Map layers')}>
        {LAYERS.map((l) => (
          <button
            key={l.key}
            type="button"
            onClick={() => setLayers((s) => ({ ...s, [l.key]: !s[l.key] }))}
            aria-pressed={layers[l.key]}
            className={`h-9 px-3.5 rounded-full text-xs font-bold inline-flex items-center gap-2 border transition-colors cursor-pointer ${
              layers[l.key] ? 'bg-white text-neutral-900 border-neutral-200 shadow-sm' : 'bg-neutral-100 text-neutral-400 border-transparent'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: layers[l.key] ? l.color : '#D4D4D4' }} aria-hidden="true" />
            {t(l.label)}
            <span className={`tabular-nums ${layers[l.key] ? 'text-neutral-400' : 'text-neutral-300'}`}>{counts[l.key]}</span>
          </button>
        ))}
      </div>

      {notice && <p className="text-xs font-semibold text-red-900 bg-red-50 border border-red-900/15 rounded-2xl px-4 py-2.5">{notice}</p>}

      {/* the map */}
      <div className="relative bg-white rounded-3xl border border-neutral-100/80 overflow-hidden shadow-xl">
        <div ref={mapEl} className="h-[420px] sm:h-[520px] w-full z-0" />
        <div className="absolute right-3 top-3 z-[400] flex flex-col gap-2">
          <div className="flex flex-col rounded-2xl bg-white shadow-lg overflow-hidden border border-neutral-100">
            <button type="button" onClick={() => mapRef.current?.zoomIn()} aria-label={t('Zoom in')} className="w-10 h-10 flex items-center justify-center text-neutral-700 hover:bg-neutral-50 cursor-pointer">
              <Plus className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => mapRef.current?.zoomOut()} aria-label={t('Zoom out')} className="w-10 h-10 flex items-center justify-center text-neutral-700 hover:bg-neutral-50 border-t border-neutral-100 cursor-pointer">
              <Minus className="w-4 h-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={locate}
            disabled={locating}
            aria-label={t('Show my location')}
            className="w-10 h-10 rounded-2xl bg-red-900 hover:bg-red-800 text-white flex items-center justify-center shadow-lg cursor-pointer disabled:opacity-60"
          >
            <LocateFixed className={`w-4 h-4 ${locating ? 'animate-pulse' : ''}`} />
          </button>
        </div>
      </div>

      {/* routing note, as in the reference build */}
      <div className="flex items-start gap-3 bg-white rounded-3xl border border-neutral-100/80 p-5 shadow-sm">
        <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed">
          {t('Until full routing is available, use the road-status markers to route around a closure yourself. A red ✕ means the road is blocked; an amber ! means use caution.')}
        </p>
      </div>
    </div>
  );
};
