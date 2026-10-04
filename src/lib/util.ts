import { CONFIG } from './config';

export function relTime(value: string | number | Date | null | undefined): string {
  if (value == null) return '';
  const t = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  if (!t || isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return 'just now';
  if (s < 90) return '1m ago';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m ago` : `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}

// "Today, 08:42" / "Yesterday, 17:10" / "3 Oct, 09:00" for the last sync readouts
export function syncLabel(value: string | null | undefined): string {
  const t = value ? Date.parse(value) : NaN;
  if (!t) return 'Not synced yet';
  const d = new Date(t);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}

export function absTime(value: string | number | null | undefined): string {
  const t = typeof value === 'string' ? Date.parse(value) : value;
  if (!t || isNaN(t)) return '';
  return new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// CSV export used by the console analytics and the admin tables.
export function toCSV(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns || (rows[0] ? Object.keys(rows[0]) : []);
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(',')].concat(rows.map((r) => cols.map((c) => cell(r[c])).join(','))).join('\n');
}

export function download(filename: string, text: string, mime = 'text/csv;charset=utf-8;') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Philippine mobile format: 09XX XXX XXXX (also accepts +639XXXXXXXXX).
export function normalisePhone(input: string): string | null {
  const digits = String(input || '').replace(/[^\d]/g, '');
  if (/^639\d{9}$/.test(digits)) return '0' + digits.slice(2);
  if (/^09\d{9}$/.test(digits)) return digits;
  return null;
}

export const telHref = (num: string) => 'tel:' + String(num || '').replace(/[^\d+]/g, '');

// Friendly text for the auth errors people actually hit.
export function authError(message: string | undefined, status?: number): string {
  const m = String(message || '').toLowerCase();
  if (/invalid login credentials|invalid grant/.test(m)) return 'That email and password do not match an account.';
  if (/email not confirmed/.test(m)) return 'Confirm your email address first. Check your inbox for the link we sent.';
  if (/user is banned|disabled|deactivated/.test(m)) return 'This account has been disabled. Contact your LGU administrator.';
  if (/already registered|already exists/.test(m)) return 'An account already exists for that email. Try signing in instead.';
  if (/rate limit|too many/.test(m)) return 'Too many attempts. Wait a minute and try again.';
  if (/failed to fetch|networkerror|network request failed/.test(m) || status === 0) {
    return 'No connection to the server. Check your network and try again.';
  }
  if (/password should be at least/.test(m)) return 'Use at least 8 characters for the password.';
  return message || 'Something went wrong. Try again.';
}

// Downscale and re-encode before upload so a phone photo fits the 5 MB bucket.
export function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error('Only image files can be attached'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, CONFIG.PHOTO_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);
            if (!blob) return reject(new Error('Could not process that photo'));
            if (blob.size > CONFIG.MAX_PHOTO_BYTES) {
              return reject(new Error('Photo is still too large after compression. Try a smaller image.'));
            }
            resolve(blob);
          },
          'image/jpeg',
          CONFIG.PHOTO_QUALITY
        );
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not a readable image'));
    };
    img.src = url;
  });
}
