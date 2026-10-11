import React, { useEffect, useRef } from 'react';
import {
  Home,
  AlertTriangle,
  Megaphone,
  Building2,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import { User } from '../types';
import { useRepo } from '../hooks/useRepo';

// Phone navigation for the barangay and LDRRMO portals. The five main sections
// live in the bottom bar and change on tap only. The rest sit in a text strip
// under the header, and the page swipes between them.

export const STAFF_BOTTOM_TABS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Home', icon: Home },
  { id: 'incidents', label: 'Incidents', icon: AlertTriangle },
  { id: 'advisories', label: 'Advisories', icon: Megaphone },
  { id: 'shelters', label: 'Shelters', icon: Building2 },
  { id: 'sos_log', label: 'SOS Log', icon: ShieldAlert },
];

export const STAFF_TOP_TABS: { id: string; label: string }[] = [
  { id: 'relief', label: 'Relief' },
  { id: 'road_work', label: 'Road Work' },
  { id: 'hotlines', label: 'Hotlines' },
  { id: 'analytics', label: 'Analytics' },
];

/** The phone layout these two navigations belong to. */
export const STAFF_PHONE_QUERY = '(max-width: 767px)';

const isBottomActive = (id: string, activeTab: string) =>
  activeTab === id ||
  (id === 'overview' && activeTab === 'home') ||
  (id === 'incidents' && (activeTab === 'feed' || activeTab === 'triage'));

interface NavProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: User;
}

/** Bottom bar: the active section rises into a circle that dips into the bar. */
export const StaffBottomNav: React.FC<NavProps> = ({ activeTab, setActiveTab, currentUser }) => {
  const isBarangay = currentUser.role === 'barangay';
  const data = useRepo();
  const badges: Record<string, number> = {
    advisories: data.advisories.filter((a) => a.severity !== 'low').length,
    shelters: data.centers.filter((c) => c.status === 'open').length,
  };

  return (
    <nav aria-label="Main sections" className="md:hidden shrink-0 relative z-30 px-2 pb-2 pt-6 -mt-6 pointer-events-none">
      <div
        className={`pointer-events-auto flex items-stretch rounded-[26px] bg-white px-1 shadow-[0_8px_28px_-10px_rgba(1,16,37,0.28)] ${
          isBarangay ? 'border border-[#7EA0C5]/40' : 'border border-neutral-200'
        }`}
      >
        {STAFF_BOTTOM_TABS.map((item) => {
          const active = isBottomActive(item.id, activeTab);
          const Icon = item.icon;
          const badge = badges[item.id];
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              aria-current={active ? 'page' : undefined}
              className="relative flex-1 min-w-0 h-[62px] flex flex-col items-center justify-end pb-2 cursor-pointer select-none"
            >
              <span
                className={`relative flex items-center justify-center rounded-full transition-all duration-200 ease-out ${
                  active
                    ? `w-12 h-12 -translate-y-3 text-white ring-[6px] shadow-lg ${
                        isBarangay
                          ? 'bg-[#052659] ring-[#EEF4FB] shadow-[#052659]/30'
                          : 'bg-[#18181B] ring-[#F1F5FA] shadow-black/25'
                      }`
                    : `w-7 h-7 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`
                }`}
              >
                <Icon className={active ? 'w-5 h-5' : 'w-[22px] h-[22px]'} strokeWidth={active ? 2.2 : 1.8} />
                {!!badge && (
                  <span
                    className={`absolute -top-1 -right-1.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold leading-4 text-center ${
                      active
                        ? isBarangay ? 'bg-[#C2E8FF] text-[#052659]' : 'bg-white text-[#18181B] border border-neutral-200'
                        : isBarangay ? 'bg-[#052659] text-white' : 'bg-[#18181B] text-white'
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </span>
              <span
                className={`max-w-full truncate px-0.5 text-[10.5px] leading-none transition-all duration-200 ${
                  active
                    ? `-mt-1.5 font-extrabold ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`
                    : `mt-1 font-medium ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

/** Top strip: the sections that are not in the bottom bar. Tap one, or swipe the page. */
export const StaffTopTabs: React.FC<NavProps> = ({ activeTab, setActiveTab, currentUser }) => {
  const isBarangay = currentUser.role === 'barangay';
  const stripRef = useRef<HTMLDivElement>(null);

  // keep the current tab in view when the page is swiped to it
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeTab]);

  return (
    <div
      ref={stripRef}
      role="navigation"
      aria-label="More sections"
      className="md:hidden order-last basis-full min-w-0 flex items-center gap-1 overflow-x-auto no-scrollbar -mb-2"
    >
      {STAFF_TOP_TABS.map((item) => {
        const active = activeTab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveTab(item.id)}
            aria-current={active ? 'page' : undefined}
            className={`relative shrink-0 h-10 px-3 text-sm whitespace-nowrap cursor-pointer transition-colors ${
              active
                ? `font-extrabold ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`
                : `font-semibold ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`
            }`}
          >
            {item.label}
            <span
              aria-hidden="true"
              className={`absolute left-1/2 -translate-x-1/2 bottom-1 h-[3px] rounded-full transition-all duration-200 ${
                active ? `w-6 ${isBarangay ? 'bg-[#052659]' : 'bg-[#18181B]'}` : 'w-0 bg-transparent'
              }`}
            />
          </button>
        );
      })}
    </div>
  );
};

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

/**
 * Swiping the page left or right moves between the top-strip sections. It does
 * nothing on the bottom-bar sections, which change on tap only.
 */
export function useStaffSwipeTabs(
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
      if (e.touches.length !== 1 || !window.matchMedia(STAFF_PHONE_QUERY).matches) return;
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
      // a wide table keeps the drag while it can still scroll that way; once it
      // is at its edge, the same swipe moves on to the next section
      if (scroller) {
        const atEdge = dx < 0
          ? scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 2
          : scroller.scrollLeft <= 2;
        if (!atEdge || Math.abs(scroller.scrollLeft - scrollLeft) > 2) return;
      }
      if (!quick || Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      const index = STAFF_TOP_TABS.findIndex((t) => t.id === latest.current.activeTab);
      if (index < 0) return;
      const next = STAFF_TOP_TABS[index + (dx < 0 ? 1 : -1)];
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
