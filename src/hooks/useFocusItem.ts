import type React from 'react';
import { useEffect } from 'react';

// Brings an item another screen asked for into view and outlines it for a
// moment. `elementId` is the DOM id of the item; it waits a frame so the list
// it lives in has rendered (a filter or a collapsed section may have just
// opened to show it). Runs again when `key` changes, so tapping the same item
// twice still scrolls to it.
export function useFocusItem(elementId: string | null | undefined, key?: unknown) {
  useEffect(() => {
    if (!elementId) return;
    let clear = 0;
    const timer = window.setTimeout(() => {
      const el = document.getElementById(elementId);
      if (!el) return;
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      el.classList.remove('ug-focus-ring');
      void el.offsetWidth; // restart the outline animation
      el.classList.add('ug-focus-ring');
      clear = window.setTimeout(() => el.classList.remove('ug-focus-ring'), 2400);
    }, 80);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clear);
    };
  }, [elementId, key]);
}

/** What App hands a page when it is opened on one item. */
export type ItemFocus = { id: string; key: number } | null;

/** Props for a row that opens something: works with a mouse, a tap and the keyboard. */
export const openable = (open: () => void) => ({
  role: 'button' as const,
  tabIndex: 0,
  onClick: open,
  onKeyDown: (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  },
});
