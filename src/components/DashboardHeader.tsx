import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  ChevronDown,
  Filter,
  AlertTriangle,
  Menu,
  X,
  Radio,
  Check,
  Search,
  Sparkles,
  LayoutGrid,
  Bell,
  User as UserIcon,
  LogOut,
  Plus,
  Phone,
  CheckCircle2,
  Clock,
  ChevronRight,
  Eye,
  ShieldAlert,
  PhoneCall,
  BookOpen,
  HelpCircle,
  UserCheck,
  Users,
  FileText,
  Download,
  ShieldCheck
} from 'lucide-react';
import { Barangay, User } from '../types';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import { fmtCoords, locate } from '../lib/geo';
import { absTime } from '../lib/util';

export interface LguNotificationItem {
  id: string;
  citizenName: string;
  phoneNumber: string;
  barangay: string;
  distance?: string;
  timeAgo: string;
  timestamp: string;
  isNew: boolean;
  isRead: boolean;
  locationStatus?: string;
  notes?: string;
}

const formatRelativeTime = (isoString: string) => {
  const diffMs = Date.now() - new Date(isoString).getTime();
  if (diffMs < 0) return 'just now';
  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  if (totalMinutes < 1) return 'just now';
  if (totalMinutes < 60) return `${totalMinutes}m ago`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m ago` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

export interface DashboardHeaderProps {
  activeTab?: string;
  topView?: 'Overview' | 'Trends' | 'Analytics';
  setTopView?: (view: 'Overview' | 'Trends' | 'Analytics') => void;
  selectedBarangay: string;
  setSelectedBarangay: (b: string) => void;
  barangays: Barangay[];
  onOpenExportModal?: () => void;
  onOpenReportModal: () => void;
  onToggleMobileSidebar?: () => void;
  isOnline: boolean;
  totalActiveHazards: number;
  currentUser?: User;
  onSignOut?: () => void;
  setActiveTab?: (tab: string) => void;
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  activeTab = 'home',
  topView,
  setTopView,
  selectedBarangay,
  setSelectedBarangay,
  barangays,
  onOpenExportModal,
  onOpenReportModal,
  onToggleMobileSidebar,
  isOnline,
  totalActiveHazards,
  currentUser,
  onSignOut,
  setActiveTab,
}) => {
  const isResident = currentUser?.role === 'citizen' || currentUser?.role === 'barangay';

  const getNavTitle = (tab?: string): string => {
    switch (tab) {
      case 'overview':
      case 'home':
        return 'Home';
      case 'relief':
        return 'Relief';
      case 'shelters':
        return 'Shelters';
      case 'hotlines':
        return 'Hotlines';
      case 'sos':
        return 'Emergency SOS';
      case 'offline_sync':
        return 'Offline Sync';
      case 'notifications':
        return 'Notifications';
      case 'incidents':
      case 'feed':
      case 'triage':
        return 'Incidents';
      case 'advisories':
        return 'Advisories';
      case 'road_work':
        return 'Road Work';
      case 'sos_log':
        return 'SOS Log';
      case 'analytics':
        return 'Analytics';
      case 'guides':
        return 'Preparedness Guides';
      case 'faqs':
        return 'FAQs';
      case 'others_review':
        return 'Others Review';
      case 'users':
        return 'Users';
      case 'audit_log':
        return 'Audit Log';
      default:
        return 'Home';
    }
  };
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
  const [isSearchCommandOpen, setIsSearchCommandOpen] = useState(false);
  const [searchCommandQuery, setSearchCommandQuery] = useState('');
  const searchCommandRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [hasMarkedRead, setHasMarkedRead] = useState(false);
  const [isSosOpen, setIsSosOpen] = useState(false);
  const [sosSentSuccess, setSosSentSuccess] = useState(false);
  const [isSendingSos, setIsSendingSos] = useState(false);
  const [lastSosInfo, setLastSosInfo] = useState<{
    id: string;
    statusLabel: string;
    position: string;
    accuracy: string;
    sentAt: string;
    reached: string;
  } | null>(null);
  const [sosError, setSosError] = useState<string | null>(null);

  const data = useRepo();

  // One tap sends the current GPS position and the caller's profile snapshot to
  // the LGU duty officers. Without a GPS fix the SOS is still sent.
  const handleSendSos = async () => {
    if (isSendingSos) return;
    setIsSendingSos(true);
    setSosError(null);
    // Play attention chime sound
    if (typeof window !== 'undefined') {
      try {
        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioContextClass) {
          const ctx = new AudioContextClass();
          if (ctx.state === 'suspended') ctx.resume();
          const now = ctx.currentTime;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(440, now);
          osc.frequency.setValueAtTime(880, now + 0.15);
          gain.gain.setValueAtTime(0.2, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.5);
        }
      } catch {
        // ignore audio policy
      }
    }

    const pos = await locate().catch(() => null);
    try {
      const res = await repo.submitSos({
        lat: pos ? pos.lat : null,
        lng: pos ? pos.lng : null,
        accuracy: pos ? pos.accuracy : null,
      });
      const sentAt = new Date().toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
      setLastSosInfo({
        id: res.id ? res.id.toUpperCase() : 'PENDING',
        statusLabel: `${res.queued ? 'QUEUED' : 'SENT'} • ${sentAt.toUpperCase()}`,
        position: pos ? fmtCoords(pos.lat, pos.lng) : 'No GPS fix',
        accuracy: pos ? `± ${pos.accuracy} meters` : '—',
        sentAt,
        reached: res.queued ? 'Sends when back online' : `${res.reach ?? '—'} duty officers`,
      });
      try {
        if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
      } catch {
        // vibration is optional
      }
      setSosSentSuccess(true);
      setTimeout(() => {
        setSosSentSuccess(false);
      }, 3500);
    } catch (err: any) {
      setSosError(err.message || 'Could not send SOS');
    } finally {
      setIsSendingSos(false);
    }
  };

  // Notifications delivered to this account today, from the notifications table
  const unreadNotifications = data.notifications.filter((n) => n.unread).length;
  const deliveredAlerts = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return data.notifications
      .filter((n) => Date.parse(n.created_at) >= startOfDay.getTime())
      .map((n) => ({
        id: n.id,
        title: n.title,
        agency: n.advisory_id ? 'Advisory' : n.report_id ? 'Report update' : n.road_work_id ? 'Road work' : n.relief_id ? 'Relief' : n.sos_id ? 'SOS' : 'UniGuard',
        time: absTime(n.created_at),
        description: n.body,
      }));
  }, [data.notifications]);

  const lguNotifications: LguNotificationItem[] = useMemo(
    () =>
      data.sosLog.map((ev) => ({
        id: ev.id,
        citizenName: ev.profile_name,
        phoneNumber: ev.profile_phone,
        barangay: ev.barangay,
        distance: ev.accuracy != null ? `${ev.accuracy} m` : '',
        timeAgo: formatRelativeTime(ev.created_at),
        timestamp: ev.created_at,
        isNew: !hasMarkedRead,
        isRead: hasMarkedRead,
        locationStatus: ev.lat != null && ev.lng != null ? fmtCoords(ev.lat, ev.lng) : 'No GPS fix',
        notes: ev.note,
      })),
    [data.sosLog, hasMarkedRead]
  );

  const [isAllNotificationsModalOpen, setIsAllNotificationsModalOpen] = useState(false);
  const [notifSearchQuery, setNotifSearchQuery] = useState('');
  const [notifFilterTab, setNotifFilterTab] = useState<'all' | 'unread'>('all');

  const unreadLguCount = useMemo(() => {
    return lguNotifications.filter((n) => !n.isRead).length;
  }, [lguNotifications]);

  const filteredLguNotifications = useMemo(() => {
    return lguNotifications.filter((item) => {
      if (notifFilterTab === 'unread' && item.isRead) return false;
      if (notifSearchQuery.trim()) {
        const q = notifSearchQuery.toLowerCase();
        const matchesName = item.citizenName.toLowerCase().includes(q);
        const matchesPhone = item.phoneNumber.toLowerCase().includes(q);
        const matchesBarangay = item.barangay.toLowerCase().includes(q);
        return matchesName || matchesPhone || matchesBarangay;
      }
      return true;
    });
  }, [lguNotifications, notifFilterTab, notifSearchQuery]);

  const handleMarkAllRead = () => {
    setHasMarkedRead(true);
    repo.markAllRead().catch(() => {});
  };

  const dropdownRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  // Quick navigation commands for Search Command in LDRRMO header
  const availableCommands = useMemo(() => [
    {
      id: 'cmd-ops',
      label: 'Live Operations Map',
      icon: <Radio className="w-3.5 h-3.5" />,
      action: () => {
        if (setTopView) setTopView('Overview');
        if (setActiveTab) setActiveTab('home');
      },
    },
    {
      id: 'cmd-triage',
      label: 'Incident Command Triage',
      icon: <ShieldAlert className="w-3.5 h-3.5" />,
      action: () => {
        if (setActiveTab) setActiveTab('incidents');
      },
    },
    {
      id: 'cmd-shelters',
      label: 'Evacuation Shelters Directory',
      icon: <BookOpen className="w-3.5 h-3.5" />,
      action: () => {
        if (setActiveTab) setActiveTab('shelters');
      },
    },
    {
      id: 'cmd-advisories',
      label: 'Emergency Advisories & Directives',
      icon: <Bell className="w-3.5 h-3.5" />,
      action: () => {
        if (setActiveTab) setActiveTab('advisories');
      },
    },
    {
      id: 'cmd-analytics',
      label: 'Analytics & Risk Matrix',
      icon: <LayoutGrid className="w-3.5 h-3.5" />,
      action: () => {
        if (setActiveTab) setActiveTab('analytics');
      },
    },
    {
      id: 'cmd-audit',
      label: 'Audit Log & Activity Ledger',
      icon: <FileText className="w-3.5 h-3.5" />,
      action: () => {
        if (setActiveTab) setActiveTab('audit_log');
      },
    },
  ], [setTopView, setActiveTab]);

  const filteredCommands = useMemo(() => {
    if (!searchCommandQuery.trim()) return availableCommands.slice(0, 4);
    const q = searchCommandQuery.toLowerCase().trim();
    return availableCommands.filter((cmd) => cmd.label.toLowerCase().includes(q));
  }, [availableCommands, searchCommandQuery]);

  const filteredBarangays = useMemo(() => {
    if (!searchCommandQuery.trim()) return barangays.slice(0, 6);
    const q = searchCommandQuery.toLowerCase().trim();
    return barangays.filter((b) => b.name.toLowerCase().includes(q));
  }, [barangays, searchCommandQuery]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsFilterDropdownOpen(false);
      }
      if (searchCommandRef.current && !searchCommandRef.current.contains(event.target as Node)) {
        setIsSearchCommandOpen(false);
      }
      if (actionsRef.current && !actionsRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
        setIsNotificationsOpen(false);
        setIsProfileOpen(false);
        setIsSosOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard shortcut listener for Search Command (⌘K / Ctrl+K / Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setIsSearchCommandOpen(true);
      }
      if (e.key === 'Escape') {
        setIsSearchCommandOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const selectedBarangayObj = barangays.find((b) => b.id === selectedBarangay);
  const filterLabel =
    selectedBarangay === 'all'
      ? 'All Barangays Selected'
      : `${selectedBarangayObj?.name || selectedBarangay} Selected`;

  return (
    <header className={`px-3.5 sm:px-6 lg:px-8 py-3.5 sm:py-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3 sm:gap-4 sticky top-0 z-15 w-full ${
      isResident ? 'border-b border-neutral-100 bg-white/95 backdrop-blur-md' : 'border-b border-neutral-200/60 bg-[#f4f4f6]/90 backdrop-blur-md'
    }`}>
      {/* Brand Lockup */}
      <div className="flex items-center justify-between gap-2 min-w-0 flex-1">
        <div className="flex items-center gap-3">
          {/* Mobile Menu Toggle Button */}
          {onToggleMobileSidebar && (
            <button
              onClick={onToggleMobileSidebar}
              className={`lg:hidden p-2 rounded-xl transition-colors cursor-pointer ${
                isResident
                  ? 'bg-white border border-neutral-200 text-neutral-800 hover:bg-red-900 hover:text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
              aria-label="Toggle navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          <div>
            {isResident ? (
              <h2 className="text-xl sm:text-2xl font-extrabold text-neutral-900 tracking-tight">
                {getNavTitle(activeTab)}
              </h2>
            ) : (
              <h2 className="text-xl sm:text-2xl font-normal text-neutral-800 tracking-tight">
                Disaster Risk Reduction &amp; Operations Hub &bull; Lingayen
              </h2>
            )}
          </div>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">

        {/* Search Command with Magnifying Glass Symbol - LDRRMO Portal Header */}
        {!isResident && (
          <div className="relative" ref={searchCommandRef}>
            <div className="flex items-center gap-2 px-3.5 py-1.5 sm:py-2 rounded-full border border-neutral-200/80 bg-white hover:bg-neutral-50/80 focus-within:bg-white focus-within:border-neutral-400 focus-within:ring-1 focus-within:ring-neutral-400/50 text-neutral-700 text-xs shadow-2xs transition-all w-48 sm:w-60 md:w-72">
              <Search className="w-4 h-4 text-neutral-500 shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchCommandQuery}
                onChange={(e) => {
                  setSearchCommandQuery(e.target.value);
                  setIsSearchCommandOpen(true);
                }}
                onFocus={() => setIsSearchCommandOpen(true)}
                placeholder="Search"
                className="w-full bg-transparent text-xs text-neutral-800 placeholder:text-neutral-400 focus:outline-none"
              />
              {searchCommandQuery ? (
                <button
                  onClick={() => {
                    setSearchCommandQuery('');
                    setIsSearchCommandOpen(false);
                  }}
                  className="text-neutral-400 hover:text-neutral-600 p-0.5 cursor-pointer"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : (
                <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-neutral-400 bg-neutral-100 border border-neutral-200/80 rounded shrink-0 pointer-events-none">
                  ⌘K
                </kbd>
              )}
            </div>

            {/* Command Palette Dropdown */}
            {isSearchCommandOpen && (
              <div className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-72 sm:w-80 bg-white rounded-2xl border border-neutral-200 shadow-xl py-2 z-40 animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
                <div className="px-3.5 py-1.5 border-b border-neutral-100 mb-1 flex items-center justify-between">
                  <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
                    Search
                  </p>
                  <span className="text-[10px] text-neutral-400 font-mono">ESC to close</span>
                </div>

                <div className="max-h-72 overflow-y-auto py-1">
                  {/* Matching Actions */}
                  {filteredCommands.length > 0 && (
                    <div className="mb-2">
                      <p className="px-3.5 py-1 text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                        Navigation Commands
                      </p>
                      {filteredCommands.map((cmd) => (
                        <button
                          key={cmd.id}
                          onClick={() => {
                            cmd.action();
                            setIsSearchCommandOpen(false);
                            setSearchCommandQuery('');
                          }}
                          className="w-full px-3.5 py-2 text-left text-xs flex items-center justify-between hover:bg-neutral-50 transition-colors cursor-pointer text-neutral-700 hover:text-neutral-900 group"
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-md bg-neutral-100 flex items-center justify-center text-neutral-600 group-hover:bg-neutral-200">
                              {cmd.icon}
                            </span>
                            <span className="font-medium">{cmd.label}</span>
                          </div>
                          <span className="text-[10px] text-neutral-400 uppercase font-mono">Jump</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Matching Barangays */}
                  <div>
                    <p className="px-3.5 py-1 text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                      Barangay Scope
                    </p>
                    <button
                      onClick={() => {
                        setSelectedBarangay('all');
                        setIsSearchCommandOpen(false);
                        setSearchCommandQuery('');
                      }}
                      className={`w-full px-3.5 py-2 text-left text-xs flex items-center justify-between transition-colors cursor-pointer ${
                        selectedBarangay === 'all'
                          ? 'bg-neutral-100 text-neutral-900 font-bold'
                          : 'text-neutral-700 hover:bg-neutral-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-neutral-900" />
                        <span>All Barangays (Municipality-Wide)</span>
                      </div>
                      {selectedBarangay === 'all' && (
                        <Check className="w-3.5 h-3.5 text-neutral-900" />
                      )}
                    </button>

                    {filteredBarangays.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => {
                          setSelectedBarangay(b.id);
                          setIsSearchCommandOpen(false);
                          setSearchCommandQuery('');
                        }}
                        className={`w-full px-3.5 py-2 text-left text-xs flex items-center justify-between transition-colors cursor-pointer ${
                          selectedBarangay === b.id
                            ? 'bg-neutral-100 text-neutral-900 font-bold'
                            : 'text-neutral-700 hover:bg-neutral-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-neutral-400" />
                          <span>{b.name}</span>
                        </div>
                        {selectedBarangay === b.id && (
                          <Check className="w-3.5 h-3.5 text-neutral-900" />
                        )}
                      </button>
                    ))}
                  </div>

                  {filteredCommands.length === 0 && filteredBarangays.length === 0 && (
                    <div className="px-4 py-6 text-center text-xs text-neutral-400">
                      No matching command or barangay found.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}




        {/* Header Actions: All Barangays Selected (LGU), SOS (Residents/Barangay), Notifications, Report Hazard (Residents/Barangay), Menu */}
        <div ref={actionsRef} className="flex items-center gap-2">
          {/* 0. SOS with Caution Sign (Before Notification Bell for residents & barangay officials only) */}
          {isResident && (
            <div className="relative group">
              <button
                onClick={() => {
                  setIsSosOpen((prev) => !prev);
                  setIsNotificationsOpen(false);
                  setIsMenuOpen(false);
                  setIsProfileOpen(false);
                }}
                className={`h-9 sm:h-10 px-3.5 sm:px-4 rounded-full flex items-center gap-1.5 font-bold text-xs shadow-md active:scale-95 transition-all cursor-pointer ${
                  isSosOpen
                    ? 'bg-red-900 text-white shadow-lg ring-2 ring-red-950'
                    : 'bg-red-900 hover:bg-red-800 text-white ring-2 ring-red-900/30'
                }`}
                title="Emergency SOS"
                aria-label="Emergency SOS"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-white animate-pulse" />
                <span className="font-extrabold text-xs tracking-wider">SOS</span>
              </button>

              {/* Tooltip on hover saying "Emergency SOS" */}
              {!isSosOpen && (
                <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center pointer-events-none z-50">
                  <div className="w-1.5 h-1.5 -mb-0.5 rotate-45 bg-neutral-900 border-t border-l border-neutral-800" />
                  <span className="relative z-10 py-1 px-2.5 text-[10px] font-bold leading-none text-white whitespace-nowrap bg-neutral-900 rounded-lg shadow-lg border border-neutral-800">
                    Emergency SOS
                  </span>
                </div>
              )}

              {/* Background blur overlay when SOS popover is open */}
              {isSosOpen && (
                <div
                  className="fixed inset-0 bg-neutral-950/50 backdrop-blur-md z-40 transition-all duration-200 cursor-pointer"
                  style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
                  onClick={() => setIsSosOpen(false)}
                />
              )}

              {/* SOS Popover Dropdown - Anchored to SOS button, matches Home styling */}
              {isSosOpen && (
                <div className="absolute right-[-70px] sm:right-0 mt-2 w-[340px] sm:w-[390px] max-w-[calc(100vw-24px)] bg-white text-neutral-900 rounded-3xl border border-neutral-100/90 shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                  {/* Header Banner - Matching Home section header */}
                  <div className="p-4 sm:p-5 bg-white border-b border-neutral-100 relative">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-2xl bg-red-50 text-red-900 border border-red-100/60 flex items-center justify-center shadow-xs">
                          <AlertTriangle className="w-4 h-4 text-red-900" />
                        </div>
                        <h2 className="text-base font-extrabold text-neutral-900 tracking-tight">
                          Emergency SOS
                        </h2>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold px-2.5 py-1 rounded-full bg-red-50 text-red-900 border border-red-900/20">
                          Active Channel
                        </span>
                        <button
                          onClick={() => setIsSosOpen(false)}
                          className="p-1.5 rounded-xl text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 transition-colors cursor-pointer"
                          aria-label="Close emergency SOS"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <p className="text-neutral-500 text-xs font-normal leading-relaxed mt-2">
                      Direct distress trigger to Lingayen MDRRMO Dispatch and local barangay quick responders.
                    </p>
                  </div>

                  {/* Scrollable Body */}
                  <div className="p-4 sm:p-5 space-y-4 max-h-[440px] sm:max-h-[500px] overflow-y-auto bg-neutral-50/40">
                    {/* Hero Card: Tap to Send SOS (Signature Dark Red Gradient Card matching Home) */}
                    <div className="bg-gradient-to-br from-red-800 via-red-900 to-red-950 text-white rounded-3xl p-5 sm:p-6 text-center space-y-3 shadow-xl border border-red-900/40 relative overflow-hidden group">
                      {/* Big Glowing SOS Button */}
                      <button
                        onClick={handleSendSos}
                        disabled={isSendingSos}
                        className={`w-20 h-20 sm:w-22 sm:h-22 rounded-full mx-auto flex flex-col items-center justify-center transition-all shadow-xl active:scale-95 cursor-pointer relative group ${
                          sosSentSuccess
                            ? 'bg-white text-emerald-800 ring-4 ring-emerald-400 shadow-emerald-900/40'
                            : isSendingSos
                            ? 'bg-red-950 text-white animate-pulse ring-4 ring-white/50'
                            : 'bg-white text-red-900 hover:bg-red-50 ring-4 ring-white/30 hover:scale-105 shadow-black/20'
                        }`}
                        title="Tap to Send SOS"
                      >
                        <AlertTriangle className={`w-7 h-7 ${isSendingSos ? 'animate-bounce text-white' : sosSentSuccess ? 'text-emerald-700' : 'text-red-900 animate-pulse'}`} />
                        <span className="text-[11px] font-black uppercase tracking-wider mt-0.5 font-mono">
                          {isSendingSos ? 'Sending...' : sosSentSuccess ? 'Sent ✓' : 'SOS'}
                        </span>
                      </button>

                      <div>
                        <h3 className="text-base font-extrabold text-white tracking-tight">
                          {isSendingSos ? 'Transmitting Distress Signal...' : sosSentSuccess ? 'Distress Signal Logged & Broadcast!' : 'Tap to Trigger Emergency SOS'}
                        </h3>
                        <p className="text-xs text-red-100/90 leading-relaxed max-w-[280px] mx-auto mt-1">
                          {sosError || 'Hold still for a moment to acquire high-accuracy GPS coordinates. Duty dispatchers are immediately alerted.'}
                        </p>
                      </div>

                      {/* Status Pill Badge */}
                      {lastSosInfo && (
                      <div className="pt-1 flex justify-center">
                        <span className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-white/15 text-white border border-white/20 shadow-xs">
                          <span className={`w-2 h-2 rounded-full ${sosSentSuccess ? 'bg-emerald-400 animate-ping' : 'bg-white animate-pulse'}`} />
                          <span>{lastSosInfo.statusLabel}</span>
                        </span>
                      </div>
                      )}
                    </div>

                    {/* Card: Last SOS (Clean White Floating Card matching Home) */}
                    {lastSosInfo && (
                    <div className="bg-white border border-neutral-100 rounded-3xl p-4 sm:p-5 space-y-3 shadow-md">
                      <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-neutral-400">
                          Last SOS Dispatch
                        </span>
                        <span className="font-mono text-[9px] font-bold px-2 py-0.5 rounded-lg bg-neutral-100 text-neutral-600 border border-neutral-200/80 truncate max-w-[150px]">
                          {lastSosInfo.id}
                        </span>
                      </div>

                      <div className="space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-neutral-500 font-medium text-xs">Position</span>
                          <span className="font-mono font-bold text-xs text-neutral-800 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            {lastSosInfo.position}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-neutral-500 font-medium text-xs">Accuracy</span>
                          <span className="font-mono font-bold text-xs text-neutral-800">
                            {lastSosInfo.accuracy}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-neutral-500 font-medium text-xs">Sent at</span>
                          <span className="font-mono font-bold text-xs text-neutral-800">
                            {lastSosInfo.sentAt}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-neutral-500 font-medium text-xs">Reached</span>
                          <span className="font-mono font-bold text-xs text-red-900 px-2 py-0.5 rounded-full bg-red-50 border border-red-900/20">
                            {lastSosInfo.reached}
                          </span>
                        </div>
                      </div>
                    </div>
                    )}

                    {/* Rate Limit Disclaimer Banner */}
                    <div className="p-3.5 rounded-2xl bg-amber-50/80 border border-amber-200/80 flex items-start gap-2.5 text-xs text-amber-900 leading-relaxed">
                      <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                      <p className="text-[11px] leading-relaxed text-amber-900">
                        SOS is rate-limited to 5 calls per 10 minutes. False alarms take the duty officer away from real emergencies.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 1. Notifications (Shared for Residents, Barangay Officials, and LGU) */}
            <div className="relative group">
              <button
                onClick={() => {
                  repo.enablePush();
                  setIsNotificationsOpen((prev) => !prev);
                  setIsMenuOpen(false);
                  setIsSosOpen(false);
                  setIsProfileOpen(false);
                }}
                className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-xs active:scale-95 relative ${
                  isResident
                    ? isNotificationsOpen
                      ? 'bg-red-900 text-white shadow-md ring-2 ring-red-950'
                      : 'bg-white border border-neutral-200 text-neutral-800 hover:bg-red-900 hover:text-white shadow-sm'
                    : isNotificationsOpen
                    ? 'bg-[#18181b] text-white shadow-xs'
                    : 'border border-neutral-200/80 bg-white hover:bg-neutral-50 text-neutral-700 shadow-2xs'
                }`}
                title="Notifications"
                aria-label="Notifications"
              >
                <Bell className="w-4 h-4" />
                {!isResident ? (
                  unreadLguCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#18181b] text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">
                      {unreadLguCount}
                    </span>
                  )
                ) : (
                  unreadNotifications > 0 && (
                    <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-red-900 ring-2 ring-white animate-pulse" />
                  )
                )}
              </button>

              {/* Tooltip on hover saying "Notifications" */}
              {!isNotificationsOpen && (
                <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center pointer-events-none z-50">
                  <div className="w-1.5 h-1.5 -mb-0.5 rotate-45 bg-neutral-900 border-t border-l border-neutral-800" />
                  <span className="relative z-10 py-1 px-2.5 text-[10px] font-bold leading-none text-white whitespace-nowrap bg-neutral-900 rounded-lg shadow-lg border border-neutral-800">
                    Notifications
                  </span>
                </div>
              )}

              {/* Background blur overlay when Notifications dropdown is open */}
              {isNotificationsOpen && (
                <div
                  className="fixed inset-0 bg-neutral-950/50 backdrop-blur-md z-40 transition-all duration-200 cursor-pointer"
                  style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
                  onClick={() => setIsNotificationsOpen(false)}
                />
              )}

              {/* Notifications Dropdown - Anchored to Bell, matches Home styling */}
              {isNotificationsOpen && (
                <div className="absolute right-[-40px] sm:right-0 mt-2 w-[340px] sm:w-[390px] max-w-[calc(100vw-24px)] bg-white text-neutral-900 rounded-3xl border border-neutral-100/90 shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                  {/* 1. Header Banner - Crisp White with refined typography */}
                  <div className="p-4 sm:p-5 bg-white border-b border-neutral-100 relative">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-2xl bg-red-50 text-red-900 border border-red-100/60 flex items-center justify-center shadow-xs">
                          <Bell className="w-4 h-4 text-red-900" />
                        </div>
                        <h2 className="text-base font-extrabold text-neutral-900 tracking-tight">
                          Notifications
                        </h2>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {/* Mark All Read Action */}
                        <button
                          onClick={handleMarkAllRead}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer active:scale-95 shadow-xs shrink-0 ${
                            hasMarkedRead
                              ? 'bg-white text-neutral-700 border border-neutral-200'
                              : 'bg-red-900 hover:bg-red-800 text-white'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>{hasMarkedRead ? 'All Read' : 'Mark All Read'}</span>
                        </button>

                        {/* Close Button */}
                        <button
                          onClick={() => setIsNotificationsOpen(false)}
                          className="p-1.5 rounded-xl text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 transition-colors cursor-pointer"
                          aria-label="Close notifications"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Subtitle */}
                    <p className="text-neutral-500 text-xs font-normal leading-relaxed mt-2">
                      {!isResident
                        ? 'Push notification log • Every alert delivered to citizen devices.'
                        : 'Push notifications delivered to this device, including alerts received while the app was closed.'}
                    </p>
                  </div>

                  {/* 2. Main Body */}
                  <div className="p-4 sm:p-5 space-y-3.5 max-h-[440px] sm:max-h-[500px] overflow-y-auto bg-neutral-50/40">
                    {/* Delivery Box (Matching Home Cards) */}
                    <div className="bg-white rounded-2xl border border-neutral-100/90 p-4 space-y-2.5 shadow-sm">
                      <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                          Delivery Telemetry
                        </span>
                        <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-red-50 text-red-900 border border-red-900/20">
                          Active Channel
                        </span>
                      </div>

                      <div className="space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-neutral-500 font-medium">Unread</span>
                          <span className="font-mono font-bold text-xs text-red-900 px-2 py-0.5 rounded-lg bg-red-50 border border-red-100 shadow-2xs">
                            {!isResident ? unreadLguCount : unreadNotifications}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-neutral-500 font-medium">Delivered today</span>
                          <span className="font-mono font-bold text-xs text-neutral-800 px-2 py-0.5 rounded-lg bg-neutral-100 border border-neutral-200">
                            {!isResident ? lguNotifications.length : deliveredAlerts.length}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-neutral-500 font-medium">Delivery channel</span>
                          <span className="font-mono text-xs font-bold text-neutral-800 flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${!isResident ? 'bg-neutral-800' : 'bg-red-900'} animate-pulse`} />
                            Push + offline inbox
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Alerts guarantee notice box (Matching Home's Advisory Style) */}
                    <div className="p-3.5 rounded-2xl bg-white border border-neutral-100/90 flex items-start gap-3 text-xs text-neutral-600 leading-snug shadow-sm">
                      <div className="w-8 h-8 rounded-xl bg-red-50 text-red-900 border border-red-100 flex items-center justify-center shrink-0">
                        <Radio className="w-4 h-4 text-red-900 animate-pulse" />
                      </div>
                      <p className="text-xs leading-relaxed font-medium">
                        Alerts are delivered even when the app is closed, and are queued for the offline inbox when cellular signal is unavailable.
                      </p>
                    </div>

                    {/* Content Section: LGU Admin vs Resident */}
                    {!isResident ? (
                      /* LGU Portal Push Notification Log */
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center justify-between px-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold uppercase tracking-wider text-neutral-900">
                              Inbox
                            </span>
                            {unreadLguCount > 0 && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-900 border border-red-900/20">
                                {unreadLguCount} unread
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-neutral-700 font-bold bg-neutral-100 px-2 py-0.5 rounded-full border border-neutral-200 font-mono">
                            Offline Synced
                          </span>
                        </div>

                        <div className="space-y-2">
                          {lguNotifications.slice(0, 4).map((item) => (
                            <div
                              key={item.id}
                              onClick={() => {
                                setIsAllNotificationsModalOpen(true);
                                setIsNotificationsOpen(false);
                              }}
                              className="p-3.5 rounded-2xl bg-white hover:bg-neutral-50 border border-neutral-100/90 hover:border-neutral-200 transition-all text-xs cursor-pointer shadow-sm group flex items-start gap-3"
                            >
                              <div className="w-8 h-8 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center text-red-900 shrink-0 group-hover:bg-red-100 transition-colors mt-0.5">
                                <AlertTriangle className="w-4 h-4 text-red-900" />
                              </div>

                              <div className="flex-1 min-w-0 space-y-1">
                                <div className="flex items-center justify-between gap-1">
                                  <span className="font-bold text-neutral-900 text-xs truncate">
                                    SOS received from {item.citizenName}
                                  </span>
                                  {!item.isRead && (
                                    <span className="px-1.5 py-0.5 rounded-full bg-red-50 text-red-900 text-[9px] font-black uppercase tracking-wider border border-red-900/20 shrink-0">
                                      NEW
                                    </span>
                                  )}
                                </div>

                                <p className="text-[11px] text-neutral-500 font-mono truncate">
                                  {item.phoneNumber} &bull; {item.barangay} &bull; {item.distance || 'm'}
                                </p>

                                <div className="flex items-center justify-between pt-1 text-[10px] text-neutral-400">
                                  <span className="flex items-center gap-1 font-medium">
                                    <Clock className="w-3 h-3 text-neutral-400" />
                                    {item.timeAgo}
                                  </span>
                                  <ChevronRight className="w-3.5 h-3.5 text-neutral-400 group-hover:text-red-900 transition-colors" />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      /* Resident Delivered Today Alerts List */
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center justify-between px-1">
                          <span className="text-xs font-bold uppercase tracking-wider text-neutral-900">
                            Delivered Today ({deliveredAlerts.length})
                          </span>
                          <span className="text-[10px] text-neutral-700 font-bold bg-neutral-100 px-2.5 py-0.5 rounded-full border border-neutral-200 font-mono">
                            Offline Synced
                          </span>
                        </div>

                        <div className="space-y-2">
                          {deliveredAlerts.map((alert) => (
                            <div
                              key={alert.id}
                              className="p-3.5 rounded-2xl bg-white hover:bg-red-50/30 border border-neutral-100/90 hover:border-red-900/30 transition-all text-xs space-y-1.5 shadow-sm"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-bold text-neutral-900 text-xs truncate">
                                  {alert.title}
                                </span>
                                <span className="text-[10px] font-mono text-neutral-400 shrink-0 tabular-nums">
                                  {alert.time}
                                </span>
                              </div>
                              <p className="text-xs text-neutral-600 leading-relaxed line-clamp-2">
                                {alert.description}
                              </p>
                              <div className="flex items-center justify-between pt-1.5 border-t border-neutral-100 text-[10px]">
                                <span className="text-red-900 font-bold uppercase tracking-wider text-[10px]">
                                  {alert.agency}
                                </span>
                                <span className="flex items-center gap-1 font-semibold text-[10px] text-emerald-700">
                                  <Check className="w-3 h-3 text-emerald-700" />
                                  Delivered to device
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 3. Footer Action */}
                  <div className="p-3 bg-white border-t border-neutral-100">
                    {isResident ? (
                      <button
                        onClick={() => {
                          if (setActiveTab) setActiveTab('notifications');
                          setIsNotificationsOpen(false);
                        }}
                        className="w-full py-2.5 text-center text-xs font-bold text-neutral-800 hover:text-red-900 bg-neutral-50 hover:bg-red-50 border border-neutral-200 hover:border-red-900/30 rounded-2xl transition cursor-pointer active:scale-98 shadow-xs flex items-center justify-center gap-1.5"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>View Full Notifications Tab</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setIsAllNotificationsModalOpen(true);
                          setIsNotificationsOpen(false);
                        }}
                        className="w-full py-2.5 text-center text-xs font-bold text-white bg-red-900 hover:bg-red-800 rounded-2xl transition cursor-pointer active:scale-98 shadow-md flex items-center justify-center gap-1.5"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>View All Notifications</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 2. Report Hazard (+ sign with hover tooltip - Residents & Barangay Officials only) */}
            {isResident && (
              <div className="relative group">
                <button
                  onClick={onOpenReportModal}
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white border border-neutral-200 hover:bg-red-900 text-neutral-800 hover:text-white flex items-center justify-center transition-all cursor-pointer shadow-sm active:scale-95"
                  title="Report Hazard"
                  aria-label="Report Hazard"
                >
                  <Plus className="w-4 h-4" />
                </button>

                {/* Tooltip on hover saying "Report Hazard" */}
                <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center pointer-events-none z-50">
                  <div className="w-1.5 h-1.5 -mb-0.5 rotate-45 bg-neutral-900 border-t border-l border-neutral-800" />
                  <span className="relative z-10 py-1 px-2.5 text-[10px] font-bold leading-none text-white whitespace-nowrap bg-neutral-900 rounded-lg shadow-lg border border-neutral-800">
                    Report Hazard
                  </span>
                </div>
              </div>
            )}

            {/* 3. Menu (Rightmost) with Profile inside */}
            <div className="relative group">
              <button
                onClick={() => {
                  setIsMenuOpen((prev) => !prev);
                  setIsNotificationsOpen(false);
                  setIsSosOpen(false);
                  setIsProfileOpen(false);
                }}
                className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-xs active:scale-95 ${
                  isResident
                    ? isMenuOpen
                      ? 'bg-red-900 text-white shadow-md ring-2 ring-red-950'
                      : 'bg-white border border-neutral-200 hover:bg-red-900 text-neutral-800 hover:text-white shadow-sm'
                    : isMenuOpen
                    ? 'bg-[#18181b] text-white shadow-xs'
                    : 'border border-neutral-200/80 bg-white hover:bg-neutral-50 text-neutral-700 shadow-2xs'
                }`}
                title="Quick Menu"
                aria-label="Quick Menu"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>

              {/* Tooltip on hover saying "Menu" */}
              {!isMenuOpen && (
                <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center pointer-events-none z-50">
                  <div className="w-1.5 h-1.5 -mb-0.5 rotate-45 bg-neutral-900 border-t border-l border-neutral-800" />
                  <span className="relative z-10 py-1 px-2.5 text-[10px] font-bold leading-none text-white whitespace-nowrap bg-neutral-900 rounded-lg shadow-lg border border-neutral-800">
                    Menu
                  </span>
                </div>
              )}

              {/* Background blur overlay when Menu is open */}
              {isMenuOpen && (
                <div
                  className="fixed inset-0 bg-neutral-950/50 backdrop-blur-md z-40 transition-all duration-200 cursor-pointer"
                  style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
                  onClick={() => setIsMenuOpen(false)}
                />
              )}

              {/* Menu Dropdown - Anchored to Menu button, matches Home styling */}
              {isMenuOpen && (
                <div className="absolute right-0 mt-2 w-72 sm:w-80 bg-white text-neutral-900 rounded-3xl border border-neutral-100/90 shadow-2xl p-3.5 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150 space-y-2">
                  {/* User Profile Card inside Menu - Signature Gradient matching Home Cards */}
                  <div className={`rounded-2xl p-4 sm:p-5 shadow-md flex flex-col items-center justify-center text-center relative overflow-hidden group ${
                    isResident
                      ? 'bg-gradient-to-br from-red-800 via-red-900 to-red-950 text-white border border-red-900/40'
                      : currentUser?.role === 'barangay'
                      ? 'bg-gradient-to-br from-[#052659] via-[#041d44] to-[#011025] text-white border border-[#7EA0C5]/30'
                      : 'bg-gradient-to-br from-neutral-800 via-neutral-900 to-neutral-950 text-white border border-neutral-800'
                  }`}>
                    {/* Background motif watermark */}
                    <div className="absolute -right-3 -bottom-3 opacity-10 pointer-events-none">
                      <ShieldCheck className="w-24 h-24 text-white" />
                    </div>

                    <div className="w-14 h-14 rounded-2xl bg-white/15 text-white border border-white/25 flex items-center justify-center font-extrabold text-xl shadow-md ring-2 ring-white/20 mb-2.5 shrink-0">
                      {currentUser?.full_name ? currentUser.full_name.trim().charAt(0).toUpperCase() : 'U'}
                    </div>

                    <p className="text-sm sm:text-base font-extrabold text-white tracking-tight truncate max-w-full px-2">
                      {currentUser?.full_name || ''}
                    </p>

                    <p className="text-xs text-red-100/90 font-medium truncate max-w-full px-2 mt-0.5">
                      {isResident
                        ? `${currentUser?.barangay_name ? `Barangay ${currentUser.barangay_name}, ` : ''}Lingayen`
                        : currentUser?.role === 'barangay'
                        ? 'Barangay Emergency Desk'
                        : 'LDRRMO Incident Command'}
                    </p>

                    <span className="mt-2.5 px-3 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-white text-red-900 shadow-xs font-mono">
                      {isResident
                        ? 'CITIZEN • RESIDENT'
                        : currentUser?.role === 'barangay'
                        ? 'BARANGAY • OFFICIAL'
                        : 'LDRRMO • COMMAND'}
                    </span>
                  </div>

                  {/* Navigation Links matching Home List items */}
                  <div className="space-y-1">

                    {/* Preparedness Guides */}
                    <button
                      onClick={() => {
                        if (setActiveTab) setActiveTab('guides');
                        setIsMenuOpen(false);
                      }}
                      className="w-full px-3.5 py-2.5 text-left text-xs sm:text-sm font-bold text-neutral-800 hover:text-red-900 hover:bg-red-50/60 rounded-2xl flex items-center justify-between transition-all cursor-pointer group active:scale-98"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-neutral-50 group-hover:bg-red-100/70 text-neutral-600 group-hover:text-red-900 border border-neutral-100 group-hover:border-red-200/60 flex items-center justify-center transition-colors shadow-2xs shrink-0">
                          <BookOpen className="w-4 h-4" />
                        </div>
                        <span className="truncate">Preparedness Guides</span>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-neutral-300 group-hover:text-red-900 transition-transform group-hover:translate-x-0.5 shrink-0" />
                    </button>

                    {/* FAQs */}
                    <button
                      onClick={() => {
                        if (setActiveTab) setActiveTab('faqs');
                        setIsMenuOpen(false);
                      }}
                      className="w-full px-3.5 py-2.5 text-left text-xs sm:text-sm font-bold text-neutral-800 hover:text-red-900 hover:bg-red-50/60 rounded-2xl flex items-center justify-between transition-all cursor-pointer group active:scale-98"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-neutral-50 group-hover:bg-red-100/70 text-neutral-600 group-hover:text-red-900 border border-neutral-100 group-hover:border-red-200/60 flex items-center justify-center transition-colors shadow-2xs shrink-0">
                          <HelpCircle className="w-4 h-4" />
                        </div>
                        <span className="truncate">FAQs</span>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-neutral-300 group-hover:text-red-900 transition-transform group-hover:translate-x-0.5 shrink-0" />
                    </button>

                    {/* Others Review (Admin only) */}
                    {!isResident && (
                      <button
                        onClick={() => {
                          if (setActiveTab) setActiveTab('others_review');
                          setIsMenuOpen(false);
                        }}
                        className="w-full px-3.5 py-2.5 text-left text-xs sm:text-sm font-bold text-neutral-800 hover:text-red-900 hover:bg-red-50/60 rounded-2xl flex items-center justify-between transition-all cursor-pointer group active:scale-98"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-xl bg-neutral-50 group-hover:bg-red-100/70 text-neutral-600 group-hover:text-red-900 border border-neutral-100 group-hover:border-red-200/60 flex items-center justify-center transition-colors shadow-2xs shrink-0">
                            <UserCheck className="w-4 h-4" />
                          </div>
                          <span className="truncate">Others Review</span>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-neutral-300 group-hover:text-red-900 transition-transform group-hover:translate-x-0.5 shrink-0" />
                      </button>
                    )}

                    {/* Users Management (Admin only) */}
                    {!isResident && (
                      <button
                        onClick={() => {
                          if (setActiveTab) setActiveTab('users');
                          setIsMenuOpen(false);
                        }}
                        className="w-full px-3.5 py-2.5 text-left text-xs sm:text-sm font-bold text-neutral-800 hover:text-red-900 hover:bg-red-50/60 rounded-2xl flex items-center justify-between transition-all cursor-pointer group active:scale-98"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-xl bg-neutral-50 group-hover:bg-red-100/70 text-neutral-600 group-hover:text-red-900 border border-neutral-100 group-hover:border-red-200/60 flex items-center justify-center transition-colors shadow-2xs shrink-0">
                            <Users className="w-4 h-4" />
                          </div>
                          <span className="truncate">Users Management</span>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-neutral-300 group-hover:text-red-900 transition-transform group-hover:translate-x-0.5 shrink-0" />
                      </button>
                    )}

                    {/* Audit Log (Admin only) */}
                    {!isResident && (
                      <button
                        onClick={() => {
                          if (setActiveTab) setActiveTab('audit_log');
                          setIsMenuOpen(false);
                        }}
                        className="w-full px-3.5 py-2.5 text-left text-xs sm:text-sm font-bold text-neutral-800 hover:text-red-900 hover:bg-red-50/60 rounded-2xl flex items-center justify-between transition-all cursor-pointer group active:scale-98"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-xl bg-neutral-50 group-hover:bg-red-100/70 text-neutral-600 group-hover:text-red-900 border border-neutral-100 group-hover:border-red-200/60 flex items-center justify-center transition-colors shadow-2xs shrink-0">
                            <FileText className="w-4 h-4" />
                          </div>
                          <span className="truncate">Audit Log</span>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-neutral-300 group-hover:text-red-900 transition-transform group-hover:translate-x-0.5 shrink-0" />
                      </button>
                    )}

                    {/* Offline Sync */}
                    <button
                      onClick={() => {
                        if (setActiveTab) setActiveTab('offline_sync');
                        setIsMenuOpen(false);
                      }}
                      className="w-full px-3.5 py-2.5 text-left text-xs sm:text-sm font-bold text-neutral-800 hover:text-red-900 hover:bg-red-50/60 rounded-2xl flex items-center justify-between transition-all cursor-pointer group active:scale-98"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-neutral-50 group-hover:bg-red-100/70 text-neutral-600 group-hover:text-red-900 border border-neutral-100 group-hover:border-red-200/60 flex items-center justify-center transition-colors shadow-2xs shrink-0">
                          <Download className="w-4 h-4" />
                        </div>
                        <span className="truncate">Offline Data &amp; Sync</span>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-red-900 bg-red-50 border border-red-900/20 px-2.5 py-0.5 rounded-full shrink-0">
                        Ready
                      </span>
                    </button>
                  </div>

                  {/* Sign Out */}
                  {onSignOut && (
                    <div className="pt-2 border-t border-neutral-100 mt-1">
                      <button
                        onClick={() => {
                          onSignOut();
                          setIsMenuOpen(false);
                        }}
                        className="w-full py-2.5 px-3.5 rounded-2xl hover:bg-red-50 text-red-900 hover:text-red-950 font-bold text-xs sm:text-sm flex items-center justify-between transition-colors cursor-pointer group active:scale-98"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-xl bg-red-50 group-hover:bg-red-100 text-red-900 border border-red-100 flex items-center justify-center shrink-0">
                            <LogOut className="w-4 h-4 text-red-900" />
                          </div>
                          <span>Sign Out</span>
                        </div>
                        <LogOut className="w-3.5 h-3.5 text-red-900/60 group-hover:text-red-900 transition-colors shrink-0" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

      {/* "View All Notifications" Modal for Admin */}
      {isAllNotificationsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/60 backdrop-blur-md animate-in fade-in duration-200">
          <div
            className="fixed inset-0"
            onClick={() => setIsAllNotificationsModalOpen(false)}
          />
          <div className="relative bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl sm:max-w-3xl max-h-[88vh] flex flex-col overflow-hidden z-10 animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between gap-3 bg-white">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center text-[#991B1B] shadow-2xs">
                  <Bell className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                      Push Notification Log
                    </h2>
                    {unreadLguCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-rose-100 text-[#991B1B] text-[10px] font-black">
                        {unreadLguCount} unread
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Every alert delivered to citizen devices and incoming SOS distress pings.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleMarkAllRead}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95 shadow-2xs ${
                    hasMarkedRead
                      ? 'bg-slate-100 text-slate-600 border border-slate-200'
                      : 'bg-[#991B1B] hover:bg-[#7f1d1d] text-white'
                  }`}
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{hasMarkedRead ? 'All Read' : 'Mark All Read'}</span>
                </button>

                <button
                  onClick={() => setIsAllNotificationsModalOpen(false)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                  aria-label="Close modal"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Search and Filters Toolbar */}
            <div className="p-3 sm:p-4 bg-slate-50 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={notifSearchQuery}
                  onChange={(e) => setNotifSearchQuery(e.target.value)}
                  placeholder="Filter by resident name, phone number, or barangay..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#991B1B]/20 focus:border-[#991B1B]"
                />
                {notifSearchQuery && (
                  <button
                    onClick={() => setNotifSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5 self-end sm:self-auto">
                <button
                  onClick={() => setNotifFilterTab('all')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    notifFilterTab === 'all'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  All ({lguNotifications.length})
                </button>
                <button
                  onClick={() => setNotifFilterTab('unread')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    notifFilterTab === 'unread'
                      ? 'bg-[#991B1B] text-white shadow-xs'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Unread ({unreadLguCount})
                </button>
              </div>
            </div>

            {/* Modal Body: Full Notifications List */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-2.5 bg-slate-50/50">
              {filteredLguNotifications.length === 0 ? (
                <div className="p-8 text-center bg-white rounded-xl border border-slate-200/80">
                  <Bell className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs font-bold text-slate-700">No notifications match your filter</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Try clearing your search query or tab selection.</p>
                </div>
              ) : (
                filteredLguNotifications.map((item) => (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-xl bg-white border border-slate-200/80 hover:border-slate-300 shadow-2xs transition-all space-y-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center text-[#991B1B] shrink-0 mt-0.5">
                          <AlertTriangle className="w-4 h-4 text-[#991B1B]" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-extrabold text-slate-900 text-sm">
                              SOS received from {item.citizenName}
                            </span>
                            {!item.isRead ? (
                              <span className="px-1.5 py-0.2 rounded-md bg-rose-100 text-[#991B1B] text-[9px] font-black uppercase tracking-wider border border-rose-200/70">
                                NEW
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.2 rounded-md bg-slate-100 text-slate-600 text-[9px] font-bold uppercase tracking-wider border border-slate-200">
                                READ
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 font-mono mt-0.5">
                            {item.phoneNumber} &bull; {item.barangay} &bull; {item.distance || 'm'}
                          </p>
                        </div>
                      </div>

                      <span className="text-[11px] font-mono text-slate-400 shrink-0 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-400" />
                        {item.timeAgo}
                      </span>
                    </div>

                    {item.notes && (
                      <p className="text-xs text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-100 leading-relaxed">
                        {item.notes}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
                      <span className="text-[11px] text-slate-500 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-800" />
                        {item.locationStatus || 'GPS Locked'}
                      </span>

                      <div className="flex items-center gap-2">
                        <a
                          href={`tel:${item.phoneNumber}`}
                          className="px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-800 border border-zinc-200 text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
                        >
                          <PhoneCall className="w-3 h-3" />
                          <span>Call Resident</span>
                        </a>

                        {setActiveTab && (
                          <button
                            onClick={() => {
                              setActiveTab('sos_log');
                              setIsAllNotificationsModalOpen(false);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold inline-flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <span>Open in SOS Log &rarr;</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 sm:p-4 bg-white border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-slate-500 text-[11px]">
                <Radio className="w-3.5 h-3.5 text-[#991B1B] animate-pulse shrink-0" />
                <span>Alerts are delivered even when the app is closed. History persists on this device.</span>
              </div>

              <button
                onClick={() => setIsAllNotificationsModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-colors cursor-pointer self-end sm:self-auto"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
