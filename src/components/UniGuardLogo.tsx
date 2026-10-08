import React from 'react';
import { TriadEmblem, UniGuardLockup, type EmblemState, type EmblemVariant, type Portal } from '../brand';

interface UniGuardLogoProps {
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  /**
   * light: for white or tinted surfaces. reverse: for a solid portal color.
   * 'dark' and 'color' are the old names for the light mark and still work.
   */
  variant?: 'light' | 'reverse' | 'dark' | 'color';
  /** which portal's palette the Triad Shield takes; the gateway look by default */
  portal?: Portal;
  state?: EmblemState;
  /** stretch to the parent instead of the size token, for marks inside a sized badge */
  fill?: boolean;
}

const SIZE_CLASS = {
  xs: 'w-7 h-7',
  sm: 'w-10 h-10',
  md: 'w-14 h-14',
  lg: 'w-20 h-20',
  xl: 'w-28 h-28',
};

const SIZE_PX = { xs: 28, sm: 40, md: 56, lg: 80, xl: 112 };

// Thin wrapper around the Triad Shield emblem that keeps the old size tokens
export const UniGuardLogo: React.FC<UniGuardLogoProps> = ({
  className = '',
  size = 'md',
  showText = false,
  variant = 'light',
  portal = 'auth',
  state = 'idle',
  fill = false,
}) => {
  const emblemVariant: EmblemVariant = variant === 'reverse' ? 'reverse' : 'light';

  if (showText) {
    return (
      <UniGuardLockup
        layout="horizontal"
        portal={portal}
        variant={emblemVariant}
        size={SIZE_PX[size]}
        state={state}
        className={`select-none ${className}`}
      />
    );
  }

  return (
    <div className={`${fill ? 'flex w-full h-full' : 'inline-flex'} items-center select-none ${className}`}>
      <div className={`relative ${fill ? 'w-full h-full min-w-0' : `shrink-0 ${SIZE_CLASS[size]}`}`}>
        <TriadEmblem
          portal={portal}
          variant={emblemVariant}
          state={state}
          size={SIZE_PX[size]}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
};
