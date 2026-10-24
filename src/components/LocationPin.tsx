import { t } from '../lib/i18n';
import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { BOUNDS, CENTER } from '../lib/geo';

// A small map with one draggable pin. Used when filing a report: the server
// requires a location inside Lingayen, so a resident whose GPS fails (or who is
// reporting a hazard somewhere else in town) drags the pin, or taps the map,
// to where the hazard is. A pin dropped outside Lingayen snaps back.

interface LocationPinProps {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
  /** shown when a pin outside the municipality is put back */
  onOutside?: () => void;
  className?: string;
}

const inside = (lat: number, lng: number) =>
  lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat && lng >= BOUNDS.minLng && lng <= BOUNDS.maxLng;

const pinIcon = L.divIcon({
  className: 'bg-transparent',
  html:
    '<span style="position:relative;display:block;width:30px;height:30px">' +
    '<span class="ug-pin-pulse" style="position:absolute;inset:0;border-radius:999px;background:rgba(153,27,27,.25)"></span>' +
    '<span style="position:absolute;left:7px;top:7px;width:16px;height:16px;border-radius:999px;background:#991B1B;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></span>' +
    '</span>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

export const LocationPin: React.FC<LocationPinProps> = ({ lat, lng, onChange, onOutside, className = '' }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const latest = useRef({ onChange, onOutside });
  latest.current = { onChange, onOutside };

  useEffect(() => {
    if (!boxRef.current || mapRef.current) return;
    const start: [number, number] = lat !== null && lng !== null && inside(lat, lng) ? [lat, lng] : CENTER;
    const map = L.map(boxRef.current, {
      center: start,
      zoom: 15,
      zoomControl: false,
      attributionControl: false,
      maxBounds: L.latLngBounds([BOUNDS.minLat - 0.02, BOUNDS.minLng - 0.02], [BOUNDS.maxLat + 0.02, BOUNDS.maxLng + 0.02]),
    });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18,
      minZoom: 12,
    }).addTo(map);

    const marker = L.marker(start, { icon: pinIcon, draggable: true, title: 'Drag me', keyboard: true }).addTo(map);
    const place = (p: L.LatLng, previous: L.LatLng) => {
      if (!inside(p.lat, p.lng)) {
        marker.setLatLng(previous);
        latest.current.onOutside?.();
        return;
      }
      marker.setLatLng(p);
      latest.current.onChange(Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6)));
    };
    let before = marker.getLatLng();
    marker.on('dragstart', () => (before = marker.getLatLng()));
    marker.on('dragend', () => place(marker.getLatLng(), before));
    map.on('click', (e: L.LeafletMouseEvent) => place(e.latlng, marker.getLatLng()));

    mapRef.current = map;
    markerRef.current = marker;
    const t = setTimeout(() => map.invalidateSize(), 250);
    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // the map is created once; later coordinates arrive through the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // follow coordinates set from outside (a GPS fix)
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker || lat === null || lng === null || !inside(lat, lng)) return;
    const here = marker.getLatLng();
    if (Math.abs(here.lat - lat) < 1e-7 && Math.abs(here.lng - lng) < 1e-7) return;
    marker.setLatLng([lat, lng]);
    map.setView([lat, lng], Math.max(map.getZoom(), 16));
  }, [lat, lng]);

  return (
    <div
      ref={boxRef}
      data-no-swipe
      role="application"
      aria-label={t("Map: drag the pin or tap where the hazard is")}
      className={`relative z-0 w-full h-44 rounded-2xl overflow-hidden border border-neutral-200 ${className}`}
    />
  );
};
