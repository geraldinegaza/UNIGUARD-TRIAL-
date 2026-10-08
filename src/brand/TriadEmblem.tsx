import React from 'react';
import { THEMES, type Portal, type EmblemVariant } from './brandTokens';
import './brand.css';

export type EmblemState = 'idle' | 'loading' | 'syncing' | 'alert' | 'success' | 'offline';

export interface TriadEmblemProps {
  portal?: Portal;
  variant?: EmblemVariant;
  /** rendered width and height in px (the emblem is square) */
  size?: number;
  state?: EmblemState;
  /** accessible name; leave empty when text next to it already names UniGuard */
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}

// Triad Shield geometry on a 64 unit grid
const LEFT = 'M30.4 5.3C24 8.2 17.5 9.9 9.5 11.2V30C9.5 32.3 9.7 34.4 10.1 36.4H30.4Z';
const RIGHT = 'M33.6 5.3C40 8.2 46.5 9.9 54.5 11.2V30C54.5 32.3 54.3 34.4 53.9 36.4H33.6Z';
const KEEL = 'M10.9 40.2C16.8 37.6 22.6 42.8 32 40.2C41.4 37.6 47.2 42.8 53.1 40.2C49.6 48.8 42.2 55.6 32 60.5C21.8 55.6 14.4 48.8 10.9 40.2Z';

export function TriadEmblem({
  portal = 'auth',
  variant = 'light',
  size = 32,
  state = 'idle',
  title,
  className = '',
  style,
}: TriadEmblemProps) {
  const t = THEMES[portal];
  const c = t.emblem[variant];
  const alert = '#F0525A';
  const ringColor = state === 'alert' ? alert : variant === 'reverse' ? c.left : t.accent;
  const dotColor = state === 'alert' ? (variant === 'reverse' ? '#FFFFFF' : alert) : c.dot;

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`ug-triad ug-triad--${state} ${className}`}
      style={style}
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path className="ug-piece ug-piece--left" d={LEFT} fill={c.left} />
      <path className="ug-piece ug-piece--right" d={RIGHT} fill={c.right} />
      <path className="ug-piece ug-piece--keel" d={KEEL} fill={c.keel} />
      <circle className="ug-pulse" cx="32" cy="21.5" r="5.6" fill="none" stroke={ringColor} strokeWidth="1.6" />
      <circle className="ug-hub" cx="32" cy="21.5" r="5.6" fill={c.hub} />
      <circle
        className="ug-orbit"
        cx="32"
        cy="21.5"
        r="8.6"
        fill="none"
        stroke={ringColor}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeDasharray="13 41"
      />
      <circle className="ug-dot" cx="32" cy="21.5" r="2.4" fill={dotColor} />
    </svg>
  );
}

export default TriadEmblem;
