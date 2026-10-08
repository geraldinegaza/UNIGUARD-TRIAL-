import React from 'react';
import {
  THEMES,
  IDENTITY,
  SCREEN_VARIANT,
  processCopy,
  type Portal,
  type EmblemVariant,
  type BrandProcess,
  type BrandContext,
} from './brandTokens';
import { TriadEmblem, type EmblemState } from './TriadEmblem';
import { Wordmark } from './UniGuardLockup';
import { PortalTag } from './PortalTag';
import './brand.css';

export interface BrandLoaderProps {
  portal: Portal;
  process: BrandProcess;
  context?: BrandContext;
  /**
   * screen: full viewport (session restore, first portal load, sign out)
   * panel:  fills a card or section while its data loads
   * inline: one line, for buttons, banners and table footers
   */
  mode?: 'screen' | 'panel' | 'inline';
  /** 0, 1 or 2 to pin the tracker to a real step; leave undefined to animate */
  step?: 0 | 1 | 2;
  /** override the title / detail copy for one-off processes */
  title?: string;
  detail?: string;
  /** reverse colors when the panel sits on the portal's solid color */
  variant?: EmblemVariant;
  className?: string;
}

const STATE_FOR: Partial<Record<BrandProcess, EmblemState>> = {
  sync: 'syncing',
  publish: 'syncing',
  offline: 'offline',
};

export function BrandLoader({
  portal,
  process,
  context = {},
  mode = 'panel',
  step,
  title,
  detail,
  variant,
  className = '',
}: BrandLoaderProps) {
  const t = THEMES[portal];
  const copy = processCopy(portal, process, context);
  const heading = title ?? copy.title;
  const body = detail ?? copy.detail;
  const v: EmblemVariant = variant ?? (mode === 'screen' ? SCREEN_VARIANT[portal] : 'light');
  const emblemState: EmblemState = STATE_FOR[process] ?? 'loading';
  const onDark = v === 'reverse';
  const textMain = onDark ? '#FFFFFF' : t.uni.light;
  const textSoft = onDark ? t.tagText.reverse : t.tagText.light;
  const pieces = t.emblem[v];
  const track = onDark ? 'rgba(255,255,255,0.16)' : 'rgba(15,23,42,0.08)';

  if (mode === 'inline') {
    return (
      <span
        role="status"
        aria-live="polite"
        className={className}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: textMain, fontSize: 13, fontWeight: 600, minWidth: 0 }}
      >
        <TriadEmblem portal={portal} variant={v} size={18} state={emblemState} />
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{heading}</span>
      </span>
    );
  }

  const tracker = (
    <div className={`ug-steps ${step === undefined && process !== 'offline' ? 'ug-steps--auto' : ''}`} aria-hidden="true">
      {copy.steps.map((label, i) => {
        const fill = [pieces.left, pieces.right, pieces.keel][i];
        const progress = step === undefined ? 0 : i < step ? 1 : i === step ? 0.55 : 0;
        return (
          <div className="ug-step" key={label}>
            <div
              className="ug-step__bar"
              style={{ '--ug-track': track, '--ug-fill': fill, '--ug-progress': progress, '--ug-delay': `${i * 0.6}s` } as React.CSSProperties}
            />
            <span className="ug-step__label" style={{ color: textSoft }}>{label}</span>
          </div>
        );
      })}
    </div>
  );

  const content = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: mode === 'screen' ? 18 : 14, width: '100%', maxWidth: 380 }}>
      <TriadEmblem portal={portal} variant={v} size={mode === 'screen' ? 84 : 52} state={emblemState} />
      {mode === 'screen' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Wordmark portal={portal} variant={v} fontSize={22} />
          <PortalTag portal={portal} variant={v}>{IDENTITY[portal].chip(context)}</PortalTag>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <p style={{ margin: 0, fontSize: mode === 'screen' ? 19 : 16, fontWeight: 800, letterSpacing: '-0.02em', color: textMain }}>{heading}</p>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: textSoft }}>{body}</p>
      </div>
      {tracker}
    </div>
  );

  if (mode === 'screen') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className={`ug-loader-screen ${className}`}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 60,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: t.screen,
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        }}
      >
        {content}
        <p style={{ position: 'absolute', bottom: 24, left: 16, right: 16, margin: 0, textAlign: 'center', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: textSoft }}>
          {IDENTITY[portal].tagline}
        </p>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={className}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 20px', minHeight: 220, width: '100%', boxSizing: 'border-box' }}
    >
      {content}
    </div>
  );
}

export default BrandLoader;
