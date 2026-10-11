import React, { useEffect, useState } from 'react';
import {
  Home,
  AlertTriangle,
  Megaphone,
  Building2,
  ShieldAlert,
  LayoutGrid,
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
  type LucideIcon,
} from 'lucide-react';
import { User } from '../types';
import { useRepo } from '../hooks/useRepo';

// Phone navigation for the barangay and LDRRMO portals: four main sections in
// a bottom bar, and everything else in the Menu at its far right.

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** shown to LDRRMO administrators only, as the server enforces */
  lguOnly?: boolean;
}

const BAR_TABS: NavItem[] = [
  { id: 'overview', label: 'Home', icon: Home },
  { id: 'incidents', label: 'Incidents', icon: AlertTriangle },
  { id: 'advisories', label: 'Advisories', icon: Megaphone },
  { id: 'shelters', label: 'Shelters', icon: Building2 },
];

const MENU_TABS: NavItem[] = [
  { id: 'sos_log', label: 'SOS Log', icon: ShieldAlert },
  { id: 'relief', label: 'Relief', icon: Package },
  { id: 'road_work', label: 'Road Work', icon: Construction },
  { id: 'hotlines', label: 'Hotlines', icon: PhoneCall },
  { id: 'analytics', label: 'Analytics', icon: Layers },
  { id: 'guides', label: 'Preparedness Guides', icon: BookOpen },
  { id: 'faqs', label: 'FAQs', icon: HelpCircle },
  { id: 'others_review', label: 'Others Review', icon: UserCheck, lguOnly: true },
  { id: 'users', label: 'Users', icon: Users, lguOnly: true },
  { id: 'audit_log', label: 'Audit Log', icon: FileText, lguOnly: true },
  { id: 'offline_sync', label: 'Offline Sync', icon: Download },
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
}

/** Bottom bar: the active section rises into a circle that dips into the bar. */
export const StaffBottomNav: React.FC<StaffBottomNavProps> = ({ activeTab, setActiveTab, currentUser, onSignOut }) => {
  const isBarangay = currentUser.role === 'barangay';
  const isLgu = currentUser.role === 'lgu_admin';
  const data = useRepo();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const badges: Record<string, number> = {
    advisories: data.advisories.filter((a) => a.severity !== 'low').length,
    shelters: data.centers.filter((c) => c.status === 'open').length,
  };
  const menuItems = MENU_TABS.filter((item) => !item.lguOnly || isLgu);
  // Menu is the current slot for every section that is not in the bar itself
  const inMenuSection = !BAR_TABS.some((item) => isBarActive(item.id, activeTab));

  useEffect(() => {
    if (!isMenuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setIsMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMenuOpen]);

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
      {isMenuOpen && (
        <>
          {/* Dimmed backdrop: a tap outside the panel closes it */}
          <div
            className="pointer-events-auto fixed inset-0 bg-[#011025]/35 backdrop-blur-[2px] animate-in fade-in duration-150"
            onClick={() => setIsMenuOpen(false)}
            aria-hidden="true"
          />

          {/* Menu panel, rising from just above the bar */}
          <div
            id="staff-mobile-menu"
            role="dialog"
            aria-label="Menu"
            className={`pointer-events-auto absolute left-2 right-2 bottom-full -mb-1 max-h-[min(72vh,34rem)] overflow-y-auto rounded-[26px] bg-white p-3 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200 ${
              isBarangay ? 'border border-[#7EA0C5]/40' : 'border border-neutral-200'
            }`}
          >
            {/* Who is signed in */}
            <div
              className={`flex items-center gap-3 rounded-2xl p-3 ${
                isBarangay ? 'bg-[#C2E8FF]/20 border border-[#7EA0C5]/30' : 'bg-neutral-50 border border-neutral-200/80'
              }`}
            >
              <div
                className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center font-black text-lg text-white ring-4 ${
                  isBarangay ? 'bg-[#052659] ring-[#C2E8FF]/70' : 'bg-[#18181b] ring-neutral-200/80'
                }`}
              >
                {currentUser.full_name ? currentUser.full_name.trim().charAt(0).toUpperCase() : isBarangay ? 'B' : 'L'}
              </div>
              <div className="min-w-0">
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
                  {isBarangay ? 'BARANGAY' : 'LDRRMO'}
                </span>
              </div>
            </div>

            {/* Every section that is not in the bar */}
            <div className="grid grid-cols-2 gap-2 mt-3">
              {menuItems.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => go(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`h-12 min-w-0 px-3 rounded-2xl flex items-center gap-2.5 text-left text-xs font-semibold cursor-pointer transition-colors ${
                      active
                        ? isBarangay ? 'bg-[#052659] text-white' : 'bg-[#18181B] text-white'
                        : isBarangay
                        ? 'bg-[#F4F7FB] text-[#011025] border border-[#7EA0C5]/25 active:bg-[#C2E8FF]/40'
                        : 'bg-neutral-50 text-neutral-800 border border-neutral-200/70 active:bg-neutral-100'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-white' : isBarangay ? 'text-[#052659]' : 'text-neutral-700'}`} />
                    <span className="min-w-0 leading-tight line-clamp-2">{item.label}</span>
                  </button>
                );
              })}
            </div>

            {onSignOut && (
              <button
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  onSignOut();
                }}
                className={`mt-3 w-full h-12 rounded-2xl flex items-center justify-center gap-2 text-xs font-bold cursor-pointer transition-colors ${
                  isBarangay
                    ? 'text-[#052659] border border-[#7EA0C5]/40 active:bg-[#C2E8FF]/30'
                    : 'text-neutral-800 border border-neutral-200 active:bg-neutral-100'
                }`}
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            )}
          </div>
        </>
      )}

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
    </nav>
  );
};
