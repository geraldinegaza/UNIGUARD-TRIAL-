import React from 'react';

interface UniGuardLogoProps {
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  variant?: 'light' | 'dark' | 'color';
}

export const UniGuardLogo: React.FC<UniGuardLogoProps> = ({
  className = '',
  size = 'md',
  showText = false,
  variant = 'color',
}) => {
  const sizeMap = {
    xs: 'w-7 h-7',
    sm: 'w-10 h-10',
    md: 'w-14 h-14',
    lg: 'w-20 h-20',
    xl: 'w-28 h-28',
  };

  return (
    <div className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      {/* Official UniGuard Vector Mark */}
      <div className={`relative shrink-0 ${sizeMap[size]}`}>
        <svg
          viewBox="0 0 200 200"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full drop-shadow-md"
        >
          <defs>
            {/* Primary UniGuard Emergency Shield Gradient */}
            <linearGradient id="ugShieldGrad" x1="20" y1="10" x2="180" y2="190" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#DC2626" />
              <stop offset="55%" stopColor="#B91C1C" />
              <stop offset="100%" stopColor="#7F1D1D" />
            </linearGradient>

            {/* Inner High-Tech Slate/Navy Gradient */}
            <linearGradient id="ugInnerGrad" x1="40" y1="30" x2="160" y2="170" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#1E293B" />
              <stop offset="100%" stopColor="#0F172A" />
            </linearGradient>

            {/* Silver Vigilance Crest Gradient */}
            <linearGradient id="ugGoldGrad" x1="70" y1="50" x2="130" y2="130" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="50%" stopColor="#E2E8F0" />
              <stop offset="100%" stopColor="#94A3B8" />
            </linearGradient>

            {/* Red Radar Arc Glow */}
            <linearGradient id="ugCyanGrad" x1="60" y1="60" x2="140" y2="140" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#F87171" />
              <stop offset="100%" stopColor="#DC2626" />
            </linearGradient>

            {/* Subtle Metallic Bevel Highlight */}
            <linearGradient id="ugBevelGrad" x1="0" y1="0" x2="200" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.6" />
              <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.5" />
            </linearGradient>

            {/* Soft Ambient Shadow */}
            <filter id="ugGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#B91C1C" floodOpacity="0.35" />
            </filter>
          </defs>

          {/* Outer Protective Bevel Shield */}
          <path
            d="M 100 12 L 175 42 C 175 120 142 165 100 188 C 58 165 25 120 25 42 Z"
            fill="url(#ugShieldGrad)"
            stroke="url(#ugBevelGrad)"
            strokeWidth="3.5"
            strokeLinejoin="round"
            filter="url(#ugGlow)"
          />

          {/* Inner Shield Body - High-contrast command console core */}
          <path
            d="M 100 24 L 163 50 C 163 114 135 152 100 172 C 65 152 37 114 37 50 Z"
            fill="url(#ugInnerGrad)"
            stroke="#FFFFFF"
            strokeOpacity="0.25"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />

          {/* Radar Early Warning Waves (Top-center alert broadcast) */}
          <path
            d="M 76 68 C 90 56 110 56 124 68"
            stroke="url(#ugCyanGrad)"
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
            opacity="0.9"
          />
          <path
            d="M 85 78 C 94 70 106 70 115 78"
            stroke="#F87171"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
            opacity="0.75"
          />

          {/* Monogram 'U' + 'G' (Unified Guard Crest) */}
          {/* Outer U Wings */}
          <path
            d="M 62 76 V 110 C 62 136 78 148 100 148 C 122 148 138 136 138 110 V 76"
            stroke="url(#ugGoldGrad)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />

          {/* Internal 'G' Crossbar & Anchor Arrow (representing Guard & directional rescue response) */}
          <path
            d="M 138 106 H 108"
            stroke="url(#ugGoldGrad)"
            strokeWidth="7"
            strokeLinecap="round"
          />

          {/* Central Early Warning Star / Beacon Node */}
          <polygon
            points="100,80 104,92 116,92 106,100 110,112 100,104 90,112 94,100 84,92 96,92"
            fill="#FFFFFF"
            stroke="url(#ugGoldGrad)"
            strokeWidth="1.5"
          />

          {/* Radiant Center Dot */}
          <circle cx="100" cy="98" r="3.5" fill="#EF4444" />

          {/* Lower Shield Guard Trim (Civic Resilient Foundation) */}
          <path
            d="M 78 152 Q 100 168 122 152"
            stroke="#DC2626"
            strokeWidth="3.5"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </div>

      {/* Optional Integrated Typography */}
      {showText && (
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5 leading-none">
            <span
              className={`font-black tracking-tight ${
                variant === 'light'
                  ? 'text-white'
                  : 'text-slate-900'
              } ${
                size === 'xs' ? 'text-sm' : size === 'sm' ? 'text-lg' : size === 'md' ? 'text-xl' : 'text-2xl'
              }`}
            >
              Uni<span className="text-red-600">Guard</span>
            </span>
            <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
              DRRM
            </span>
          </div>
          <span
            className={`text-[9px] tracking-wider uppercase font-semibold mt-0.5 ${
              variant === 'light' ? 'text-slate-300' : 'text-slate-400'
            }`}
          >
            Unified DRRM Platform
          </span>
        </div>
      )}
    </div>
  );
};
