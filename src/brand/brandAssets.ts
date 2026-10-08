import type { Portal, EmblemVariant } from './brandTokens';

// Static brand files in /public/brand, for places that need a file URL rather
// than a React component: printed situation reports, CSV/PDF exports, emails,
// Open Graph images and push notifications.
const KEY: Record<Portal, string> = {
  auth: 'master',
  resident: 'resident',
  barangay: 'barangay',
  command: 'command',
};

export type BrandAssetKind = 'emblem' | 'horizontal' | 'stacked' | 'wordmark';

export function brandAsset(portal: Portal, kind: BrandAssetKind, variant: EmblemVariant = 'light', format: 'svg' | 'png' = 'svg') {
  const base = `uniguard-${KEY[portal]}-${variant}-${kind}`;
  return format === 'svg' ? `/brand/${base}.svg` : `/brand/png/${base}@4x.png`;
}

export const PWA_ICONS = {
  favicon: '/icons/favicon.svg',
  favicon32: '/icons/favicon-32.png',
  appleTouch: '/icons/apple-touch-icon.png',
  icon192: '/icons/icon-192.png',
  icon512: '/icons/icon-512.png',
  maskable512: '/icons/icon-maskable-512.png',
  /** monochrome, for Android notification badges */
  badge: '/icons/badge-96.png',
} as const;
