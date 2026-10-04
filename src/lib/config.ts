// Deploy-time settings, read from Vite env (.env.local). The anon key is safe to
// expose: row level security is what protects the data.
const env = import.meta.env;

export const CONFIG = {
  SUPABASE_URL: (env.VITE_SUPABASE_URL as string) || '',
  SUPABASE_ANON_KEY: (env.VITE_SUPABASE_ANON_KEY as string) || '',
  APP_PUBLIC_URL:
    (env.VITE_APP_PUBLIC_URL as string) || (typeof location !== 'undefined' ? location.origin : ''),

  // Web Push public key. Safe to expose, the private half never leaves the server.
  VAPID_PUBLIC_KEY: (env.VITE_VAPID_PUBLIC_KEY as string) || '',

  // Shown in the app so you can tell which build a device is running
  BUILD: (env.VITE_BUILD as string) || 'dev',

  // photo handling
  MAX_PHOTO_BYTES: 5 * 1024 * 1024,
  PHOTO_MAX_EDGE: 1600,
  PHOTO_QUALITY: 0.82,

  // business rules mirrored from the database
  CORROBORATION_WINDOW_HOURS: 6,
  CORROBORATION_THRESHOLD: 3,

  // how often the offline queue retries while the app is open
  SYNC_RETRY_MS: 20000,
};
