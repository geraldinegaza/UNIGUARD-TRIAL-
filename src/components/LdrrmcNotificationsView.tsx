import React from 'react';
import { Megaphone, Bell, Check, Clock, ChevronRight } from 'lucide-react';

import { User } from '../types';
import { useRepo } from '../hooks/useRepo';
import * as repo from '../services/repo';
import { relTime } from '../lib/util';

interface LdrrmcNotificationsViewProps {
  onNavigateTab?: (tab: string) => void;
  currentUser?: User;
}

export const LdrrmcNotificationsView: React.FC<LdrrmcNotificationsViewProps> = ({
  onNavigateTab,
  currentUser,
}) => {
  const isBarangay = currentUser?.role === 'barangay';

  // Notifications addressed to this account, from the notifications table
  const stored = useRepo().notifications;
  const notifications = stored.map((n) => ({
    id: n.id,
    title: n.title,
    timeAgo: relTime(n.created_at),
    isNew: n.unread,
    // a notification deep-links to whatever it is about
    tab: n.sos_id ? 'sos_log' : n.report_id ? 'incidents' : n.road_work_id ? 'road_work' : n.relief_id ? 'relief' : 'advisories',
  }));

  const unreadCount = stored.filter((n) => n.unread).length;
  const hasMarkedRead = unreadCount === 0;
  const setHasMarkedRead = (_all: boolean) => {
    repo.markAllRead().catch(() => {});
  };

  return (
    <div className="space-y-6 sm:space-y-7 animate-in fade-in duration-300">
      {/* 1. Page Header */}
      <div className="px-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className={`text-xl sm:text-2xl font-semibold tracking-tight ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
            Push notification log
          </h1>
          <p className={`text-xs sm:text-sm mt-0.5 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
            Every alert delivered to citizen devices.
          </p>
        </div>

        <button
          onClick={() => setHasMarkedRead(true)}
          className={`px-4 py-2 rounded-full text-xs font-medium transition-all cursor-pointer shadow-2xs border ${
            hasMarkedRead
              ? (isBarangay ? 'bg-[#C2E8FF]/30 text-[#7EA0C5] border-[#7EA0C5]/40' : 'bg-neutral-100 text-neutral-400 border-neutral-200')
              : (isBarangay ? 'bg-white hover:bg-[#C2E8FF]/30 text-[#052659] border-[#7EA0C5]/40' : 'bg-white hover:bg-neutral-50 text-neutral-700 hover:text-neutral-900 border-neutral-200/80')
          }`}
        >
          <span>Mark All Read</span>
        </button>
      </div>

      {/* 2. Inbox Header Row */}
      <div className={`bg-white rounded-[24px] border ${isBarangay ? 'border-[#7EA0C5]/40' : 'border-neutral-200/70'} shadow-xs overflow-hidden`}>
        <div className={`px-6 py-4.5 ${isBarangay ? 'bg-[#C2E8FF]/15 border-[#7EA0C5]/30' : 'bg-neutral-50/50 border-neutral-100'} border-b flex items-center justify-between`}>
          <div>
            <span className={`text-[10px] sm:text-xs font-semibold uppercase tracking-wider ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'}`}>
              PUSH NOTIFICATIONS
            </span>
            <h2 className={`text-xl sm:text-2xl font-bold tracking-tight mt-0.5 ${isBarangay ? 'text-[#011025]' : 'text-neutral-900'}`}>
              Inbox
            </h2>
            <p className={`text-xs font-medium mt-1 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-500'}`}>
              {unreadCount} unread
            </p>
          </div>

          <button
            onClick={() => setHasMarkedRead(true)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs border ${
              hasMarkedRead
                ? (isBarangay ? 'bg-[#C2E8FF]/30 text-[#7EA0C5] border-[#7EA0C5]/40' : 'bg-neutral-100 text-neutral-400 border-neutral-200')
                : (isBarangay ? 'bg-[#052659] hover:bg-[#5482B4] text-white border border-[#011025]' : 'bg-[#18181b] hover:bg-neutral-800 text-white border-neutral-800')
            }`}
          >
            <Check className="w-3.5 h-3.5" />
            <span>Mark All Read</span>
          </button>
        </div>

        {/* 3. Notifications List Card Container */}
        <div className={`divide-y ${isBarangay ? 'divide-[#7EA0C5]/20' : 'divide-neutral-100'}`}>
          {notifications.map((item) => (
            <div
              key={item.id}
              onClick={() => {
                repo.markRead(item.id).catch(() => {});
                if (onNavigateTab) onNavigateTab(item.tab);
              }}
              className={`p-4 sm:p-5 flex items-center justify-between gap-3 sm:gap-4 ${
                isBarangay ? 'hover:bg-[#C2E8FF]/20' : 'hover:bg-neutral-50/60'
              } transition-colors cursor-pointer group`}
            >
              <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                {/* Megaphone icon container */}
                <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl ${
                  isBarangay
                    ? 'bg-[#C2E8FF]/40 border border-[#7EA0C5]/40 text-[#052659] group-hover:bg-[#052659] group-hover:text-white'
                    : 'bg-neutral-100 border border-neutral-200/70 text-neutral-800 group-hover:bg-[#18181b] group-hover:text-white'
                } flex items-center justify-center shrink-0 shadow-2xs transition-colors`}>
                  <Megaphone className="w-5 h-5" />
                </div>

                {/* Text Information */}
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className={`text-sm sm:text-base font-semibold ${
                      isBarangay ? 'text-[#011025] group-hover:text-[#052659]' : 'text-neutral-900 group-hover:text-black'
                    } truncate transition-colors`}>
                      {item.title}
                    </h3>
                    {item.isNew && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider text-white ${
                        isBarangay ? 'bg-[#052659]' : 'bg-[#18181b]'
                      } shadow-2xs`}>
                        NEW
                      </span>
                    )}
                  </div>

                  <div className={`flex items-center gap-1.5 text-xs ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'} pt-0.5`}>
                    <Clock className={`w-3.5 h-3.5 ${isBarangay ? 'text-[#7EA0C5]' : 'text-neutral-400'} shrink-0`} />
                    <span>{item.timeAgo}</span>
                  </div>
                </div>
              </div>

              {/* Right Chevron */}
              <div className={`${isBarangay ? 'text-[#7EA0C5] group-hover:text-[#052659]' : 'text-neutral-400 group-hover:text-neutral-700'} transition-colors shrink-0`}>
                <ChevronRight className="w-5 h-5" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Bottom Persistence Callout */}
      <div className={`mt-8 flex items-center justify-center gap-2 text-xs ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'} text-center font-normal`}>
        <Bell className={`w-4 h-4 ${isBarangay ? 'text-[#5482B4]' : 'text-neutral-400'}`} />
        <span>Alerts are delivered even when the app is closed. History persists on this device.</span>
      </div>
    </div>
  );
};
