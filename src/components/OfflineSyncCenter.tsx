import React, { useState, useEffect, useRef } from 'react';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  PhoneCall,
  Building2,
  Megaphone,
  Radio,
  Search,
  ShieldAlert,
  Check,
  X
} from 'lucide-react';
import { EmergencyHotline, EvacuationCenter, Advisory, User } from '../types';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import { CONFIG } from '../lib/config';
import { BrandLoader, TriadEmblem, portalForRole } from '../brand';

interface OfflineSyncCenterProps {
  isOnline: boolean;
  pendingOutboxCount: number;
  hotlines: EmergencyHotline[];
  evacuationCenters: EvacuationCenter[];
  advisories: Advisory[];
  currentUser?: User;
  onSyncCompleted: () => void;
  onNavigateTab?: (tab: string) => void;
}

export const OfflineSyncCenter: React.FC<OfflineSyncCenterProps> = ({
  isOnline,
  pendingOutboxCount,
  hotlines,
  evacuationCenters,
  advisories,
  currentUser,
  onSyncCompleted,
  onNavigateTab,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  // The live feed follows the real connection; it is not a switch
  const isLiveFeedActive = isOnline;
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);
  const [isForceRefreshing, setIsForceRefreshing] = useState(false);
  const [statusNotification, setStatusNotification] = useState<string | null>(null);
  const isBarangay = currentUser?.role === 'barangay';
  const portal = portalForRole(currentUser?.role);

  // Last successful sync, from the data store
  const { lastSync } = useRepo();
  const syncTimeFormatted = lastSync
    ? new Date(lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—';

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut ⌘K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Check connection: asks the browser again, sends anything queued and reloads
  // the data, then reports what actually happened
  const handleCheckConnection = async () => {
    setIsCheckingConnection(true);
    setStatusNotification('Checking the connection...');
    const r = await repo.retryNow();
    setIsCheckingConnection(false);
    if (r.online) {
      setStatusNotification(
        'Back online. Data refreshed' +
          (r.uploaded ? `, ${r.uploaded} queued report${r.uploaded > 1 ? 's' : ''} uploaded` : '') +
          '.'
      );
    } else {
      setStatusNotification(
        `Still offline. ${r.queued} report${r.queued === 1 ? '' : 's'} waiting. They send by themselves when the connection returns.`
      );
    }
    onSyncCompleted();
    setTimeout(() => setStatusNotification(null), 4500);
  };

  // Force refresh: unregisters the service worker, clears every cache and reloads
  const handleForceRefresh = async () => {
    setIsForceRefreshing(true);
    setStatusNotification('Clearing the offline cache and reloading the newest build...');
    await repo.forceRefresh();
  };

  // Counts for cached items
  const hotlineCount = hotlines.length;
  const shelterCount = evacuationCenters.length;
  const advisoryCount = advisories.filter((a) => a.severity !== 'low').length;

  return (
    <div className="space-y-6 sm:space-y-7 animate-in fade-in duration-300">
      {/* 1. Command Console Top Bar (Search with ⌘K, Live Feed, Network Status) */}
      <div className={`bg-white rounded-[24px] border ${isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200/70'} shadow-xs p-4 sm:p-5 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4`}>
        {/* Left Branding */}
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-2xl ${isBarangay ? 'bg-[#052659] text-white border border-[#011025]' : 'bg-[#18181b] text-white'} flex items-center justify-center shrink-0 shadow-xs`}>
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className={`text-base font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'} tracking-tight`}>
                UniGuard Command Console
              </h2>
              <span className={`text-[10px] font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                isBarangay
                  ? 'bg-[#C2E8FF]/60 text-[#052659] border border-[#7EA0C5]/40'
                  : 'bg-neutral-100 text-neutral-700 border border-neutral-200/80'
              }`}>
                {currentUser?.role === 'lgu_admin'
                  ? 'LGU JURISDICTION'
                  : currentUser?.role === 'barangay'
                  ? `BRGY. ${(currentUser.barangay_name || '').toUpperCase()}`
                  : 'RESIDENT PORTAL'}
              </span>
            </div>
            <p className={`text-xs ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
              Municipality of Lingayen, Pangasinan
            </p>
          </div>
        </div>

        {/* Center: Search input + ⌘K */}
        <div className="flex-1 max-w-xl relative">
          <div className="relative flex items-center">
            <Search className={`w-4 h-4 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'} absolute left-3.5 pointer-events-none`} />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search incidents, responders, or locations"
              className={`w-full pl-10 pr-14 py-2.5 ${
                isBarangay
                  ? 'bg-white hover:bg-[#C2E8FF]/15 focus:bg-white text-xs font-medium text-[#011025] placeholder-[#7EA0C5] border border-[#7EA0C5]/40 focus:border-[#052659] focus:ring-2 focus:ring-[#052659]/15'
                  : 'bg-neutral-50/70 hover:bg-neutral-50 focus:bg-white text-xs font-medium text-neutral-800 placeholder-neutral-400 border border-neutral-200 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50'
              } rounded-full transition-all outline-hidden shadow-2xs`}
            />
            <div className="absolute right-3 flex items-center pointer-events-none">
              <kbd className={`text-[10px] font-mono font-medium ${
                isBarangay
                  ? 'text-[#5482B4] bg-[#C2E8FF]/40 border border-[#7EA0C5]/40'
                  : 'text-neutral-500 bg-neutral-100 border border-neutral-200/80'
              } px-2 py-0.5 rounded-md shadow-2xs`}>
                ⌘K
              </kbd>
            </div>
          </div>
        </div>

        {/* Right Actions: Live Feed Button & Network Status */}
        <div className="flex items-center gap-2.5 self-end md:self-auto">
          <button
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium transition-all border cursor-pointer ${
              isLiveFeedActive
                ? (isBarangay ? 'bg-[#052659] text-white border-[#011025] shadow-xs' : 'bg-[#18181b] text-white border-neutral-800 shadow-xs')
                : (isBarangay ? 'bg-white text-[#052659] border-[#7EA0C5]/40 hover:bg-[#C2E8FF]/30' : 'bg-white text-neutral-700 border-neutral-200/80 hover:bg-neutral-50')
            }`}
          >
            <Radio className={`w-3.5 h-3.5 ${isLiveFeedActive ? 'animate-pulse' : ''}`} />
            <span>Live feed</span>
          </button>

          {/* Network status: pressing it re-checks the connection for real */}
          <button
            onClick={handleCheckConnection}
            className={`px-4 py-2 rounded-full text-xs font-medium border transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs ${
              isOnline
                ? (isBarangay ? 'bg-white text-[#052659] border-[#7EA0C5]/40 hover:bg-[#C2E8FF]/30' : 'bg-white text-neutral-700 border-neutral-200/80 hover:bg-neutral-50')
                : (isBarangay ? 'bg-[#052659] text-white border-[#011025] shadow-xs' : 'bg-[#18181b] text-white border-neutral-800 shadow-xs')
            }`}
            title="Check connection"
          >
            {isOnline ? (
              <>
                <Wifi className={`w-3.5 h-3.5 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`} />
                <span className="hidden sm:inline">Online</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-white" />
                <span>Offline Mode</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Action Flash Notice */}
      {statusNotification && (
        <div className={`p-3.5 rounded-[20px] ${
          isBarangay
            ? 'bg-[#C2E8FF]/30 border border-[#7EA0C5]/40 text-[#011025]'
            : 'bg-neutral-100/90 border border-neutral-200/80 text-neutral-800'
        } text-xs font-medium flex items-center justify-between animate-in fade-in`}>
          <div className="flex items-center gap-2">
            <Check className={`w-4 h-4 ${isBarangay ? 'text-[#052659]' : 'text-neutral-800'} shrink-0`} />
            <span>{statusNotification}</span>
          </div>
          <button
            onClick={() => setStatusNotification(null)}
            className={`cursor-pointer ${isBarangay ? 'text-[#7EA0C5] hover:text-[#011025] hover:bg-[#C2E8FF]/40' : 'text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200/60'} p-1 rounded-full transition-colors`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. Page Title Header: Exact wording from Screenshot */}
      <div className="px-1">
        <h1 className={`text-xl sm:text-2xl font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'} tracking-tight`}>
          Offline Readiness
        </h1>
        <p className={`text-xs sm:text-sm ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'} mt-0.5 max-w-2xl leading-relaxed`}>
          Progressive web app caching keeps the essentials available when networks fail.
        </p>
      </div>

      {/* 3. Top Row: 2-Column Grid (Hero Card Left, Service Worker Cache Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left Column: Hero Card with Corner Accents (8 cols) */}
        <div className={`lg:col-span-8 bg-white rounded-[24px] border ${isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200/70'} shadow-xs p-8 sm:p-12 relative flex flex-col items-center justify-center text-center overflow-hidden`}>
          {/* Decorative Corner Brackets (matching screenshot corner accents) */}
          <div className={`absolute top-4 left-4 w-5 h-5 border-t-2 border-l-2 ${isBarangay ? 'border-[#7EA0C5]' : 'border-neutral-300'} rounded-tl pointer-events-none`} />
          <div className={`absolute bottom-4 right-4 w-5 h-5 border-b-2 border-r-2 ${isBarangay ? 'border-[#7EA0C5]' : 'border-neutral-300'} rounded-br pointer-events-none`} />

          <div className="max-w-md mx-auto space-y-4">
            {/* Centered Offline Icon in Container */}
            <div className={`w-14 h-14 rounded-2xl ${
              isBarangay
                ? 'bg-[#C2E8FF]/40 border border-[#7EA0C5]/40 text-[#052659]'
                : 'bg-neutral-100 border border-neutral-200 text-neutral-700'
            } flex items-center justify-center mx-auto shadow-2xs`}>
              <TriadEmblem
                portal={portal}
                size={30}
                state={isCheckingConnection ? 'syncing' : isOnline ? 'idle' : 'offline'}
              />
            </div>

            {/* Title from screenshot */}
            <h3 className={`text-xl sm:text-2xl font-semibold ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'} tracking-tight`}>
              Offline Copy Ready
            </h3>

            {/* Subtitle from screenshot */}
            <p className={`text-xs sm:text-sm ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-600'} leading-relaxed font-normal`}>
              Cellular networks often fail during a disaster. UniGuard keeps hotlines, shelters and critical advisories on this device so they still open without a signal.
            </p>

            {/* Check Connection Action Button */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleCheckConnection}
                disabled={isCheckingConnection}
                className={`inline-flex items-center gap-2 px-6 py-2.5 rounded-full font-medium text-xs text-white ${
                  isBarangay
                    ? 'bg-[#052659] hover:bg-[#5482B4] border border-[#011025]'
                    : 'bg-[#18181b] hover:bg-neutral-800'
                } shadow-xs transition-all cursor-pointer disabled:opacity-50 active:scale-95`}
              >
                {isCheckingConnection ? (
                  <BrandLoader
                    mode="inline"
                    portal={portal}
                    process={pendingOutboxCount > 0 ? 'sync' : 'refresh'}
                    variant="reverse"
                    context={{ count: pendingOutboxCount, barangayName: currentUser?.barangay_name }}
                  />
                ) : (
                  <>
                    <Wifi className="w-4 h-4" />
                    <span>Check Connection</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Service Worker Cache Card (4 cols) */}
        <div className={`lg:col-span-4 bg-white rounded-[24px] border ${isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200/70'} shadow-xs p-6 flex flex-col justify-between space-y-5`}>
          <div>
            <h3 className={`text-sm font-semibold uppercase tracking-wide pb-3 border-b ${
              isBarangay ? 'text-[#011025] border-[#7EA0C5]/30' : 'text-neutral-900 border-neutral-100'
            }`}>
              Service Worker Cache
            </h3>

            {/* Key-Value Rows matching screenshot */}
            <div className="space-y-3.5 text-xs pt-3">
              <div className="flex items-center justify-between">
                <span className={isBarangay ? 'text-[#5482B4] font-medium' : 'text-neutral-500 font-medium'}>Last Successful Sync</span>
                <span className={`font-mono font-medium ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
                  {syncTimeFormatted} today
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className={isBarangay ? 'text-[#5482B4] font-medium' : 'text-neutral-500 font-medium'}>Reports Queued While Offline</span>
                <span className={`font-mono font-semibold px-2.5 py-0.5 rounded-full ${
                  isBarangay
                    ? 'text-[#052659] bg-[#C2E8FF]/60 border border-[#7EA0C5]/40'
                    : 'text-neutral-900 bg-neutral-100 border border-neutral-200/80'
                }`}>
                  {pendingOutboxCount} waiting
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className={isBarangay ? 'text-[#5482B4] font-medium' : 'text-neutral-500 font-medium'}>Strategy</span>
                <span className={`font-mono font-medium ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>Network first</span>
              </div>

              <div className="flex items-center justify-between">
                <span className={isBarangay ? 'text-[#5482B4] font-medium' : 'text-neutral-500 font-medium'}>Build</span>
                <span className={`font-mono font-medium ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>{CONFIG.BUILD}</span>
              </div>
            </div>
          </div>

          {/* Action Button & Caption */}
          <div className="space-y-2 pt-2">
            <button
              type="button"
              onClick={handleForceRefresh}
              disabled={isForceRefreshing}
              className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full font-medium text-xs ${
                isBarangay
                  ? 'text-[#052659] bg-[#C2E8FF]/40 hover:bg-[#C2E8FF]/70 border border-[#7EA0C5]/40'
                  : 'text-neutral-700 bg-neutral-100 hover:bg-neutral-200/80 border border-neutral-200/80'
              } transition-colors cursor-pointer disabled:opacity-50 shadow-2xs`}
            >
              {isForceRefreshing ? (
                <BrandLoader
                  mode="inline"
                  portal={portal}
                  process="refresh"
                  context={{ barangayName: currentUser?.barangay_name }}
                />
              ) : (
                <>
                  <RefreshCw className={`w-3.5 h-3.5 ${isBarangay ? 'text-[#052659]' : 'text-neutral-600'}`} />
                  <span>Force Refresh</span>
                </>
              )}
            </button>

            <p className={`text-[11px] text-center ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`}>
              Clears the offline cache and reloads the newest build.
            </p>
          </div>
        </div>
      </div>

      {/* 4. Bottom Row: Cached on This Device Card (Matching Screenshot) */}
      <div className={`bg-white rounded-[24px] border ${isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200/70'} shadow-xs p-6 space-y-4`}>
        <div className={`flex items-center justify-between pb-3 border-b ${isBarangay ? 'border-[#7EA0C5]/30' : 'border-neutral-100'}`}>
          <h3 className={`text-sm font-semibold uppercase tracking-wide ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
            Cached on This Device
          </h3>
          <span className={`text-xs font-mono font-medium ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'}`}>
            Synced Today, {syncTimeFormatted}
          </span>
        </div>

        <div className="space-y-2.5">
          {/* Row 1: Emergency Hotlines */}
          <div
            onClick={() => onNavigateTab && onNavigateTab('hotlines')}
            className={`p-4 sm:p-4.5 rounded-2xl border ${
              isBarangay
                ? 'border-[#7EA0C5]/30 bg-white hover:bg-[#C2E8FF]/20 hover:border-[#5482B4]'
                : 'border-neutral-200/70 bg-white hover:bg-neutral-50/70 hover:border-neutral-300'
            } transition-all flex items-center justify-between cursor-pointer group shadow-2xs`}
          >
            <div className="flex items-center gap-3.5">
              <PhoneCall className={`w-4 h-4 ${isBarangay ? 'text-[#052659]' : 'text-neutral-700'} group-hover:scale-110 transition-transform shrink-0`} />
              <span className={`text-xs sm:text-sm font-medium ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
                Emergency Hotlines
              </span>
            </div>

            <span className={`px-3 py-1 rounded-full font-mono text-[11px] font-medium tracking-wider shadow-2xs ${
              isBarangay
                ? 'bg-[#C2E8FF]/60 border border-[#7EA0C5]/40 text-[#052659]'
                : 'bg-neutral-100 border border-neutral-200/80 text-neutral-800'
            }`}>
              {hotlineCount} READY
            </span>
          </div>

          {/* Row 2: Evacuation Centers */}
          <div
            onClick={() => onNavigateTab && onNavigateTab('shelters')}
            className={`p-4 sm:p-4.5 rounded-2xl border ${
              isBarangay
                ? 'border-[#7EA0C5]/30 bg-white hover:bg-[#C2E8FF]/20 hover:border-[#5482B4]'
                : 'border-neutral-200/70 bg-white hover:bg-neutral-50/70 hover:border-neutral-300'
            } transition-all flex items-center justify-between cursor-pointer group shadow-2xs`}
          >
            <div className="flex items-center gap-3.5">
              <Building2 className={`w-4 h-4 ${isBarangay ? 'text-[#052659]' : 'text-neutral-700'} group-hover:scale-110 transition-transform shrink-0`} />
              <span className={`text-xs sm:text-sm font-medium ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
                Evacuation Centers
              </span>
            </div>

            <span className={`px-3 py-1 rounded-full font-mono text-[11px] font-medium tracking-wider shadow-2xs ${
              isBarangay
                ? 'bg-[#C2E8FF]/60 border border-[#7EA0C5]/40 text-[#052659]'
                : 'bg-neutral-100 border border-neutral-200/80 text-neutral-800'
            }`}>
              {shelterCount} READY
            </span>
          </div>

          {/* Row 3: Critical Advisories */}
          <div
            onClick={() => onNavigateTab && onNavigateTab('advisories')}
            className={`p-4 sm:p-4.5 rounded-2xl border ${
              isBarangay
                ? 'border-[#7EA0C5]/30 bg-white hover:bg-[#C2E8FF]/20 hover:border-[#5482B4]'
                : 'border-neutral-200/70 bg-white hover:bg-neutral-50/70 hover:border-neutral-300'
            } transition-all flex items-center justify-between cursor-pointer group shadow-2xs`}
          >
            <div className="flex items-center gap-3.5">
              <Megaphone className={`w-4 h-4 ${isBarangay ? 'text-[#052659]' : 'text-neutral-700'} group-hover:scale-110 transition-transform shrink-0`} />
              <span className={`text-xs sm:text-sm font-medium ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
                Critical Advisories
              </span>
            </div>

            <span className={`px-3 py-1 rounded-full font-mono text-[11px] font-medium tracking-wider shadow-2xs ${
              isBarangay
                ? 'bg-[#C2E8FF]/60 border border-[#7EA0C5]/40 text-[#052659]'
                : 'bg-neutral-100 border border-neutral-200/80 text-neutral-800'
            }`}>
              {advisoryCount} READY
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
