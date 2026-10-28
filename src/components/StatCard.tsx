import React from 'react';
import { ChevronRight } from 'lucide-react';
import { openable } from '../hooks/useFocusItem';

// A resident figure card (Home, Notifications): white at rest; on hover, or
// keyboard focus when it opens a page, the signature dark red gradient fades
// in and the text turns white. The gradient is its own layer because a
// background gradient cannot be faded directly. Class names are written out in
// full so Tailwind generates them; a card without onOpen is not focusable, so
// its focus classes never apply.
export const StatCard: React.FC<{
  label: string;
  value: React.ReactNode;
  note: string;
  icon: React.ElementType;
  /** opens the page behind the figure; without it the card only reacts to hover */
  onOpen?: () => void;
  /** the right end of the footer; a card that opens a page shows an arrow */
  aside?: React.ReactNode;
  /** the footer dot at rest, e.g. green when everything is cleared */
  dotClass?: string;
  /** a word or two instead of a number */
  textValue?: boolean;
  className?: string;
}> = ({ label, value, note, icon: Icon, onOpen, aside, dotClass = 'bg-red-900', textValue = false, className = '' }) => (
  <div
    {...(onOpen ? openable(onOpen) : {})}
    className={`group relative overflow-hidden bg-white rounded-3xl p-4 sm:p-7 shadow-xl hover:shadow-2xl border border-neutral-100/80 hover:border-red-900/40 focus-visible:border-red-900/40 flex flex-col justify-between min-w-0 w-full transition-all duration-300 ${
      onOpen ? 'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-red-900 focus-visible:ring-offset-2' : ''
    } ${className}`}
  >
    <span
      aria-hidden="true"
      className="absolute inset-0 bg-gradient-to-br from-red-800 via-red-900 to-red-950 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-300"
    />
    <div className="relative flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wider text-neutral-400 group-hover:text-red-100/80 group-focus-visible:text-red-100/80 transition-colors">
          {label}
        </p>
        <p
          className={`font-extrabold tracking-tight font-mono tabular-nums group-hover:text-white group-focus-visible:text-white transition-colors ${
            textValue ? 'text-2xl sm:text-3xl mt-3 text-red-900' : 'text-3xl sm:text-5xl mt-2 text-neutral-900'
          }`}
        >
          {value}
        </p>
      </div>
      <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-red-50 text-red-900 border border-red-100/60 group-hover:bg-white/15 group-hover:text-white group-hover:border-white/20 group-focus-visible:bg-white/15 group-focus-visible:text-white group-focus-visible:border-white/20 group-hover:scale-105 flex items-center justify-center shadow-sm transition-all shrink-0">
        <Icon className="w-5 h-5 sm:w-6 sm:h-6" />
      </div>
    </div>
    <div className="relative mt-4 pt-3 sm:mt-6 sm:pt-4 border-t border-neutral-100 group-hover:border-white/15 group-focus-visible:border-white/15 flex items-center justify-between gap-2 text-xs text-neutral-500 group-hover:text-red-100/90 group-focus-visible:text-red-100/90 font-medium transition-colors">
      <span className="flex items-center gap-2 min-w-0">
        <span className={`w-2 h-2 rounded-full shrink-0 group-hover:bg-white group-focus-visible:bg-white transition-colors ${dotClass}`} />
        <span>{note}</span>
      </span>
      {aside !== undefined ? (
        <span className="shrink-0 font-mono font-bold tabular-nums text-neutral-700 group-hover:text-white group-focus-visible:text-white transition-colors">{aside}</span>
      ) : onOpen ? (
        <ChevronRight className="w-4 h-4 shrink-0 text-neutral-400 group-hover:text-white group-focus-visible:text-white group-hover:translate-x-1 transition-all" />
      ) : null}
    </div>
  </div>
);
