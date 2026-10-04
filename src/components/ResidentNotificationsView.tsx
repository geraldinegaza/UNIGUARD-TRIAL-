import React, { useState, useMemo } from 'react';
import {
  Bell,
  Check,
  CheckCheck,
  AlertTriangle,
  Radio,
  Clock,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  MapPin,
  ExternalLink,
  Info,
  Search,
  Building2,
  Phone,
  ShieldCheck,
  Sparkles,
  Inbox
} from 'lucide-react';

import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import { AppNotification } from '../types';
import { relTime, syncLabel } from '../lib/util';

interface ResidentNotificationsViewProps {
  onNavigateTab?: (tab: string) => void;
}


interface NotificationItem {
  id: string;
  title: string;
  agency: string;
  time: string;
  severity: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'INFO';
  badgeColor: string;
  dotColor: string;
  description: string;
  category: 'critical' | 'alert' | 'advisory' | 'info';
  location?: string;
  actionTab?: string;
  actionLabel?: string;
  isRead?: boolean;
}

export const ResidentNotificationsView: React.FC<ResidentNotificationsViewProps> = ({
  onNavigateTab,
}) => {
  const { notifications, lastSync } = useRepo();

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isDeliveryProtocolExpanded, setIsDeliveryProtocolExpanded] = useState<boolean>(false);
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'critical' | 'advisory' | 'info'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedAlertId, setExpandedAlertId] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Notifications addressed to this account, from the notifications table
  const toItem = (n: AppNotification): NotificationItem => {
    const look = {
      emergency: { severity: 'CRITICAL', badgeColor: 'bg-red-900 text-white', dotColor: 'bg-red-900', category: 'critical' },
      warning: { severity: 'HIGH', badgeColor: 'bg-red-800 text-white', dotColor: 'bg-red-800', category: 'alert' },
      advisory: { severity: 'MODERATE', badgeColor: 'bg-red-950 text-white', dotColor: 'bg-red-950', category: 'advisory' },
      prepared: { severity: 'INFO', badgeColor: 'bg-neutral-900 text-white', dotColor: 'bg-neutral-900', category: 'info' },
    } as const;
    const l = look[n.tone] || look.advisory;
    const link = n.advisory_id
      ? { agency: 'Advisory', actionTab: 'advisories', actionLabel: 'Full Advisory Details' }
      : n.relief_id
      ? { agency: 'Relief', actionTab: 'relief', actionLabel: 'View Relief Schedule' }
      : n.report_id
      ? { agency: 'Report update', actionTab: 'overview', actionLabel: 'View Your Reports' }
      : n.road_work_id
      ? { agency: 'Road work' }
      : { agency: 'UniGuard' };
    return {
      id: n.id,
      title: n.title,
      time: relTime(n.created_at),
      description: n.body,
      isRead: !n.unread,
      ...l,
      ...link,
    };
  };
  const initialAlerts: NotificationItem[] = useMemo(() => notifications.map(toItem), [notifications]);
  const readItemIds = useMemo(() => new Set(notifications.filter((n) => !n.unread).map((n) => n.id)), [notifications]);
  const latest = notifications[0];
  const latestItem = initialAlerts[0];
  const deliveredToday = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return notifications.filter((n) => Date.parse(n.created_at) >= startOfDay.getTime()).length;
  }, [notifications]);

  // Mark an individual item as read
  const toggleItemRead = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (readItemIds.has(id)) return;
    try {
      await repo.markRead(id);
      showToast('Notification marked as read.');
    } catch (err: any) {
      showToast(err.message || 'Could not update the notification.');
    }
  };

  // Mark all as read
  const handleMarkAllRead = async () => {
    try {
      await repo.markAllRead();
      showToast('All notifications marked as read.');
    } catch (err: any) {
      showToast(err.message || 'Could not update notifications.');
    }
  };

  const unreadCount = initialAlerts.filter((a) => !readItemIds.has(a.id)).length;

  // Filtered and searched alerts
  const filteredAlerts = useMemo(() => {
    return initialAlerts.filter((alert) => {
      // Category filter
      if (selectedFilter === 'critical' && alert.category !== 'critical') return false;
      if (selectedFilter === 'advisory' && (alert.category !== 'advisory' && alert.category !== 'alert')) return false;
      if (selectedFilter === 'info' && alert.category !== 'info') return false;

      // Text search
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesTitle = alert.title.toLowerCase().includes(query);
        const matchesAgency = alert.agency.toLowerCase().includes(query);
        const matchesDesc = alert.description.toLowerCase().includes(query);
        const matchesLocation = (alert.location || '').toLowerCase().includes(query);
        if (!matchesTitle && !matchesAgency && !matchesDesc && !matchesLocation) return false;
      }

      return true;
    });
  }, [initialAlerts, selectedFilter, searchQuery]);

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-200">
      {/* 1. Header Section: Subtitle & Mark All Read Action (Matching Home Header) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
        <div>
          <p className="text-sm sm:text-base font-semibold text-neutral-800">
            Emergency notifications &amp; alerts for <span className="font-extrabold text-red-900">Lingayen, Pangasinan</span>.
          </p>
          <p className="text-xs sm:text-sm text-neutral-500 mt-0.5">
            Push notifications delivered to this device, including emergency alerts received while the app was closed.
          </p>
        </div>

        <button
          onClick={handleMarkAllRead}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-red-900 hover:bg-red-800 text-white text-xs sm:text-sm font-bold transition-all shadow-lg hover:shadow-xl cursor-pointer active:scale-95 w-fit shrink-0"
        >
          <CheckCheck className="w-4 h-4 text-white" />
          <span>Mark All as Read</span>
        </button>
      </div>

      {/* 2. Three KPI Metric Cards with icons, bold labels, and tabular figures (Matching Home Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
        {/* Card 1: Delivered Today (Signature Hero Dark Red Card) */}
        <div className="bg-gradient-to-br from-red-800 via-red-900 to-red-950 text-white rounded-3xl p-6 sm:p-7 shadow-xl hover:shadow-2xl border border-red-900/40 flex flex-col justify-between min-w-0 w-full relative overflow-hidden group transition-all duration-300">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-red-100/80">
                Delivered Today
              </p>
              <p className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight font-mono tabular-nums mt-2">
                {deliveredToday}
              </p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-white/15 text-white border border-white/20 flex items-center justify-center shadow-md group-hover:scale-105 transition-transform shrink-0">
              <Bell className="w-6 h-6 text-white" />
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-white/15 flex items-center gap-2 text-xs text-red-100/90 font-medium">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span>Active push notifications delivered to device</span>
          </div>
        </div>

        {/* Card 2: Unread Bulletins (Clean White Floating Card) */}
        <div className="bg-white rounded-3xl p-6 sm:p-7 shadow-xl hover:shadow-2xl border border-neutral-100/80 transition-all duration-300 flex flex-col justify-between group min-w-0 w-full">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                Unread Alerts
              </p>
              <p className="text-4xl sm:text-5xl font-extrabold text-neutral-900 group-hover:text-red-900 transition-colors tracking-tight font-mono tabular-nums mt-2">
                {unreadCount}
              </p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-900 border border-red-100/60 flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform shrink-0">
              <AlertTriangle className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-neutral-100 flex items-center justify-between text-xs text-neutral-500 font-medium">
            <span className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${unreadCount > 0 ? 'bg-red-900' : 'bg-emerald-600'}`} />
              <span>{unreadCount > 0 ? 'Pending acknowledgement' : 'All alerts acknowledged'}</span>
            </span>
            <span className="font-mono font-bold text-neutral-700 tabular-nums">
              {unreadCount === 0 ? 'All Cleared' : 'Needs Review'}
            </span>
          </div>
        </div>

        {/* Card 3: Delivery Channel (Clean White Floating Card) */}
        <div className="bg-white rounded-3xl p-6 sm:p-7 shadow-xl hover:shadow-2xl border border-neutral-100/80 transition-all duration-300 flex flex-col justify-between group min-w-0 w-full sm:col-span-2 lg:col-span-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                Delivery Channel
              </p>
              <p className="text-2xl sm:text-3xl font-extrabold text-red-900 group-hover:text-red-800 transition-colors tracking-tight font-mono tabular-nums mt-3">
                Push + Inbox
              </p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-900 border border-red-100/60 flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform shrink-0">
              <Radio className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-neutral-100 flex items-center justify-between text-xs text-neutral-500 font-medium">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-900" />
              <span>Offline queue verified</span>
            </span>
            <span className="font-mono font-bold text-red-900 tabular-nums">
              Active
            </span>
          </div>
        </div>
      </div>

      {/* 3. Hero Latest Broadcast Alert Card with Collapsible Safety Directives (Matching Home Push Alert Card) */}
      {latest && latestItem && (
      <div className="rounded-3xl border border-red-950/40 bg-gradient-to-br from-red-800 via-red-900 to-red-950 p-6 sm:p-8 text-white shadow-2xl relative overflow-hidden">
        <div className="relative z-10 space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="px-3 py-1 rounded-xl bg-white text-red-900 text-xs font-black uppercase tracking-wider shadow-md">
              {latestItem.severity}
            </span>
            <span className="px-3 py-1 rounded-xl bg-red-950/80 text-white text-xs font-bold uppercase tracking-wider border border-white/20">
              LATEST BROADCAST
            </span>
          </div>

          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
            {latest.title}
          </h2>

          <div className="flex items-center gap-2 text-xs sm:text-sm text-red-100/90 font-medium">
            <MapPin className="w-4 h-4 text-white shrink-0" />
            <span>{latestItem.agency} • Delivered to device • {latestItem.time}</span>
          </div>

          <p className="text-xs sm:text-sm text-red-100/90 max-w-2xl leading-relaxed">
            {latest.body}
          </p>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 pt-1 flex-wrap">
            {onNavigateTab && (
              <button
                onClick={() => onNavigateTab('shelters')}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-white text-red-900 hover:bg-red-50 text-xs sm:text-sm font-bold transition-all shadow-md cursor-pointer active:scale-95"
              >
                <Building2 className="w-4 h-4 text-red-900" />
                <span>View Open Shelters</span>
              </button>
            )}

            <button
              onClick={handleMarkAllRead}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-white/15 hover:bg-white/25 text-white text-xs sm:text-sm font-bold border border-white/20 transition-all cursor-pointer active:scale-95"
            >
              <Check className="w-4 h-4 text-white" />
              <span>Acknowledge Notice</span>
            </button>
          </div>

          {/* Collapsible Action Directives Toggle (Matching Home Accordion) */}
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setIsDeliveryProtocolExpanded(!isDeliveryProtocolExpanded)}
              className="inline-flex items-center gap-2 text-xs sm:text-sm font-bold text-white bg-white/15 hover:bg-white/25 px-5 py-2.5 rounded-2xl transition-all shadow-sm cursor-pointer"
            >
              <span>{isDeliveryProtocolExpanded ? 'Hide Delivery Guarantees' : 'View Push Notification Delivery Guarantees & Offline Persistence'}</span>
              {isDeliveryProtocolExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {isDeliveryProtocolExpanded && (
              <div className="mt-4 p-5 rounded-2xl bg-red-950/90 border border-white/15 text-xs sm:text-sm text-red-50 space-y-3 shadow-inner animate-in fade-in duration-200">
                <div className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-white text-red-950 text-xs font-black flex items-center justify-center shrink-0 mt-0.5 shadow-sm">1</span>
                  <span><strong>Background Push Reception:</strong> Emergency alerts trigger system-level banners even when the UniGuard application process is closed.</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-white text-red-950 text-xs font-black flex items-center justify-center shrink-0 mt-0.5 shadow-sm">2</span>
                  <span><strong>Zero-Signal Offline Cache:</strong> If cellular network coverage is lost, incoming messages remain queued in the offline cache and are immediately synchronized upon signal reconnection.</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-white text-red-950 text-xs font-black flex items-center justify-center shrink-0 mt-0.5 shadow-sm">3</span>
                  <span><strong>Official Authentication:</strong> All broadcast notifications originate strictly from verified LDRRMC administrators and the Municipal Mayor's Emergency Desk.</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Decorative Background Motif */}
        <div className="absolute right-2 -bottom-6 opacity-10 pointer-events-none">
          <Bell className="w-48 h-48 text-white" />
        </div>
      </div>
      )}

      {/* 4. Section: Delivered Notifications Log (Matching Home's Section Container Style) */}
      <div className="bg-white rounded-3xl border border-neutral-100/80 overflow-hidden shadow-xl hover:shadow-2xl transition-shadow">
        <div className="p-6 sm:p-7 pb-5 border-b border-neutral-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white">
          <div>
            <div className="flex items-center gap-2.5">
              <h3 className="text-base sm:text-lg font-bold text-neutral-900 tracking-tight">
                Delivered Notifications &amp; Bulletins
              </h3>
              <span className="text-xs font-bold text-red-900 bg-red-50 border border-red-900/20 px-3 py-0.5 rounded-full font-mono">
                {filteredAlerts.length} logged
              </span>
            </div>
            <p className="text-xs text-neutral-500 mt-1">
              Complete chronological log of civil emergency notices and advisory broadcasts received by this device
            </p>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setSelectedFilter('all')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition cursor-pointer ${
                selectedFilter === 'all'
                  ? 'bg-red-900 text-white shadow-xs'
                  : 'bg-white border border-neutral-200 text-neutral-700 hover:border-red-900/40'
              }`}
            >
              All ({initialAlerts.length})
            </button>
            <button
              onClick={() => setSelectedFilter('critical')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition cursor-pointer ${
                selectedFilter === 'critical'
                  ? 'bg-red-900 text-white shadow-xs'
                  : 'bg-white border border-neutral-200 text-neutral-700 hover:border-red-900/40'
              }`}
            >
              Critical
            </button>
            <button
              onClick={() => setSelectedFilter('advisory')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition cursor-pointer ${
                selectedFilter === 'advisory'
                  ? 'bg-red-900 text-white shadow-xs'
                  : 'bg-white border border-neutral-200 text-neutral-700 hover:border-red-900/40'
              }`}
            >
              Advisories
            </button>
            <button
              onClick={() => setSelectedFilter('info')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition cursor-pointer ${
                selectedFilter === 'info'
                  ? 'bg-red-900 text-white shadow-xs'
                  : 'bg-white border border-neutral-200 text-neutral-700 hover:border-red-900/40'
              }`}
            >
              Info
            </button>
          </div>
        </div>

        {/* Quick Search Bar */}
        <div className="p-4 sm:p-5 bg-neutral-50/50 border-b border-neutral-100">
          <div className="relative">
            <Search className="w-4 h-4 text-neutral-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notifications by keyword, agency, or location..."
              className="w-full pl-11 pr-4 py-2.5 bg-white border border-neutral-200 rounded-2xl text-xs sm:text-sm text-neutral-800 placeholder-neutral-400 focus:outline-none focus:border-red-900 focus:ring-1 focus:ring-red-900 transition-all shadow-xs"
            />
          </div>
        </div>

        {/* Divided List */}
        <div className="divide-y divide-neutral-100">
          {filteredAlerts.length === 0 ? (
            <div className="text-center py-12 px-4 space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-neutral-100 text-neutral-400 flex items-center justify-center mx-auto">
                <Inbox className="w-6 h-6" />
              </div>
              <p className="text-sm font-bold text-neutral-700">No notifications match your filter</p>
              <p className="text-xs text-neutral-400">Try clearing the search query or selecting a different category.</p>
            </div>
          ) : (
            filteredAlerts.map((alert) => {
              const isRead = readItemIds.has(alert.id);
              const isExpanded = expandedAlertId === alert.id;

              return (
                <div
                  key={alert.id}
                  onClick={() => setExpandedAlertId(isExpanded ? null : alert.id)}
                  className={`p-5 sm:p-6 transition-colors flex flex-col gap-3 cursor-pointer ${
                    isRead ? 'bg-white hover:bg-neutral-50/80' : 'bg-red-50/20 hover:bg-red-50/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2.5">
                        <span className={`w-2.5 h-2.5 rounded-full ${alert.dotColor} shrink-0`} />
                        <h4 className={`text-sm font-bold truncate ${isRead ? 'text-neutral-800' : 'text-neutral-900'}`}>
                          {alert.title}
                        </h4>
                        {!isRead && (
                          <span className="w-2 h-2 rounded-full bg-red-900 shrink-0" title="Unread alert" />
                        )}
                      </div>

                      <p className="text-xs text-neutral-600 pl-5 leading-relaxed line-clamp-2">
                        {alert.description}
                      </p>

                      <div className="flex items-center gap-3 text-xs text-neutral-400 pl-5 flex-wrap">
                        <span className="font-medium text-neutral-500">{alert.agency}</span>
                        {alert.location && (
                          <>
                            <span>•</span>
                            <span className="flex items-center gap-1 text-neutral-500">
                              <MapPin className="w-3 h-3 text-neutral-400" />
                              <span>{alert.location}</span>
                            </span>
                          </>
                        )}
                        <span>•</span>
                        <span className="flex items-center gap-1 text-emerald-700 font-semibold">
                          <Check className="w-3.5 h-3.5" />
                          <span>Delivered ({alert.time})</span>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-xs font-bold uppercase px-3 py-1.5 rounded-xl shadow-xs ${alert.badgeColor}`}
                      >
                        {alert.severity}
                      </span>
                    </div>
                  </div>

                  {/* Expanded Detail Panel */}
                  {isExpanded && (
                    <div className="pl-5 pt-2 border-t border-neutral-100 mt-2 space-y-3 animate-in fade-in duration-150">
                      <p className="text-xs sm:text-sm text-neutral-700 leading-relaxed bg-neutral-50 p-4 rounded-2xl border border-neutral-100">
                        {alert.description}
                      </p>

                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                          {alert.actionTab && onNavigateTab && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onNavigateTab(alert.actionTab!);
                              }}
                              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-bold transition shadow-xs cursor-pointer active:scale-95"
                            >
                              <span>{alert.actionLabel || 'View Related Section'}</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        <button
                          onClick={(e) => toggleItemRead(alert.id, e)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white border border-neutral-200 hover:border-red-900/40 text-neutral-700 text-xs font-bold transition cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5 text-neutral-500" />
                          <span>{isRead ? 'Read' : 'Mark as Read'}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 5. Delivery Channel Guarantee Notice Box (Matching Home's Advisory Style) */}
      <div className="rounded-3xl border border-neutral-100/80 bg-white p-6 sm:p-7 shadow-xl flex items-start gap-4">
        <div className="w-10 h-10 rounded-2xl bg-red-50 text-red-900 border border-red-100/60 flex items-center justify-center shrink-0 shadow-2xs">
          <Radio className="w-5 h-5 text-red-900 animate-pulse" />
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-bold text-neutral-900">
            Offline Push &amp; Synchronized Message Queue
          </h4>
          <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed font-medium">
            Emergency alerts are delivered even when the application is closed, and are queued for the offline inbox when cellular signal is unavailable. Once you reconnect to any network, pending bulletins sync automatically.
          </p>
        </div>
      </div>

      {/* 6. Bottom Offline Status Footer Bar (Matching Home Draft) */}
      <div className="rounded-3xl border border-neutral-100/80 bg-white p-6 sm:p-7 text-xs text-neutral-700 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-neutral-500">Offline copy:</span>
            <span className="font-bold text-red-900 bg-red-50 px-2.5 py-0.5 rounded-full border border-red-900/20">{lastSync ? 'Ready' : 'Not yet synced'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-neutral-500">Last sync:</span>
            <span className="font-bold text-neutral-900">{syncLabel(lastSync)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:self-center">
          <span className="font-semibold text-neutral-500">Push alerts logged:</span>
          <span className="font-bold text-white bg-neutral-900 px-3 py-1 rounded-xl shadow-xs">
            {initialAlerts.length}
          </span>
        </div>
      </div>

      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-neutral-900 text-white px-5 py-3 rounded-2xl shadow-2xl border border-white/20 text-xs font-bold flex items-center gap-2 animate-in slide-in-from-bottom-2">
          <CheckCheck className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
