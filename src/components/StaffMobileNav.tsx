import React, { useEffect, useRef, useState } from 'react';
import {
  Home,
  AlertTriangle,
  Megaphone,
  Building2,
  ShieldAlert,
  LayoutGrid,
  Truck,
  Package,
  Construction,
  PhoneCall,
  Layers,
  BookOpen,
  HelpCircle,
  UserCheck,
  Users,
  FileText,
  Download,
  LogOut,
  X,
  type LucideIcon,
  Settings,
  Shield,
} from 'lucide-react';
import { User } from '../types';
import { useRepo } from '../hooks/useRepo';
import { SIDEBAR_OPS_TABS } from './SuperAdminPortal';

// Phone navigation for the barangay and LDRRMO portals: four main sections in
// a bottom bar, and everything else in the Menu at its far right, which opens
// a drawer that slides in from the right edge.

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** shown to LDRRMO administrators only, as the server enforces */
  lguOnly?: boolean;
  /** shown to barangay officials only */
  barangayOnly?: boolean;
}

const BAR_TABS: NavItem[] = [
  { id: 'overview', label: 'Home', icon: Home },
  { id: 'incidents', label: 'Incidents', icon: AlertTriangle },
  { id: 'advisories', label: 'Advisories', icon: Megaphone },
  { id: 'shelters', label: 'Shelters', icon: Building2 },
];

