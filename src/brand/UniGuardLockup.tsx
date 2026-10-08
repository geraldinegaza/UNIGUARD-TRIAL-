import React from 'react';
import { THEMES, IDENTITY, type Portal, type EmblemVariant, type BrandContext } from './brandTokens';
import { TriadEmblem, type EmblemState } from './TriadEmblem';
import { PortalTag } from './PortalTag';

export type LockupLayout = 'horizontal' | 'stacked' | 'compact';

export interface UniGuardLockupProps {
  portal?: Portal;
  variant?: EmblemVariant;
  /**
   * horizontal: emblem + wordmark + descriptor line (login, sidebars, documents)
   * stacked:    emblem above wordmark (splash, resident sidebar, print)
   * compact:    emblem + wordmark + chip on one line (top bars, mobile headers)
   */
  layout?: LockupLayout;
  /** emblem size in px; text scales from it */
  size?: number;
  /** chip text; defaults to the portal's chip (e.g. "Brgy. Poblacion", "LDRRMO"). Pass null to hide. */
  tag?: React.ReactNode | null;
  /** line under the wordmark; defaults to the portal descriptor. Pass null to hide. */
  descriptor?: React.ReactNode | null;
  context?: BrandContext;
  state?: EmblemState;
  /** hide the chip below this breakpoint by passing a class, e.g. "hidden sm:inline-flex" */
  tagClassName?: string;
  /** same for the wordmark text, e.g. "hidden sm:inline" to keep only emblem + chip on phones */
  wordmarkClassName?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function Wordmark({
  portal = 'auth',
  variant = 'light',
  fontSize,
  className,
}: {
  portal?: Portal;
  variant?: EmblemVariant;
  fontSize: number;
  className?: string;
}) {
  const t = THEMES[portal];
  return (
    <span
      className={className}
      style={{
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        fontWeight: 800,
        fontSize,
        letterSpacing: '-0.035em',
        lineHeight: 1,
        color: t.uni[variant],
        whiteSpace: 'nowrap',
      }}
    >
      Uni<span style={{ color: t.guard[variant] }}>Guard</span>
    </span>
  );
}

export function UniGuardLockup({
  portal = 'auth',
  variant = 'light',
  layout = 'horizontal',
  size,
  tag,
  descriptor,
  context = {},
  state = 'idle',
  tagClassName,
  wordmarkClassName,
  className = '',
  style,
}: UniGuardLockupProps) {
  const t = THEMES[portal];
  const id = IDENTITY[portal];
  const chipText = tag === undefined ? id.chip(context) : tag;
  const lineText = descriptor === undefined ? id.descriptor(context) : descriptor;

  if (layout === 'stacked') {
    const s = size ?? 72;
    return (
      <div
        className={className}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: s * 0.16, ...style }}
      >
        <TriadEmblem portal={portal} variant={variant} size={s} state={state} />
        <Wordmark portal={portal} variant={variant} fontSize={Math.round(s * 0.42)} className={wordmarkClassName} />
        {lineText && (
          <span style={{ fontSize: Math.max(9, Math.round(s * 0.13)), fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: t.tagText[variant] }}>
            {lineText}
          </span>
        )}
        {chipText && <PortalTag portal={portal} variant={variant} className={tagClassName}>{chipText}</PortalTag>}
      </div>
    );
  }

  if (layout === 'compact') {
    const s = size ?? 28;
    return (
      <div className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(s * 0.3), minWidth: 0, ...style }}>
        <TriadEmblem portal={portal} variant={variant} size={s} state={state} />
        <Wordmark portal={portal} variant={variant} fontSize={Math.round(s * 0.62)} className={wordmarkClassName} />
        {chipText && <PortalTag portal={portal} variant={variant} className={tagClassName}>{chipText}</PortalTag>}
      </div>
    );
  }

  const s = size ?? 48;
  return (
    <div className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(s * 0.26), minWidth: 0, ...style }}>
      <TriadEmblem portal={portal} variant={variant} size={s} state={state} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(s * 0.12), minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Wordmark portal={portal} variant={variant} fontSize={Math.round(s * 0.55)} className={wordmarkClassName} />
          {chipText && <PortalTag portal={portal} variant={variant} className={tagClassName}>{chipText}</PortalTag>}
        </div>
        {lineText && (
          <span style={{ fontSize: Math.max(9, Math.round(s * 0.2)), fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: t.tagText[variant], whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {lineText}
          </span>
        )}
      </div>
    </div>
  );
}

export default UniGuardLockup;
