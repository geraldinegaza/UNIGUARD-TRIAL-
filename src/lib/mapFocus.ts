// "Show on map" from any staff screen: the dashboard map flies to the place
// and marks it with a pulsing pin and its label for a few seconds.
import L from 'leaflet';

export interface MapFocus {
  lat: number;
  lng: number;
  label: string;
  reportId?: string;
  /** changes on every request, so the same place can be shown twice */
  key: number;
}

export function showFocus(map: L.Map, focus: MapFocus, container?: HTMLElement | null): () => void {
  const icon = L.divIcon({
    className: 'bg-transparent',
    html:
      '<div style="position:relative;width:26px;height:26px">' +
      '<span style="position:absolute;inset:0;border-radius:9999px;background:rgba(220,38,38,.35);animation:ping 1.4s cubic-bezier(0,0,.2,1) infinite"></span>' +
      '<span style="position:absolute;inset:5px;border-radius:9999px;background:#b91c1c;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4)"></span></div>',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
  const marker = L.marker([focus.lat, focus.lng], { icon, zIndexOffset: 1000, keyboard: false })
    .addTo(map)
    .bindTooltip(focus.label, { permanent: true, direction: 'top', offset: [0, -14] });
  map.invalidateSize();
  map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 17), { duration: 0.8 });
  if (container) container.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const timer = window.setTimeout(() => marker.remove(), 12000);
  return () => {
    window.clearTimeout(timer);
    marker.remove();
  };
}
