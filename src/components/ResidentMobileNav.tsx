import { t } from '../lib/i18n';
import React, { useEffect, useRef, useState } from 'react';
import {
  Home,
  Building2,
  PhoneCall,
  AlertTriangle,
  LayoutGrid,
  Bell,
  Download,
  LogOut,
  X,
  type LucideIcon,
  Settings,
} from 'lucide-react';
import { User } from '../types';
import { PortalTag } from '../brand';

// Phone navigation for the resident portal. What a resident reaches for in an
// emergency sits in the bottom bar: Home, Shelters, SOS, Hotlines and the Menu.
// The other sections are text tabs in the header row; tap one, or swipe the
// page left and right to move between them.

export const RESIDENT_TOP_TABS: { id: string; label: string }[] = [
  { id: 'relief', label: 'Relief' },
  { id: 'guides', label: 'Guides' },
  { id: 'faqs', label: 'FAQs' },
];

/** The phone layout this navigation belongs to. */
export const RESIDENT_PHONE_QUERY = '(max-width: 767px)';

/** Position of a section in the strip, or -1 for screens that are not in it. */
export const residentTabIndex = (tab: string) => RESIDENT_TOP_TABS.findIndex((t) => t.id === tab);

interface ResidentTopTabsProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const ResidentTopTabs: React.FC<ResidentTopTabsProps> = ({ activeTab, setActiveTab }) => {
  const stripRef = useRef<HTMLDivElement>(null);
  const activeIndex = residentTabIndex(activeTab);

