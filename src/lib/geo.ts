// Place data for Lingayen, Pangasinan, and the coordinate checks used before a
// location is drawn or handed to a navigation app.
export const PLACE = {
  town: 'Lingayen',
  province: 'Pangasinan',
  label: 'Lingayen, Pangasinan',
  areaAll: 'Municipality-wide',
};

export const CENTER: [number, number] = [16.0206, 120.2306];

// A service-area box drawn a little wider than the town. It catches wrong-city
// and swapped latitude/longitude values; it is not an official boundary.
export const BOUNDS = { minLat: 15.95, maxLat: 16.085, minLng: 120.17, maxLng: 120.29 };

export const BARANGAY_NAMES = [
  'Aliwekwek', 'Baay', 'Balangobong', 'Balococ', 'Bantayan', 'Basing', 'Capandanan',
  'Domalandan Center', 'Domalandan East', 'Domalandan West', 'Dorongan', 'Dulag',
  'Estanza', 'Lasip', 'Libsong East', 'Libsong West', 'Malawa', 'Malimpuec', 'Maniboc',
  'Matalava', 'Naguelguel', 'Namolan', 'Pangapisan North', 'Pangapisan Sur', 'Poblacion',
  'Quibaol', 'Rosario', 'Sabangan', 'Talogtog', 'Tonton', 'Tumbar', 'Wawa',
];

export const barangaySlug = (name: string) =>
  String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const isNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v);
export const toNum = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return NaN;
  return typeof v === 'number' ? v : parseFloat(String(v));
};

export type CoordState = 'missing' | 'invalid' | 'swapped' | 'outside' | 'ok';

export function classifyCoords(latIn: unknown, lngIn: unknown): CoordState {
  const lat = toNum(latIn);
  const lng = toNum(lngIn);
  if (isNaN(lat) && isNaN(lng)) return 'missing';
  if (!isNum(lat) || !isNum(lng)) return 'invalid';
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) return 'swapped';
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return 'invalid';
  if (lat === 0 && lng === 0) return 'invalid';
  // latitude 16 / longitude 120 written the wrong way round
  if (lat >= BOUNDS.minLng && lat <= BOUNDS.maxLng && lng >= BOUNDS.minLat && lng <= BOUNDS.maxLat) return 'swapped';
  if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lng < BOUNDS.minLng || lng > BOUNDS.maxLng) return 'outside';
  return 'ok';
}

const MESSAGES: Record<CoordState, string> = {
  missing: 'No location has been recorded for this place yet.',
  invalid: 'The stored coordinates are not valid.',
  swapped: 'Latitude and longitude look swapped.',
  outside: 'The stored coordinates are outside Lingayen.',
  ok: '',
};
export const coordMessage = (state: CoordState) => MESSAGES[state] || '';

// Only a clean, in-town point is safe to hand to a navigation app.
export const canNavigate = (lat: unknown, lng: unknown) => classifyCoords(lat, lng) === 'ok';

export const hasCoords = (lat: unknown, lng: unknown) => isNum(lat) && isNum(lng);

export const fmtCoords = (lat: unknown, lng: unknown) =>
  isNum(lat) && isNum(lng) ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : '';

// Waze universal link: opens the app if installed, otherwise Waze's web page.
export const wazeUrl = (lat: number, lng: number) =>
  `https://waze.com/ul?ll=${encodeURIComponent(lat)},${encodeURIComponent(lng)}&navigate=yes`;

export function locate(): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return reject(new Error('This device does not support automatic location.'));
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: +p.coords.latitude.toFixed(6),
          lng: +p.coords.longitude.toFixed(6),
          accuracy: Math.round(p.coords.accuracy),
        }),
      (err) => {
        const map: Record<number, string> = {
          1: 'Location permission was denied.',
          2: 'Your position is unavailable right now.',
          3: 'Location timed out. Try again.',
        };
        reject(new Error(map[err.code] || 'Could not read your location.'));
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  });
}

// Haversine distance in metres between two lat/lng points.
export function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
