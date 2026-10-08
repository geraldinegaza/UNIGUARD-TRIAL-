import React from 'react';
import { THEMES, type Portal, type EmblemVariant } from './brandTokens';

export interface PortalTagProps {
  portal: Portal;
  variant?: EmblemVariant;
  children: React.ReactNode;
  /** optional live dot, e.g. green for online, amber for offline queue */
  dotColor?: string;
  size?: 'xs' | 'sm';
  className?: string;
}

/** The small uppercase chip that sits next to the wordmark: "BRGY. POBLACION", "LDRRMO", "LINGAYEN". */
export function PortalTag({ portal, variant = 'light', children, dotColor, size = 'xs', className = '' }: PortalTagProps) {
  const chip = THEMES[portal].chip[variant];
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: size === 'xs' ? 9.5 : 11,
        fontWeight: 800,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        lineHeight: 1,
        padding: size === 'xs' ? '4px 8px' : '5px 10px',
        borderRadius: 999,
        background: chip.bg,
        color: chip.text,
        border: `1px solid ${chip.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {dotColor && <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, background: dotColor }} />}
      {children}
    </span>
  );
}

export default PortalTag;