const MENU_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Operations',
    items: [
      { id: 'sos_log', label: 'SOS Log', icon: ShieldAlert },
      { id: 'relief', label: 'Relief', icon: Package },
      { id: 'road_work', label: 'Road Work', icon: Construction },
      { id: 'response_team', label: 'Response Team', icon: Shield, barangayOnly: true },
      { id: 'hotlines', label: 'Hotlines', icon: PhoneCall },
      { id: 'analytics', label: 'Analytics', icon: Layers },
      { id: 'reports', label: 'Reports & Documents', icon: FileText },
      { id: 'dispatch_units', label: 'Dispatch Units', icon: Truck, lguOnly: true },
    ],
  },
  {
    title: 'Resources',
    items: [
      { id: 'guides', label: 'Preparedness Guides', icon: BookOpen },
      { id: 'faqs', label: 'FAQs', icon: HelpCircle },
    ],
  },
  {
    title: 'Administration',
    items: [
      { id: 'others_review', label: 'Others Review', icon: UserCheck, lguOnly: true },
    ],
  },
  {
    title: 'This device',
    items: [
      { id: 'offline_sync', label: 'Offline Sync', icon: Download },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

const isBarActive = (id: string, activeTab: string) =>
  activeTab === id ||
  (id === 'overview' && activeTab === 'home') ||
  (id === 'incidents' && (activeTab === 'feed' || activeTab === 'triage'));

interface StaffBottomNavProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: User;
  onSignOut?: () => void;
  /** set while a Super Admin is in the operations console */
  onExitOps?: () => void;
}

/** Bottom bar: the active section rises into a circle that dips into the bar. */
export const StaffBottomNav: React.FC<StaffBottomNavProps> = ({ activeTab, setActiveTab, currentUser, onSignOut, onExitOps }) => {
  const isBarangay = currentUser.role === 'barangay';
  const isLgu = currentUser.role === 'lgu_admin';
  const data = useRepo();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const badges: Record<string, number> = {
    // barangay: open incidents in the official's own barangay
    incidents: isBarangay
      ? data.reports.filter((r) => r.barangay_id === currentUser.barangay_id && r.status !== 'resolved' && r.status !== 'rejected').length
      : 0,
    advisories: data.advisories.filter((a) => a.severity !== 'low').length,
    shelters: data.centers.filter((c) => c.status === 'open').length,
  };
  const menuGroups = MENU_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        (!item.lguOnly || isLgu) &&
        (!item.barangayOnly || isBarangay) &&
        // Super Admin in Operations: the Super Admin sidebar already links to these
        !(onExitOps && SIDEBAR_OPS_TABS.includes(item.id))
    ),
  })).filter((group) => group.items.length > 0);
  // Menu is the current slot for every section that is not in the bar itself
  const inMenuSection = !BAR_TABS.some((item) => isBarActive(item.id, activeTab));

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

  const slot = (item: NavItem, active: boolean, onClick: () => void, extra?: React.ButtonHTMLAttributes<HTMLButtonElement>) => {
    const Icon = item.icon;
    const badge = badges[item.id];
    return (
      <button
        key={item.id}
        type="button"
        onClick={onClick}
        aria-label={badge ? `${item.label}, ${badge} new` : item.label}
        aria-current={active ? 'page' : undefined}
        className="relative flex-1 min-w-0 h-[62px] flex flex-col items-center justify-end pb-2 cursor-pointer select-none"
        {...extra}
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
              aria-hidden="true"
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
          className={`max-w-full truncate text-[10px] min-[360px]:text-[11px] leading-none transition-all duration-200 ${
            active
              ? `-mt-1.5 font-extrabold ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`
              : `mt-1 font-medium ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`
          }`}
        >
          {item.label}
        </span>
      </button>
    );
  };

  return (
    <nav aria-label="Main sections" className="md:hidden shrink-0 relative z-30 px-2 pb-2 pt-6 -mt-6 pointer-events-none">
      <div
        className={`pointer-events-auto relative flex items-stretch rounded-[26px] bg-white px-1 shadow-[0_8px_28px_-10px_rgba(1,16,37,0.28)] ${
          isBarangay ? 'border border-[#7EA0C5]/40' : 'border border-neutral-200'
        }`}
      >
        {BAR_TABS.map((item) => {
          const active = !isMenuOpen && isBarActive(item.id, activeTab);
          return slot(item, active, () => go(item.id), { 'aria-current': active ? 'page' : undefined });
        })}
        {slot(
          { id: 'menu', label: 'Menu', icon: LayoutGrid },
          isMenuOpen || inMenuSection,
          () => setIsMenuOpen((open) => !open),
          { 'aria-expanded': isMenuOpen, 'aria-haspopup': 'dialog', 'aria-controls': 'staff-mobile-menu' }
        )}
      </div>

      {/* Dimmed page beside the drawer: a tap on it closes the menu */}
      <div
        className={`fixed inset-0 bg-[#011025]/45 transition-opacity duration-300 ${
          isMenuOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setIsMenuOpen(false)}
        aria-hidden="true"
      />

      {/* Menu drawer, sliding in from the right edge over the page */}
      <div
        id="staff-mobile-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        inert={!isMenuOpen}
        onTouchStart={onDrawerTouchStart}
        onTouchEnd={onDrawerTouchEnd}
        className={`fixed inset-y-0 right-0 w-[86%] max-w-sm flex flex-col bg-white shadow-2xl pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)] transition-[translate,visibility] duration-300 ease-out ${
          isMenuOpen ? 'pointer-events-auto translate-x-0 visible' : 'pointer-events-none translate-x-full invisible'
        } ${isBarangay ? 'border-l border-[#7EA0C5]/40' : 'border-l border-neutral-200'}`}
      >
        {/* Who is signed in, and the close button */}
        <div className={`shrink-0 flex items-center gap-3 px-4 py-4 border-b ${isBarangay ? 'border-[#7EA0C5]/25' : 'border-neutral-100'}`}>
          <div
            className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center font-black text-lg text-white ring-4 ${
              isBarangay ? 'bg-[#052659] ring-[#C2E8FF]/70' : 'bg-[#18181b] ring-neutral-200/80'
            }`}
          >
            {currentUser.full_name ? currentUser.full_name.trim().charAt(0).toUpperCase() : isBarangay ? 'B' : 'L'}
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-black truncate ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
              {currentUser.full_name || (isBarangay ? 'Barangay Official' : 'LDRRMO Officer')}
            </p>
            <span
              className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                isBarangay
                  ? 'bg-[#C2E8FF]/60 text-[#052659] border border-[#7EA0C5]/50'
                  : 'bg-neutral-100 text-neutral-800 border border-neutral-300'
              }`}
            >
              {onExitOps ? 'SUPER ADMIN' : isBarangay ? 'BARANGAY' : 'LDRRMO'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsMenuOpen(false)}
            aria-label="Close menu"
            className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center cursor-pointer ${
              isBarangay ? 'text-[#052659] bg-[#C2E8FF]/30 active:bg-[#C2E8FF]/60' : 'text-neutral-700 bg-neutral-100 active:bg-neutral-200'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Every section that is not in the bar */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 py-2">
          {menuGroups.map((group) => (
            <div key={group.title} className="pb-2">
              <p className={`px-3 pt-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'}`}>
                {group.title}
              </p>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => go(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`w-full h-12 px-3 rounded-2xl flex items-center gap-3.5 text-left text-[15px] cursor-pointer transition-colors ${
                      active
                        ? `font-bold ${isBarangay ? 'bg-[#052659] text-white' : 'bg-[#18181B] text-white'}`
                        : `font-medium ${isBarangay ? 'text-[#011025] active:bg-[#C2E8FF]/40' : 'text-neutral-800 active:bg-neutral-100'}`
                    }`}
                  >
                    <Icon className={`w-[22px] h-[22px] shrink-0 ${active ? 'text-white' : isBarangay ? 'text-[#052659]' : 'text-neutral-700'}`} strokeWidth={1.8} />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {onExitOps && (
          <div className="shrink-0 px-3 pt-3">
            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(false);
                onExitOps();
              }}
              className="w-full h-12 rounded-2xl flex items-center justify-center gap-2 text-sm font-bold text-white bg-gradient-to-r from-[#F6C445] to-[#F2A50F] cursor-pointer"
            >
              Back to Super Admin console
            </button>
          </div>
        )}

        {onSignOut && (
          <div className={`shrink-0 p-3 border-t ${isBarangay ? 'border-[#7EA0C5]/25' : 'border-neutral-100'}`}>
            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(false);
                onSignOut();
              }}
              className={`w-full h-12 rounded-2xl flex items-center justify-center gap-2 text-sm font-bold cursor-pointer transition-colors ${
                isBarangay
                  ? 'text-[#052659] bg-[#C2E8FF]/25 border border-[#7EA0C5]/40 active:bg-[#C2E8FF]/50'
                  : 'text-neutral-800 bg-neutral-50 border border-neutral-200 active:bg-neutral-100'
              }`}
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        )}
      </div>
    </nav>
  );
};
