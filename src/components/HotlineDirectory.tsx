import React, { useState } from 'react';
import { EmergencyHotline, Barangay } from '../types';
import { Phone, Download, Check, Info } from 'lucide-react';
import * as repo from '../services/repo';
import { telHref } from '../lib/util';

interface HotlineDirectoryProps {
  hotlines: EmergencyHotline[];
  barangays: Barangay[];
  isOnline: boolean;
}

export const HotlineDirectory: React.FC<HotlineDirectoryProps> = ({
  hotlines,
  barangays: _barangays,
  isOnline: _isOnline,
}) => {
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleSaveOffline = async () => {
    await repo.saveOffline();
    showToast('Saved all emergency hotlines to offline device storage!');
  };

  const displayHotlines = hotlines;

  const getHotlineTag = (h: EmergencyHotline) => {
    const name = h.agency_name.toLowerCase();
    const scope = h.scope.toLowerCase();
    if (name.includes('bfp') || name.includes('fire')) return 'FIRE AND RESCUE';
    if (name.includes('pnp') || name.includes('police')) return 'POLICE ASSISTANCE';
    if (/medical|health|red cross|relief/.test(scope + ' ' + name)) return 'MEDICAL AND RELIEF';
    if (name.includes('coast guard')) return 'COASTAL RESCUE';
    return h.scope.toUpperCase();
  };

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-200">
      {/* 1. Header: Save Offline action bar matching Home styling */}
      <div className="flex items-center justify-end pb-1">
        <button
          onClick={handleSaveOffline}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-bold transition-all shadow-md hover:shadow-lg cursor-pointer active:scale-95 w-fit shrink-0"
        >
          <Download className="w-3.5 h-3.5 text-white" />
          <span>Save Offline</span>
        </button>
      </div>

      {/* 2. Hotlines List: Formatted as a clean list matching the Home tab's list style */}
      <div className="bg-white rounded-3xl border border-neutral-100/80 overflow-hidden shadow-xl hover:shadow-2xl transition-shadow">
        <div className="divide-y divide-neutral-100">
          {displayHotlines.map((hotline) => {
            const tag = getHotlineTag(hotline);

            return (
              <div
                key={hotline.id}
                className="p-5 sm:p-6 hover:bg-red-50/30 transition-colors flex items-center justify-between gap-4"
              >
                <div className="space-y-1.5 min-w-0">
                  <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-red-900 bg-red-50 border border-red-900/20 px-2.5 py-0.5 rounded-full w-fit">
                    {tag}
                  </span>
                  <h4 className="text-sm sm:text-base font-bold text-neutral-900 truncate">
                    {hotline.agency_name}
                  </h4>
                  <p className="text-xs sm:text-sm font-semibold text-neutral-600 font-mono">
                    {hotline.contact_number}
                  </p>
                </div>

                <a
                  href={telHref(hotline.contact_number)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-50 text-red-900 hover:bg-red-900 hover:text-white border border-red-900/20 text-xs font-bold transition-all shadow-xs active:scale-95 shrink-0 cursor-pointer"
                  title={`Call ${hotline.agency_name}`}
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>Call</span>
                </a>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Bottom Guidance Note strictly matching the screenshot */}
      <div className="rounded-3xl border border-neutral-100/80 bg-white p-5 sm:p-6 text-xs text-neutral-600 shadow-xl flex items-start sm:items-center gap-3.5">
        <div className="w-8 h-8 rounded-xl bg-red-50 text-red-900 border border-red-100/60 flex items-center justify-center shrink-0 shadow-2xs">
          <Info className="w-4 h-4 text-red-900" />
        </div>
        <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed font-medium">
          If a line is busy, keep the call short and state your barangay, landmark and number of people needing help.
        </p>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-neutral-900 text-white px-5 py-3 rounded-2xl shadow-2xl border border-white/20 text-xs font-bold flex items-center gap-2 animate-in slide-in-from-bottom-2">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