  // keep the current tab in view when the page is swiped to it
  useEffect(() => {
    const strip = stripRef.current;
    const el = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!strip || !el) return;
    const target = el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }, [activeIndex]);

  return (
    <div
      ref={stripRef}
      role="navigation"
      aria-label={t("Sections")}
      className="md:hidden flex-1 min-w-0 flex overflow-x-auto no-scrollbar"
    >
      {/* centred between the emblem and the buttons; scrolls if a phone is too narrow */}
      <div className="mx-auto flex items-stretch">
        {RESIDENT_TOP_TABS.map((item, index) => {
          const active = index === activeIndex;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`relative shrink-0 h-10 px-3 text-[15px] whitespace-nowrap cursor-pointer transition-colors ${
                active ? 'font-extrabold text-neutral-900' : 'font-semibold text-neutral-400'
              }`}
            >
              {t(item.label)}
              <span
                aria-hidden="true"
                className={`absolute left-1/2 -translate-x-1/2 bottom-1 h-[3px] rounded-full bg-[#991B1B] transition-all duration-200 ${
                  active ? 'w-6 opacity-100' : 'w-0 opacity-0'
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------ bottom bar */

const BAR_LEFT: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Home', icon: Home },
  { id: 'shelters', label: 'Shelters', icon: Building2 },
];
const BAR_RIGHT: { id: string; label: string; icon: LucideIcon }[] = [{ id: 'hotlines', label: 'Hotlines', icon: PhoneCall }];

const MENU_ITEMS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'offline_sync', label: 'Offline Sync', icon: Download },
  { id: 'settings', label: 'Settings', icon: Settings },
];

interface ResidentBottomNavProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: User;
  /** opens or closes the SOS panel */
  onSos: () => void;
  onSignOut?: () => void;
}

export const ResidentBottomNav: React.FC<ResidentBottomNavProps> = ({ activeTab, setActiveTab, currentUser, onSos, onSignOut }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const isActive = (id: string) => activeTab === id || (id === 'overview' && activeTab === 'home');
  const inMenuSection = MENU_ITEMS.some((item) => item.id === activeTab);

  useEffect(() => {
    if (!isMenuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setIsMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMenuOpen]);

  // dragging the drawer back towards the right edge closes it
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const onDrawerTouchStart = (e: React.TouchEvent) => {
    dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onDrawerTouchEnd = (e: React.TouchEvent) => {
    const from = dragStart.current;
    dragStart.current = null;
    if (!from) return;
    const dx = e.changedTouches[0].clientX - from.x;
    const dy = e.changedTouches[0].clientY - from.y;
    if (dx > 60 && dx > Math.abs(dy) * 1.5) setIsMenuOpen(false);
  };

  const go = (tab: string) => {
    setIsMenuOpen(false);
    setActiveTab(tab);
  };

  const slot = (
    item: { id: string; label: string; icon: LucideIcon },
    active: boolean,
    onClick: () => void, extra?: React.ButtonHTMLAttributes<HTMLButtonElement>
  ) => {
    const Icon = item.icon;
    return (
      <button
        key={item.id}
        type="button"
        onClick={onClick}
        className="flex-1 min-w-0 h-[62px] flex flex-col items-center justify-center gap-1 cursor-pointer select-none"
        {...extra}
      >
        <span
          className={`w-12 h-8 rounded-full flex items-center justify-center transition-colors duration-200 ${
            active ? 'bg-red-50 text-[#991B1B]' : 'text-neutral-400'
          }`}
        >
          <Icon className="w-[22px] h-[22px]" strokeWidth={active ? 2.3 : 1.8} />
        </span>
        <span
          className={`max-w-full truncate text-[10px] min-[360px]:text-[11px] leading-none ${
            active ? 'font-extrabold text-[#991B1B]' : 'font-medium text-neutral-500'
          }`}
        >
          {t(item.label)}
        </span>
      </button>
    );
  };

  return (
    <nav aria-label={t("Emergency essentials")} className="md:hidden shrink-0 relative z-30 px-2 pb-2 pt-7 -mt-7 pointer-events-none">
      <div className="pointer-events-auto relative flex items-stretch rounded-[26px] bg-white px-1 border border-red-100 shadow-[0_8px_28px_-10px_rgba(74,13,18,0.3)]">
        {BAR_LEFT.map((item) => {
          const active = !isMenuOpen && isActive(item.id);
          return slot(item, active, () => go(item.id), { 'aria-current': active ? 'page' : undefined });
        })}

        {/* SOS: in the middle where either thumb reaches it, lifted on a bump that is part of the bar */}
        <button
          type="button"
          data-sos-trigger
          onClick={() => {
            setIsMenuOpen(false);
            onSos();
          }}
          aria-label={t("Emergency SOS")}
          className="group relative flex-1 min-w-0 h-[62px] flex flex-col items-center justify-end pb-[9px] cursor-pointer select-none"
        >
          <span
            aria-hidden="true"
            className="absolute left-1/2 -translate-x-1/2 -top-[20px] w-[72px] h-[21px] rounded-t-[22px] bg-white border border-b-0 border-red-100"
          />
          <span className="absolute left-1/2 -translate-x-1/2 -top-[14px] w-[52px] h-[52px] rounded-full flex items-center justify-center text-white bg-gradient-to-b from-[#B4232A] to-[#7F1D1D] shadow-[0_6px_14px_-4px_rgba(127,29,29,0.55)] group-active:scale-95 transition-transform">
            <AlertTriangle className="w-[22px] h-[22px]" strokeWidth={2.3} />
          </span>
          <span className="relative text-[11px] leading-none font-extrabold tracking-wide text-[#991B1B]">{t("SOS")}</span>
        </button>

        {BAR_RIGHT.map((item) => {
          const active = !isMenuOpen && isActive(item.id);
          return slot(item, active, () => go(item.id), { 'aria-current': active ? 'page' : undefined });
        })}
        {slot(
          { id: 'menu', label: 'Menu', icon: LayoutGrid },
          isMenuOpen || inMenuSection,
          () => setIsMenuOpen((open) => !open),
          { 'aria-expanded': isMenuOpen, 'aria-haspopup': 'dialog', 'aria-controls': 'resident-mobile-menu' }
        )}
      </div>

      {/* Dimmed page beside the drawer: a tap on it closes the menu */}
      <div
        className={`fixed inset-0 bg-[#2A0A0E]/45 transition-opacity duration-300 ${
          isMenuOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setIsMenuOpen(false)}
        aria-hidden="true"
      />

      {/* Menu drawer, sliding in from the right edge over the page */}
      <div
        id="resident-mobile-menu"
        role="dialog"
        aria-modal="true"
        aria-label={t("Menu")}
        inert={!isMenuOpen}
        onTouchStart={onDrawerTouchStart}
        onTouchEnd={onDrawerTouchEnd}
        className={`fixed inset-y-0 right-0 w-[86%] max-w-sm flex flex-col bg-white border-l border-red-100 shadow-2xl pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)] transition-[translate,visibility] duration-300 ease-out ${
          isMenuOpen ? 'pointer-events-auto translate-x-0 visible' : 'pointer-events-none translate-x-full invisible'
        }`}
      >
        {/* Who is signed in, and the close button */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-4 border-b border-neutral-100">
          <div className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center font-black text-lg text-white bg-[#991B1B] ring-4 ring-red-100">
            {currentUser.full_name ? currentUser.full_name.trim().charAt(0).toUpperCase() : 'R'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black truncate text-neutral-900">{currentUser.full_name || 'Resident'}</p>
            <div className="mt-1 flex">
              <PortalTag portal="resident">
                {currentUser.barangay_name ? `Brgy. ${currentUser.barangay_name}` : 'Resident · Lingayen'}
              </PortalTag>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsMenuOpen(false)}
            aria-label={t("Close menu")}
            className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center cursor-pointer text-[#991B1B] bg-red-50 active:bg-red-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 py-3">
          {MENU_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`w-full h-12 px-3 rounded-2xl flex items-center gap-3.5 text-left text-[15px] cursor-pointer transition-colors ${
                  active ? 'font-bold bg-[#991B1B] text-white' : 'font-medium text-neutral-800 active:bg-red-50'
                }`}
              >
                <Icon className={`w-[22px] h-[22px] shrink-0 ${active ? 'text-white' : 'text-[#991B1B]'}`} strokeWidth={1.8} />
                <span className="truncate">{t(item.label)}</span>
              </button>
            );
          })}
        </div>

        {onSignOut && (
          <div className="shrink-0 p-3 border-t border-neutral-100">
            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(false);
                onSignOut();
              }}
              className="w-full h-12 rounded-2xl flex items-center justify-center gap-2 text-sm font-bold cursor-pointer text-[#991B1B] bg-red-50 border border-red-100 active:bg-red-100"
            >
              <LogOut className="w-4 h-4" />
              <span>{t("Sign Out")}</span>
            </button>
          </div>
        )}
      </div>
    </nav>
  );
};

