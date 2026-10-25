import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  Building2,
  PhoneCall,
  Shield,
  LogOut,
  RefreshCw,
  Home,
  HeartHandshake,
  BookOpen,
  HelpCircle,
  Megaphone,
  Package,
  Construction,
  ShieldAlert,
  Layers,
  Users,
  FileText,
  Download,
  UserCheck,
  Search,
  Bell,
  LayoutGrid,
  Waves,
  ChevronLeft,
  ChevronRight,
  X,
  Truck,
  Settings
} from 'lucide-react';
import { User } from '../types';
import { useRepo } from '../hooks/useRepo';
import { t } from '../lib/i18n';
import * as repo from '../services/repo';
import { relTime } from '../lib/util';
import { TriadEmblem, UniGuardLockup, portalForRole } from '../brand';

export interface DashboardSidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: User;
  isOnline: boolean;
  pendingOutboxCount: number;
  onSignOut?: () => void;
  onOpenReportModal?: () => void;
  /** set while a Super Admin is in the operations console; returns to the admin console */
  onExitOps?: () => void;
  /** search results that have a place open there on the dashboard map */
  onShowOnMap?: (lat: number | null, lng: number | null, label: string, reportId?: string) => void;
}

export const DashboardSidebar: React.FC<DashboardSidebarProps> = ({
  activeTab,
  setActiveTab,
  currentUser,
  isOnline,
  pendingOutboxCount,
  onSignOut,
  onOpenReportModal,
  onExitOps,
  onShowOnMap,
}) => {
  const isResident = currentUser.role === 'citizen';

  // Resident Sidebar Minimized State (matching reference image style)
  const [isMinimized, setIsMinimized] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('uniguard_resident_sidebar_minimized') === 'true';
    }
    return false;
  });

  const toggleMinimize = () => {
    setIsMinimized((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('uniguard_resident_sidebar_minimized', String(next));
      }
      return next;
    });
  };

  // LDRRMO Top Bar Right Controls State (Search, Notifications, Menu matching Image 2)
  const [searchQuery, setSearchQuery] = useState('');
  // the search box folds into a round button so the section links keep the room
  const [searchFocused, setSearchFocused] = useState(false);
  const searchOpen = searchFocused || !!searchQuery;
  const [isNotifsOpen, setIsNotifsOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const rightControlsRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // LDRRMO Top Navigation Horizontal Scroll & Dynamic Indicators State
  const navScrollRef = useRef<HTMLDivElement>(null);
  const [isScrolledToLeft, setIsScrolledToLeft] = useState(true);
  const [isScrolledToRight, setIsScrolledToRight] = useState(false);

  const [windowWidth, setWindowWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1200
  );

  // Update scroll boundaries on scroll and resize
  useEffect(() => {
    const el = navScrollRef.current;
    if (!el) return;

    const checkScrollPosition = () => {
      const atLeft = el.scrollLeft <= 2;
      const atRight = Math.ceil(el.scrollLeft + el.clientWidth) >= el.scrollWidth - 2;
      setIsScrolledToLeft(atLeft);
      setIsScrolledToRight(atRight);
    };

    const handleResize = () => {
      setWindowWidth(window.innerWidth);
      checkScrollPosition();
    };

    checkScrollPosition();
    el.addEventListener('scroll', checkScrollPosition, { passive: true });
    window.addEventListener('resize', handleResize);

    return () => {
      el.removeEventListener('scroll', checkScrollPosition);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Live notifications and nav counts from the data store
  const data = useRepo();

  // Search across what this account can see: incidents, shelters, hotlines,
  // advisories and roads. Up to 8 results; Enter opens the first one.
  type Hit = { key: string; kind: string; title: string; detail: string; open: () => void };
  const searchHits = useMemo<Hit[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const has = (...v: (string | null | undefined)[]) => v.some((x) => (x || '').toLowerCase().includes(q));
    const go = (tab: string) => () => {
      setActiveTab(tab);
      setSearchQuery('');
    };
    const hits: Hit[] = [];
    data.reports
      .filter((r) => has(r.code, r.description, r.barangay_name, r.hazard_type, r.hazard_other_text))
      .slice(0, 4)
      .forEach((r) =>
        hits.push({
          key: 'r' + r.id,
          kind: 'Incident',
          title: `${r.code || 'Report'} · ${r.hazard_type}`,
          detail: `${r.barangay_name} · ${r.status}`,
          open: () => {
            if (onShowOnMap) onShowOnMap(r.has_location ? r.latitude : null, r.has_location ? r.longitude : null, r.code || 'Incident', r.id);
            else setActiveTab('incidents');
            setSearchQuery('');
          },
        })
      );
    data.centers
      .filter((c) => has(c.name, c.barangay_name, c.address))
      .slice(0, 2)
      .forEach((c) =>
        hits.push({
          key: 'c' + c.id,
          kind: 'Shelter',
          title: c.name,
          detail: `${c.barangay_name} · ${c.current_occupancy}/${c.capacity} · ${c.status}`,
          open: () => {
            if (onShowOnMap && c.has_location) onShowOnMap(c.latitude, c.longitude, c.name);
            else setActiveTab('shelters');
            setSearchQuery('');
          },
        })
      );
    data.hotlines
      .filter((h) => has(h.agency_name, h.contact_number, h.scope))
      .slice(0, 2)
      .forEach((h) => hits.push({ key: 'h' + h.id, kind: 'Hotline', title: h.agency_name, detail: h.contact_number, open: go('hotlines') }));
    data.advisories
      .filter((a) => has(a.title, a.content, a.affected_area))
      .slice(0, 2)
      .forEach((a) => hits.push({ key: 'a' + a.id, kind: 'Advisory', title: a.title, detail: a.affected_area, open: go('advisories') }));
    data.roadStatus
      .filter((r) => has(r.road_name, r.barangay, r.note))
      .slice(0, 2)
      .forEach((r) => hits.push({ key: 'rs' + r.id, kind: 'Road', title: r.road_name, detail: `${r.barangay || 'Municipality-wide'} · ${r.status}`, open: go('road_work') }));
    return hits.slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, data.reports, data.centers, data.hotlines, data.advisories, data.roadStatus]);
  const unreadCount = data.notifications.filter((n) => n.unread).length;
  const ldrrmoNotifications = data.notifications.slice(0, 8).map((n) => ({
    id: n.id,
    title: n.title,
    time: relTime(n.created_at),
  }));
  const liveAdvisoryCount = data.advisories.filter((a) => a.severity !== 'low').length;
  const openShelterCount = data.centers.filter((c) => c.status === 'open').length;
  const isLgu = currentUser.role === 'lgu_admin';

  // Close popups on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (rightControlsRef.current && !rightControlsRef.current.contains(e.target as Node)) {
        setIsNotifsOpen(false);
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard shortcut listener (⌘K / Ctrl+K / Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setIsNotifsOpen(false);
        setIsMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Navigation Items exclusively for the Resident Portal: Home, Relief, Shelters, Hotlines
  const residentNavItems = [
    {
      id: 'home',
      label: 'Home',
      shortLabel: 'Home',
      icon: Home,
      badge: null,
    },
    {
      id: 'relief',
      label: 'Relief',
      shortLabel: 'Relief',
      icon: HeartHandshake,
      badge: null,
    },
    {
      id: 'shelters',
      label: 'Shelters',
      shortLabel: 'Shelters',
      icon: Building2,
      badge: null,
    },
    {
      id: 'hotlines',
      label: 'Hotlines',
      shortLabel: 'Hotlines',
      icon: PhoneCall,
      badge: null,
    },
    {
      id: 'settings',
      label: 'Settings',
      shortLabel: 'Settings',
      icon: Settings,
      badge: null,
    },
  ];

  // Navigation Items for Admin and Operations Staff (matching initial draft screenshot)
  const adminNavItems = [
    {
      id: 'home',
      label: 'Home',
      shortLabel: 'Home',
      icon: Home,
      badge: null,
    },
    {
      id: 'incidents',
      label: 'Incidents',
      shortLabel: 'Incidents',
      icon: AlertTriangle,
      badge: null,
    },
    {
      id: 'advisories',
      label: 'Advisories',
      shortLabel: 'Advisories',
      icon: Megaphone,
      badge: liveAdvisoryCount ? String(liveAdvisoryCount) : null,
    },
    {
      id: 'relief',
      label: 'Relief',
      shortLabel: 'Relief',
      icon: Package,
      badge: null,
    },
    {
      id: 'shelters',
      label: 'Shelters',
      shortLabel: 'Shelters',
      icon: Building2,
      badge: openShelterCount ? String(openShelterCount) : null,
    },
    {
      id: 'road_work',
      label: 'Road Work',
      shortLabel: 'Roads',
      icon: Construction,
      badge: null,
    },
    {
      id: 'sos_log',
      label: 'SOS Log',
      shortLabel: 'SOS',
      icon: ShieldAlert,
      badge: null,
    },
    {
      id: 'hotlines',
      label: 'Hotlines',
      shortLabel: 'Hotlines',
      icon: PhoneCall,
      badge: null,
    },
    {
      id: 'analytics',
      label: 'Analytics',
      shortLabel: 'Analytics',
      icon: Layers,
      badge: null,
    },
    // LDRRMO and the Super Admin in Operations: dispatch units sit in the top bar
    ...(isLgu
      ? [
          {
            id: 'dispatch_units',
            label: 'Dispatch Units',
            shortLabel: 'Dispatch',
            icon: Truck,
            badge: null,
          },
        ]
      : []),
  ];

  const navItems = isResident ? residentNavItems : adminNavItems;

  // LDRRMO & Barangay Portal Top Navigation Bar (matching reference image style transfer)
  if (!isResident) {
    const isBarangay = currentUser.role === 'barangay';

    return (
      <header className={`w-full px-3 sm:px-5 py-2 sm:py-2.5 flex flex-wrap lg:flex-nowrap items-center justify-between gap-1.5 sm:gap-2.5 backdrop-blur-md shrink-0 z-30 transition-colors ${
        isBarangay
          ? 'bg-[#f4f7fb]/95 border-b border-[#7EA0C5]/30'
          : 'bg-[#f4f4f6]/95 border-b border-gray-200/70'
      }`}>
        {/* Brand/Logo (Left): Style the brand name container as a thin, outlined pill */}
        <div className={`rounded-full px-3 sm:px-4 py-1.5 flex items-center gap-2 min-w-0 shrink max-w-[calc(100%-8rem)] sm:max-w-none transition-all ${
          isBarangay
            ? 'border border-[#7EA0C5]/40 bg-white/70 shadow-2xs'
            : 'border border-gray-300 bg-transparent'
        }`}>
          {/* Emblem and chip always show; the wordmark joins from sm up */}
          <UniGuardLockup
            layout="compact"
            portal={onExitOps ? 'admin' : isBarangay ? 'barangay' : 'command'}
            size={26}
            context={{ barangayName: currentUser.barangay_name }}
            // in Operations the gold and the SUPER ADMIN tag mark the portal, so the
            // wordmark gives its room to the section links on narrower laptops
            wordmarkClassName={onExitOps ? 'hidden min-[1366px]:inline' : 'hidden sm:inline'}
          />
          {/* Super Admin in the operations console: the way back to the admin console */}
          {onExitOps && (
            <button
              type="button"
              onClick={onExitOps}
              title="Back to the Super Admin console"
              aria-label="Back to the Super Admin console"
              className="hidden md:inline-flex items-center justify-center gap-1 h-7 w-7 2xl:w-auto 2xl:px-3 rounded-full text-[11px] font-bold text-white bg-gradient-to-r from-[#F6C445] to-[#F2A50F] shadow-2xs cursor-pointer shrink-0"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              {/* the label shows on wide screens; elsewhere the arrow keeps the room for the section links */}
              <span className="hidden 2xl:inline">Admin console</span>
            </button>
          )}
        </div>

        {/* Navigation Links: Visibly organized container with horizontal scroll and dynamic fade masks */}
        <div className={`relative hidden md:block flex-1 min-w-0 order-last lg:order-none basis-full lg:basis-0 max-w-full lg:max-w-[760px] xl:max-w-[860px] shrink rounded-full backdrop-blur-xs shadow-2xs p-1 overflow-hidden mx-0 lg:mx-2.5 ${
          isBarangay
            ? 'bg-white/80 border border-[#7EA0C5]/40'
            : 'bg-white/70 border border-gray-200/60'
        }`}>
          {/* Dynamic Left Gradient Fade Indicator (rendered when not at leftmost position) */}
          {!isScrolledToLeft && (
            <div
              className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 sm:w-10 bg-gradient-to-r from-white via-white/90 to-transparent rounded-l-full z-10 transition-opacity duration-200"
              aria-hidden="true"
            />
          )}

          {/* Horizontally Scrollable Nav Container */}
          <nav
            ref={navScrollRef}
            className="flex items-center gap-0.5 overflow-x-auto whitespace-nowrap scroll-smooth [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] px-1"
          >
            {adminNavItems.map((item) => {
              const isActive =
                activeTab === item.id ||
                (item.id === 'home' && (activeTab === 'overview' || activeTab === 'home')) ||
                (item.id === 'overview' && (activeTab === 'home' || activeTab === 'overview')) ||
                (item.id === 'incidents' && (activeTab === 'feed' || activeTab === 'triage'));

              return isActive ? (
                /* Active Tab State: Solid dark pill */
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.id === 'home') setActiveTab('overview');
                    else setActiveTab(item.id);
                  }}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 font-medium text-xs shadow-xs transition-all whitespace-nowrap [text-overflow:clip] flex items-center gap-1.5 cursor-pointer ${
                    isBarangay
                      ? 'bg-[#052659] text-white hover:bg-[#5482B4]'
                      : 'bg-[#2A2A2A] text-white'
                  }`}
                >
                  <span className="[text-overflow:clip]">{t(windowWidth < 1440 ? item.shortLabel : item.label)}</span>
                  {item.badge && (
                    <span className="bg-white/20 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full shrink-0">
                      {item.badge}
                    </span>
                  )}
                </button>
              ) : (
                /* Inactive Tab State: Plain muted text */
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.id === 'home') setActiveTab('overview');
                    else setActiveTab(item.id);
                  }}
                  className={`shrink-0 font-medium px-2.5 py-1.5 text-xs transition-colors whitespace-nowrap [text-overflow:clip] flex items-center gap-1.5 cursor-pointer rounded-full ${
                    isBarangay
                      ? 'text-[#5482B4] hover:text-[#011025] hover:bg-[#C2E8FF]/30'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-black/5'
                  }`}
                >
                  <span className="[text-overflow:clip]">{t(windowWidth < 1440 ? item.shortLabel : item.label)}</span>
                  {item.badge && (
                    <span className={`text-[10px] font-medium px-1.5 py-0.2 rounded-full shrink-0 ${
                      isBarangay
                        ? 'bg-[#C2E8FF]/60 text-[#052659]'
                        : 'bg-neutral-200 text-neutral-700'
                    }`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Dynamic Right Gradient Fade Indicator (rendered when not at rightmost position) */}
          {!isScrolledToRight && (
            <div
              className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 sm:w-10 bg-gradient-to-l from-white via-white/90 to-transparent rounded-r-full z-10 transition-opacity duration-200"
              aria-hidden="true"
            />
          )}
        </div>

        {/* Right Controls: "search incidents, responders, or locations", notifications, and menu */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0" ref={rightControlsRef}>
          {/* Search Input Box with organized, responsive width */}
          <div className="relative hidden md:flex items-center min-w-0">
            <div
              onClick={() => searchInputRef.current?.focus()}
              title={searchOpen ? undefined : 'Search (⌘K)'}
              className={`flex items-center gap-1.5 sm:gap-2 h-8.5 sm:h-9.5 rounded-full text-xs shadow-2xs transition-all min-w-0 cursor-text ${
                searchOpen ? 'px-3 sm:px-3.5 w-56 xl:w-64' : 'w-8.5 sm:w-9.5 justify-center px-0 cursor-pointer'
              } ${
              isBarangay
                ? 'border border-[#7EA0C5]/40 bg-white hover:bg-[#C2E8FF]/15 focus-within:bg-white focus-within:border-[#052659] focus-within:ring-1 focus-within:ring-[#052659]/30 text-[#011025]'
                : 'border border-gray-200/90 bg-white hover:bg-neutral-50/80 focus-within:bg-white focus-within:border-neutral-400 focus-within:ring-1 focus-within:ring-neutral-400/50 text-neutral-700'
            }`}>
              <Search className={`w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'}`} />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onFocus={() => setSearchFocused(true)}
                // a short delay lets a click on a result land before the box folds
                onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchHits[0]) searchHits[0].open();
                  if (e.key === 'Escape') setSearchQuery('');
                }}
                aria-label="Search incidents, shelters, hotlines, advisories and roads"
                placeholder={
                  windowWidth < 640
                    ? 'Search...'
                    : windowWidth < 1024
                    ? 'Search incidents...'
                    : 'Search incidents, responders...'
                }
                className={`${searchOpen ? 'w-full' : 'w-0 opacity-0 absolute'} min-w-0 bg-transparent text-xs focus:outline-none truncate ${
                  isBarangay ? 'text-[#011025] placeholder:text-[#7EA0C5]' : 'text-neutral-800 placeholder:text-neutral-400'
                }`}
              />
              {!searchOpen ? null : searchQuery ? (
                <button
                  onClick={() => setSearchQuery('')}
                  className={`${isBarangay ? 'text-[#7EA0C5] hover:text-[#011025]' : 'text-neutral-400 hover:text-neutral-600'} p-0.5 cursor-pointer shrink-0`}
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : (
                <kbd className={`hidden lg:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono rounded shrink-0 pointer-events-none select-none ${
                  isBarangay
                    ? 'text-[#5482B4] bg-[#C2E8FF]/40 border border-[#7EA0C5]/40'
                    : 'text-neutral-400 bg-neutral-100 border border-neutral-200/80'
                }`}>
                  ⌘K
                </kbd>
              )}
            </div>
            {searchQuery.trim().length >= 2 && (
              <div
                role="listbox"
                className={`absolute top-full right-0 mt-2 w-80 max-w-[90vw] rounded-2xl bg-white shadow-xl border z-50 overflow-hidden ${
                  isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200'
                }`}
              >
                {searchHits.length === 0 ? (
                  <p className={`px-4 py-3 text-xs ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>Nothing matches “{searchQuery.trim()}”.</p>
                ) : (
                  searchHits.map((h) => (
                    <button
                      key={h.key}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={h.open}
                      className={`w-full text-left px-4 py-2.5 flex items-start gap-3 cursor-pointer ${isBarangay ? 'hover:bg-[#C2E8FF]/25' : 'hover:bg-neutral-50'}`}
                    >
                      <span
                        className={`mt-0.5 shrink-0 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider ${
                          isBarangay ? 'bg-[#C2E8FF]/60 text-[#052659]' : 'bg-neutral-100 text-neutral-600'
                        }`}
                      >
                        {h.kind}
                      </span>
                      <span className="min-w-0">
                        <span className={`block text-xs font-semibold truncate ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>{h.title}</span>
                        <span className={`block text-[11px] truncate ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>{h.detail}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Live Feed Indicator (Beside Notifications Bell, non-clickable, compact organized pill) */}
          <div
            className={`h-8.5 sm:h-9.5 px-2.5 sm:px-3 rounded-full shadow-2xs flex items-center justify-center gap-1.5 text-[11px] sm:text-xs font-semibold select-none cursor-default shrink-0 ${
              isBarangay
                ? 'bg-white text-[#052659] border border-[#7EA0C5]/40'
                : 'bg-white text-neutral-700 border border-gray-200/90'
            }`}
            title="Live feed"
            aria-label="Live feed"
          >
            <Waves className={`w-3.5 h-3.5 shrink-0 ${isBarangay ? 'text-[#052659]' : 'text-neutral-700'}`} />
            <span className="whitespace-nowrap hidden 2xl:inline">Live feed</span>
          </div>

          {/* Notifications Button with Badge 4 */}
          <div className="relative">
            <button
              onClick={() => {
                repo.enablePush();
                setIsNotifsOpen((prev) => !prev);
                setIsMenuOpen(false);
              }}
              className={`w-8.5 h-8.5 sm:w-9.5 sm:h-9.5 rounded-full bg-white shadow-2xs flex items-center justify-center transition-all cursor-pointer relative ${
                isBarangay
                  ? `border border-[#7EA0C5]/40 hover:bg-[#C2E8FF]/20 ${isNotifsOpen ? 'ring-2 ring-[#052659]' : ''}`
                  : `border border-gray-200/90 hover:bg-neutral-50 ${isNotifsOpen ? 'ring-2 ring-neutral-400' : ''}`
              }`}
              title="Notifications"
              aria-label="Notifications"
            >
              <Bell className={`w-4 h-4 ${isBarangay ? 'text-[#052659]' : 'text-neutral-700'}`} />
              {unreadCount > 0 && (
                <span className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white ${
                  isBarangay ? 'bg-[#052659]' : 'bg-[#18181b]'
                }`}>
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Notifications Dropdown */}
            {isNotifsOpen && (
              <div className={`absolute right-0 mt-2 w-80 max-sm:fixed max-sm:left-3 max-sm:right-3 max-sm:top-12 max-sm:mt-0 max-sm:w-auto bg-white rounded-2xl shadow-xl py-2 z-50 animate-in fade-in zoom-in-95 duration-150 overflow-hidden ${
                isBarangay ? 'border border-[#7EA0C5]/30' : 'border border-gray-200'
              }`}>
                <div className={`px-3.5 py-2 border-b flex items-center justify-between ${
                  isBarangay ? 'border-[#7EA0C5]/20' : 'border-gray-100'
                }`}>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-bold ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>Notifications</span>
                    {unreadCount > 0 && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                        isBarangay ? 'bg-[#C2E8FF]/60 text-[#052659]' : 'bg-neutral-100 text-neutral-700'
                      }`}>
                        {unreadCount} new
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => repo.markAllRead().catch(() => {})}
                    className={`text-[11px] font-medium cursor-pointer ${
                      isBarangay ? 'text-[#5482B4] hover:text-[#011025]' : 'text-neutral-500 hover:text-neutral-900'
                    }`}
                  >
                    Mark all read
                  </button>
                </div>

                <div className={`max-h-64 overflow-y-auto py-1 divide-y ${
                  isBarangay ? 'divide-[#7EA0C5]/10' : 'divide-gray-50'
                }`}>
                  {ldrrmoNotifications.map((notif) => (
                    <div
                      key={notif.id}
                      onClick={() => {
                        repo.markRead(notif.id).catch(() => {});
                        setActiveTab('notifications');
                        setIsNotifsOpen(false);
                      }}
                      className={`px-3.5 py-2.5 transition-colors cursor-pointer ${
                        isBarangay ? 'hover:bg-[#C2E8FF]/20' : 'hover:bg-neutral-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-xs font-medium leading-snug ${
                          isBarangay ? 'text-[#011025]' : 'text-neutral-800'
                        }`}>{notif.title}</p>
                        <span className={`text-[10px] whitespace-nowrap ${
                          isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'
                        }`}>{notif.time}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className={`pt-2 pb-1 px-3 border-t ${
                  isBarangay ? 'border-[#7EA0C5]/20 bg-[#C2E8FF]/15' : 'border-gray-100 bg-neutral-50/50'
                }`}>
                  <button
                    onClick={() => {
                      setActiveTab('notifications');
                      setIsNotifsOpen(false);
                    }}
                    className={`w-full text-center py-1 text-xs font-medium transition-colors cursor-pointer ${
                      isBarangay ? 'text-[#052659] hover:text-[#5482B4]' : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    View push notification log →
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Menu Button (LayoutGrid). On phones the menu lives in the bottom bar instead. */}
          <div className="relative hidden md:block">
            <button
              onClick={() => {
                setIsMenuOpen((prev) => !prev);
                setIsNotifsOpen(false);
              }}
              className={`w-8.5 h-8.5 sm:w-9.5 sm:h-9.5 rounded-full bg-white shadow-2xs flex items-center justify-center transition-all cursor-pointer ${
                isBarangay
                  ? `border border-[#7EA0C5]/40 hover:bg-[#C2E8FF]/20 ${isMenuOpen ? 'ring-2 ring-[#052659]' : ''}`
                  : `border border-gray-200/90 hover:bg-neutral-50 ${isMenuOpen ? 'ring-2 ring-neutral-400' : ''}`
              }`}
              title="Menu"
              aria-label="Menu"
            >
              <LayoutGrid className={`w-4 h-4 ${isBarangay ? 'text-[#052659]' : 'text-neutral-700'}`} />
            </button>

            {/* Menu Dropdown */}
            {isMenuOpen && (
              <div className={`absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-xl p-2 z-50 animate-in fade-in zoom-in-95 duration-150 space-y-1 ${
                isBarangay ? 'border border-[#7EA0C5]/30' : 'border border-gray-200'
              }`}>
                {/* User Profile Card inside Menu - Centered (Matching Resident Portal with Designated Color Palette) */}
                <div className={`flex flex-col items-center justify-center text-center p-3.5 rounded-2xl mb-2 ${
                  isBarangay
                    ? 'bg-[#C2E8FF]/20 border border-[#7EA0C5]/30'
                    : 'bg-neutral-50 border border-neutral-200/80'
                }`}>
                  <div className={`w-14 h-14 rounded-full flex items-center justify-center font-black text-xl mb-2 shadow-xs ring-4 ${
                    isBarangay
                      ? 'bg-[#052659] text-white ring-[#C2E8FF]/70 border border-[#011025]/20'
                      : 'bg-[#18181b] text-white ring-neutral-200/80 border border-neutral-800/20'
                  }`}>
                    {currentUser?.full_name ? currentUser.full_name.trim().charAt(0).toUpperCase() : (isBarangay ? 'B' : 'L')}
                  </div>
                  <p className={`text-sm font-black truncate max-w-full px-1 ${
                    isBarangay ? 'text-[#011025]' : 'text-neutral-900'
                  }`}>
                    {currentUser?.full_name || (isBarangay ? 'Barangay Official' : 'LDRRMO Officer')}
                  </p>
                  <span className={`inline-block mt-1 px-3 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                    isBarangay
                      ? 'bg-[#C2E8FF]/60 text-[#052659] border border-[#7EA0C5]/50'
                      : 'bg-neutral-100 text-neutral-800 border border-neutral-300'
                  }`}>
                    {onExitOps ? 'SUPER ADMIN' : isBarangay ? 'BARANGAY' : 'LDRRMO'}
                  </span>
                </div>

                {/* Preparedness Guides */}
                <button
                  onClick={() => {
                    setActiveTab('guides');
                    setIsMenuOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left text-xs font-semibold rounded-xl flex items-center gap-2.5 transition-colors cursor-pointer ${
                    isBarangay ? 'text-[#011025] hover:bg-[#C2E8FF]/30' : 'text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  <BookOpen className={`w-4 h-4 ${isBarangay ? 'text-[#052659]' : 'text-neutral-800'}`} />
                  <span>Preparedness Guides</span>
                </button>

                {/* FAQs */}
                <button
                  onClick={() => {
                    setActiveTab('faqs');
                    setIsMenuOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left text-xs font-semibold rounded-xl flex items-center gap-2.5 transition-colors cursor-pointer ${
                    isBarangay ? 'text-[#011025] hover:bg-[#C2E8FF]/30' : 'text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  <HelpCircle className={`w-4 h-4 ${isBarangay ? 'text-[#052659]' : 'text-neutral-800'}`} />
                  <span>FAQs</span>
                </button>

                {/* Others Review */}
                {isLgu && (
                  <button
                    onClick={() => {
                      setActiveTab('others_review');
                      setIsMenuOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left text-xs font-semibold rounded-xl flex items-center gap-2.5 transition-colors cursor-pointer ${
                      isBarangay ? 'text-[#011025] hover:bg-[#C2E8FF]/30' : 'text-neutral-700 hover:bg-neutral-100'
                    }`}
                  >
                    <UserCheck className={`w-4 h-4 ${isBarangay ? 'text-[#052659]' : 'text-neutral-800'}`} />
                    <span>Others Review</span>
                  </button>
                )}

                {/* Users and the Activity Log are Super Admin screens, in the Super Admin console */}

                {/* Reports & documentation: situation reports, damage assessments, incident summaries */}
                <button
                  onClick={() => {
                    setActiveTab('reports');
                    setIsMenuOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left text-xs font-semibold rounded-xl flex items-center gap-2.5 transition-colors cursor-pointer ${
                    isBarangay ? 'text-[#011025] hover:bg-[#C2E8FF]/30' : 'text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  <FileText className={`w-4 h-4 ${isBarangay ? 'text-[#052659]' : 'text-neutral-800'}`} />
                  <span>Reports & Documents</span>
                </button>

                {/* Offline Sync */}
                <button
                  onClick={() => {
                    setActiveTab('offline_sync');
                    setIsMenuOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left text-xs font-semibold rounded-xl flex items-center gap-2.5 transition-colors cursor-pointer ${
                    isBarangay ? 'text-[#011025] hover:bg-[#C2E8FF]/30' : 'text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  <Download className={`w-4 h-4 ${isBarangay ? 'text-[#052659]' : 'text-neutral-800'}`} />
                  <span>Offline Sync</span>
                </button>

                {/* Settings: alerts, language, offline, templates */}
                <button
                  onClick={() => {
                    setActiveTab('settings');
                    setIsMenuOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left text-xs font-semibold rounded-xl flex items-center gap-2.5 transition-colors cursor-pointer ${
                    isBarangay ? 'text-[#011025] hover:bg-[#C2E8FF]/30' : 'text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  <Settings className={`w-4 h-4 ${isBarangay ? 'text-[#052659]' : 'text-neutral-800'}`} />
                  <span>{t('Settings')}</span>
                </button>

                {onSignOut && (
                  <div className={`pt-1 border-t mt-1 ${isBarangay ? 'border-[#7EA0C5]/20' : 'border-gray-100'}`}>
                    <button
                      onClick={() => {
                        onSignOut();
                        setIsMenuOpen(false);
                      }}
                      className="w-full px-3 py-2 text-left text-xs font-semibold text-red-600 hover:bg-red-50 rounded-xl flex items-center gap-2.5 transition-colors cursor-pointer"
                    >
                      <LogOut className="w-4 h-4 text-red-500" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
    );
  }

  return (
    <aside className={`rounded-[28px] sm:rounded-[32px] m-2 sm:m-3 lg:m-4 flex flex-col justify-between shrink-0 relative overflow-hidden z-20 h-[calc(100%-1rem)] sm:h-[calc(100%-1.5rem)] lg:h-[calc(100%-2rem)] transition-all duration-300 ease-in-out ${
      isResident
        ? `${isMinimized ? 'w-20' : 'w-full lg:w-60 xl:w-64'} bg-[#991B1B] text-white border border-rose-900/30 shadow-2xl`
        : 'w-full lg:w-64 xl:w-72 bg-white text-neutral-800 border border-neutral-200/70 shadow-xs'
    }`}>
      {/* Top Header & Brand Lockup */}
      {isResident && isMinimized ? (
        <div className="pt-5 pb-2 px-2 flex flex-col items-center relative z-10 shrink-0">
          {/* Centered Triad Shield, reversed on the crimson sidebar */}
          <TriadEmblem portal="resident" variant="reverse" size={36} className="shrink-0 transition-transform hover:scale-105" />

          {/* Lingayen below the logo */}
          <span className="text-[8px] uppercase font-bold tracking-wider text-rose-200 mt-1">
            Lingayen
          </span>

          {/* Expand Button between logo and home */}
          <button
            onClick={toggleMinimize}
            className="w-6 h-6 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-all cursor-pointer border border-white/20 shadow-xs mt-3 mb-1"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : isResident ? (
        <div className="pt-5 px-4 flex flex-col items-center text-center relative z-10 shrink-0">
          {/* Stacked brand lockup: emblem, wordmark and the resident's barangay chip */}
          <UniGuardLockup
            layout="stacked"
            portal="resident"
            variant="reverse"
            size={52}
            descriptor={null}
            context={{ barangayName: currentUser.barangay_name }}
          />

          {/* The triangle (indication for minimizing) between the logo and the home */}
          <div className="mt-3.5 w-full flex items-center justify-end px-1">
            <div className="h-px flex-1 bg-white/15 mr-2.5" />
            <button
              onClick={toggleMinimize}
              className="w-6 h-6 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-all cursor-pointer border border-white/20 shadow-xs"
              title="Minimize sidebar"
              aria-label="Minimize sidebar"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ) : (
        /* Fallback header for non-resident vertical view */
        <div className="pt-5 sm:pt-6 px-4 flex flex-col items-center text-center relative z-10 shrink-0">
          <UniGuardLockup
            layout="compact"
            portal={portalForRole(currentUser.role)}
            context={{ barangayName: currentUser.barangay_name }}
          />
          <div className="w-full h-px my-3 bg-neutral-100" />
        </div>
      )}

      {/* Navigation Items with extra space before Home */}
      <nav className={`flex-1 min-h-0 pt-4 pb-2 relative z-10 overflow-y-auto no-scrollbar ${
        isResident && isMinimized
          ? 'px-2 flex flex-col items-center space-y-2'
          : 'px-3 space-y-1.5'
      }`}>
        {navItems.map((item) => {
          const isActive =
            activeTab === item.id ||
            (item.id === 'home' && (activeTab === 'overview' || activeTab === 'home')) ||
            (item.id === 'overview' && (activeTab === 'home' || activeTab === 'overview')) ||
            (item.id === 'incidents' && (activeTab === 'feed' || activeTab === 'triage'));
          const Icon = item.icon;

          if (isResident && isMinimized) {
            return (
              <div key={item.id} className="relative group">
                <button
                  onClick={() => {
                    if (item.id === 'home') setActiveTab('overview');
                    else setActiveTab(item.id);
                  }}
                  className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-all duration-200 cursor-pointer ${
                    isActive
                      ? 'bg-white text-[#991B1B] shadow-[0_4px_16px_rgba(0,0,0,0.15)] font-bold'
                      : 'text-white/85 hover:text-white hover:bg-white/10'
                  }`}
                  title={t(item.label)}
                  aria-label={t(item.label)}
                >
                  <Icon className={`w-5 h-5 shrink-0 transition-colors ${
                    isActive ? 'text-[#991B1B]' : 'text-rose-100'
                  }`} />
                </button>

                {/* Floating Tooltip in minimized mode */}
                <div className="opacity-0 group-hover:opacity-100 pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2.5 py-1 bg-black/90 text-white text-xs font-semibold rounded-lg shadow-xl whitespace-nowrap z-50 transition-opacity duration-150">
                  {t(item.label)}
                </div>
              </div>
            );
          }

          return (
            <button
              key={item.id}
              onClick={() => {
                if (item.id === 'home') setActiveTab('overview');
                else setActiveTab(item.id);
              }}
              className={`w-full rounded-2xl py-2.5 px-3.5 flex items-center justify-between text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer text-left ${
                isActive
                  ? isResident
                    ? 'bg-white text-[#991B1B] shadow-[0_4px_16px_rgba(0,0,0,0.15)] font-bold'
                    : 'bg-neutral-900 text-white font-bold'
                  : isResident
                  ? 'text-white/85 hover:text-white hover:bg-white/10'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Icon className={`w-4 h-4 shrink-0 transition-colors ${
                  isActive
                    ? isResident ? 'text-[#991B1B]' : 'text-white'
                    : isResident ? 'text-rose-100' : 'text-neutral-400'
                }`} />
                <span className="truncate">{t(item.label)}</span>
              </div>

              {item.badge && (
                <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-full shrink-0 ml-1 ${
                  isActive
                    ? isResident ? 'bg-rose-100 text-[#991B1B]' : 'bg-neutral-800 text-white'
                    : isResident ? 'bg-black/25 text-rose-100' : 'bg-neutral-100 text-neutral-600'
                }`}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom Decorative Motif: Clean minimal organic multi-layered waves in red */}
      <div
        className="absolute bottom-0 left-0 right-0 w-full h-36 sm:h-40 pointer-events-none z-0 overflow-hidden select-none"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 360 140"
          preserveAspectRatio="none"
          className="w-full h-full"
        >
          <defs>
            <linearGradient id="sidebarWaveGrad1" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={isResident ? '#7F1D1D' : '#e4e4e7'} stopOpacity={isResident ? '0.45' : '0.3'} />
              <stop offset="100%" stopColor={isResident ? '#5F0E1E' : '#d4d4d8'} stopOpacity={isResident ? '0.6' : '0.4'} />
            </linearGradient>
            <linearGradient id="sidebarWaveGrad2" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={isResident ? '#881337' : '#d4d4d8'} stopOpacity={isResident ? '0.5' : '0.35'} />
              <stop offset="100%" stopColor={isResident ? '#4C0519' : '#a1a1aa'} stopOpacity={isResident ? '0.65' : '0.45'} />
            </linearGradient>
            <linearGradient id="sidebarWaveGrad3" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={isResident ? '#991B1B' : '#e4e4e7'} stopOpacity={isResident ? '0.55' : '0.4'} />
              <stop offset="100%" stopColor={isResident ? '#450A0A' : '#cbd5e1'} stopOpacity={isResident ? '0.7' : '0.5'} />
            </linearGradient>
            <linearGradient id="sidebarWaveGrad4" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={isResident ? '#831843' : '#cbd5e1'} stopOpacity={isResident ? '0.6' : '0.45'} />
              <stop offset="100%" stopColor={isResident ? '#3B0715' : '#94a3b8'} stopOpacity={isResident ? '0.8' : '0.55'} />
            </linearGradient>
            <linearGradient id="sidebarWaveGrad5" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={isResident ? '#4C0519' : '#94a3b8'} stopOpacity={isResident ? '0.75' : '0.5'} />
              <stop offset="100%" stopColor={isResident ? '#240209' : '#64748b'} stopOpacity={isResident ? '0.9' : '0.65'} />
            </linearGradient>
          </defs>

          {/* Layer 1 - Deep background swell */}
          <path
            d="M 0 38 C 70 20, 140 54, 220 30 C 275 14, 320 28, 360 22 L 360 140 L 0 140 Z"
            fill="url(#sidebarWaveGrad1)"
          />

          {/* Layer 2 - Mid-back rolling wave */}
          <path
            d="M 0 58 C 85 40, 160 70, 245 48 C 295 34, 335 46, 360 40 L 360 140 L 0 140 Z"
            fill="url(#sidebarWaveGrad2)"
          />

          {/* Layer 3 - Central crest swell */}
          <path
            d="M 0 76 C 65 60, 135 88, 210 66 C 265 50, 310 62, 360 56 L 360 140 L 0 140 Z"
            fill="url(#sidebarWaveGrad3)"
          />

          {/* Layer 4 - Mid-foreground smooth wave */}
          <path
            d="M 0 96 C 90 82, 175 106, 260 84 C 305 72, 335 80, 360 76 L 360 140 L 0 140 Z"
            fill="url(#sidebarWaveGrad4)"
          />

          {/* Layer 5 - Foreground base grounding wave */}
          <path
            d="M 0 114 C 75 102, 150 122, 230 106 C 285 94, 325 102, 360 98 L 360 140 L 0 140 Z"
            fill="url(#sidebarWaveGrad5)"
          />
        </svg>
      </div>
    </aside>
  );
};
