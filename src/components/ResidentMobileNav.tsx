import React, { useEffect, useRef } from 'react';

// Phone navigation for the resident portal: a strip of text tabs under the
// header. Tap a tab, or swipe the page left and right to move between them.

export const RESIDENT_TOP_TABS: { id: string; label: string }[] = [
  { id: 'overview', label: 'Home' },
  { id: 'relief', label: 'Relief' },
  { id: 'shelters', label: 'Shelters' },
  { id: 'hotlines', label: 'Hotlines' },
  { id: 'guides', label: 'Guides' },
  { id: 'faqs', label: 'FAQs' },
];

/** The phone layout this navigation belongs to. */
export const RESIDENT_PHONE_QUERY = '(max-width: 767px)';

/** Position of a section in the strip, or -1 for screens that are not in it. */
export const residentTabIndex = (tab: string) =>
  RESIDENT_TOP_TABS.findIndex((t) => t.id === (tab === 'home' ? 'overview' : tab));

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
      aria-label="Sections"
      className="md:hidden order-last basis-full min-w-0 flex items-stretch gap-1 overflow-x-auto no-scrollbar -mx-3.5 px-2 -mb-2.5"
    >
      {RESIDENT_TOP_TABS.map((item, index) => {
        const active = index === activeIndex;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveTab(item.id)}
            aria-current={active ? 'page' : undefined}
            className={`relative shrink-0 h-11 px-3 text-[15px] whitespace-nowrap cursor-pointer transition-colors ${
              active ? 'font-extrabold text-neutral-900' : 'font-semibold text-neutral-400'
            }`}
          >
            {item.label}
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
