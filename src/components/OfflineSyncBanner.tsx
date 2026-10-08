import React, { useState } from 'react';
import { RefreshCw, CheckCircle2, ArrowUpCircle } from 'lucide-react';
import * as repo from '../services/repo';
import { BrandLoader, TriadEmblem, processCopy, type Portal } from '../brand';

interface OfflineSyncBannerProps {
  isOnline: boolean;
  pendingCount: number;
  onSyncCompleted: () => void;
  onOpenOfflineCenter?: () => void;
  /** the viewer's portal, so the banner speaks in their words */
  portal?: Portal;
}

export const OfflineSyncBanner: React.FC<OfflineSyncBannerProps> = ({
  isOnline,
  pendingCount,
  onSyncCompleted,
  onOpenOfflineCenter,
  portal = 'auth',
}) => {
  const [isSyncing, setIsSyncing] = useState(false);

  if (isOnline && pendingCount === 0) return null;

  const handleSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      await repo.flushQueue();
      onSyncCompleted();
    } finally {
      setIsSyncing(false);
    }
  };

  const offlineCopy = processCopy(portal, 'offline');

  return (
    <div className="bg-slate-900 text-slate-100 px-3.5 sm:px-6 lg:px-8 py-2 text-xs font-semibold flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-md border-b border-slate-800 w-full">
      <div
        onClick={onOpenOfflineCenter}
        className={`flex items-center gap-2 ${onOpenOfflineCenter ? 'cursor-pointer hover:text-red-300 transition-colors' : ''}`}
      >
        {isSyncing ? (
          <BrandLoader mode="inline" process="sync" portal={portal} variant="reverse" context={{ count: pendingCount }} />
        ) : (
          <>
            <TriadEmblem portal={portal} variant="reverse" size={18} state={isOnline ? 'idle' : 'offline'} className="shrink-0" />
            <span>
              {!isOnline
                ? `${offlineCopy.title} — ${offlineCopy.detail}.`
                : `${pendingCount} incident report(s) queued offline on your device.`}
            </span>
          </>
        )}
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
            disabled={isSyncing}
            className="bg-[#b91c1c] text-white hover:bg-[#991b1b] px-3 py-1 rounded-md text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-xs disabled:opacity-60"
          >
            <ArrowUpCircle className="w-3.5 h-3.5 text-white" />
            <span>Upload & Sync ({pendingCount})</span>
          </button>
        )}
      </div>
    </div>
  );
};
