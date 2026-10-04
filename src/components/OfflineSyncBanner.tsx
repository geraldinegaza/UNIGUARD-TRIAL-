import React from 'react';
import { WifiOff, RefreshCw, CheckCircle2, ArrowUpCircle } from 'lucide-react';
import * as repo from '../services/repo';

interface OfflineSyncBannerProps {
  isOnline: boolean;
  pendingCount: number;
  onSyncCompleted: () => void;
  onOpenOfflineCenter?: () => void;
}

export const OfflineSyncBanner: React.FC<OfflineSyncBannerProps> = ({
  isOnline,
  pendingCount,
  onSyncCompleted,
  onOpenOfflineCenter,
}) => {
  if (isOnline && pendingCount === 0) return null;

  const handleSync = async () => {
    await repo.flushQueue();
    onSyncCompleted();
  };

  return (
    <div className="bg-slate-900 text-slate-100 px-3.5 sm:px-6 lg:px-8 py-2 text-xs font-semibold flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-md border-b border-slate-800 w-full">
      <div
        onClick={onOpenOfflineCenter}
        className={`flex items-center gap-2 ${onOpenOfflineCenter ? 'cursor-pointer hover:text-red-300 transition-colors' : ''}`}
      >
        <WifiOff className="w-4 h-4 shrink-0 text-[#ef4444]" />
        <span>
          {!isOnline
            ? 'Offline Mode Active — Viewing locally-cached emergency shelters, hotlines, and hazard bulletins.'
            : `${pendingCount} incident report(s) queued offline on your device.`}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {onOpenOfflineCenter && (
          <button
            onClick={onOpenOfflineCenter}
            className="text-red-300 hover:text-white underline text-xs font-semibold px-2 py-0.5 cursor-pointer"
          >
            Offline Center
          </button>
        )}
        {pendingCount > 0 && isOnline && (
          <button
            onClick={handleSync}
            className="bg-[#b91c1c] text-white hover:bg-[#991b1b] px-3 py-1 rounded-md text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-xs"
          >
            <ArrowUpCircle className="w-3.5 h-3.5 text-white" />
            <span>Upload & Sync ({pendingCount})</span>
          </button>
        )}
      </div>
    </div>
  );
};