/* ------------------------------------------------------------------ swipe */

/**
 * What a touch began on: 'blocked' for maps and form fields, which keep every
 * sideways drag to themselves, or the sideways-scrolling box it is inside, if any.
 */
function sidewaysControlAt(target: EventTarget | null, boundary: HTMLElement): 'blocked' | HTMLElement | null {
  let el = target instanceof Element ? (target as HTMLElement) : null;
  while (el && el !== boundary) {
    if (el.matches('.leaflet-container, input, textarea, select, [data-no-swipe]')) return 'blocked';
    const overflowX = getComputedStyle(el).overflowX;
    if ((overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 4) return el;
    el = el.parentElement;
  }
  return null;
}

/** Swiping the page left or right moves to the next or previous section of the strip. */
export function useResidentSwipeTabs(
  ref: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  activeTab: string,
  go: (tab: string) => void
) {
  const latest = useRef({ activeTab, go });
  latest.current = { activeTab, go };

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let start: { x: number; y: number; t: number; scroller: HTMLElement | null; scrollLeft: number } | null = null;

    const onStart = (e: TouchEvent) => {
      start = null;
      if (e.touches.length !== 1 || !window.matchMedia(RESIDENT_PHONE_QUERY).matches) return;
      const control = sidewaysControlAt(e.target, el);
      if (control === 'blocked') return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), scroller: control, scrollLeft: control ? control.scrollLeft : 0 };
    };
    const onEnd = (e: TouchEvent) => {
      if (!start) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      const quick = Date.now() - start.t < 700;
      const { scroller, scrollLeft } = start;
      start = null;
      // a sideways-scrolling row keeps the drag while it can still scroll that
      // way; once it is at its edge, the same swipe moves on to the next section
      if (scroller) {
        const atEdge = dx < 0
          ? scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 2
          : scroller.scrollLeft <= 2;
        if (!atEdge || Math.abs(scroller.scrollLeft - scrollLeft) > 2) return;
      }
      if (!quick || Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      const index = residentTabIndex(latest.current.activeTab);
      if (index < 0) return;
      const next = RESIDENT_TOP_TABS[index + (dx < 0 ? 1 : -1)];
      if (next) latest.current.go(next.id);
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchend', onEnd);
    };
  }, [ref, enabled]);
}
