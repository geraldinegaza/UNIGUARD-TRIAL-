import React, { useEffect } from 'react';
import { AlertTriangle, MapPin, X, Check, ShieldAlert } from 'lucide-react';
import { Advisory } from '../types';
import { UniGuardLogo } from './UniGuardLogo';
import { relTime } from '../lib/util';
import type { Portal } from '../brand';

interface EmergencyAlertNotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAcknowledge?: () => void;
  advisory?: Advisory | null;
  /** the viewer's portal, so the beacon takes their palette */
  portal?: Portal;
}

export const EmergencyAlertNotificationModal: React.FC<EmergencyAlertNotificationModalProps> = ({
  isOpen,
  onClose,
  onAcknowledge,
  advisory,
  portal = 'auth',
}) => {
  // Play attention chime sound EXACTLY when notification pops up
  useEffect(() => {
    if (isOpen && typeof window !== 'undefined') {
      try {
        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioContextClass) {
          const ctx = new AudioContextClass();
          if (ctx.state === 'suspended') {
            ctx.resume();
          }
          const now = ctx.currentTime;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(587.33, now); // D5
          osc.frequency.setValueAtTime(880, now + 0.14); // A5 alert tone
          gain.gain.setValueAtTime(0.18, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.6);
        }
      } catch {
        // Audio policy ignore
      }
    }
  }, [isOpen]);

  if (!isOpen || !advisory) return null;

  const title = advisory.title;
  const content = advisory.content;
  const locationDisplay = advisory.affected_area;

  const handleAcknowledge = () => {
    if (onAcknowledge) {
      onAcknowledge();
    }
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="emergency-alert-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-neutral-900/40 backdrop-blur-xs transition-opacity duration-300"
    >
      {/* Alert Card styled to match reference dashboard card aesthetic */}
      <div className="relative w-full max-w-lg bg-white rounded-[24px] border border-neutral-200/80 shadow-2xl overflow-hidden p-5 sm:p-6 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header: Emergency Badge + Close Button */}
        <div className="flex items-center justify-between gap-3 pb-3.5 border-b border-neutral-100">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-100 text-neutral-800 border border-neutral-200/80 shadow-2xs">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neutral-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#18181b]" />
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider">
              Emergency Alert
            </span>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-500 hover:text-neutral-800 flex items-center justify-center transition-colors cursor-pointer border border-neutral-200/60"
            aria-label="Close notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="py-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-2xl bg-neutral-100 border border-neutral-200/70 flex items-center justify-center text-neutral-800 shrink-0 mt-0.5 shadow-2xs">
              <AlertTriangle className="w-5 h-5 text-neutral-800" />
            </div>

            <div className="min-w-0 flex-1">
              <h3
                id="emergency-alert-title"
                className="text-base font-semibold text-neutral-900 tracking-tight leading-snug"
              >
                {title}
              </h3>

              <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed mt-2 font-normal">
                {content}
              </p>
            </div>
          </div>

          {/* Location & Time Metadata */}
          <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 mt-4 pt-3.5 border-t border-neutral-100">
            <MapPin className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
            <span className="truncate">{locationDisplay}</span>
            <span className="text-neutral-300">•</span>
            <span>{relTime(advisory.created_at)}</span>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3 pt-3.5 border-t border-neutral-100">
          {/* Subtle branding matching the portal */}
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-400">
            <UniGuardLogo size="xs" portal={portal} state="alert" className="scale-75 origin-left" />
            <span>Municipality of Lingayen MDRRMO</span>
          </div>

          <button
            onClick={handleAcknowledge}
            className="w-full sm:w-auto px-5 py-2 rounded-full bg-[#18181b] hover:bg-neutral-800 text-white text-xs font-medium tracking-wide transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
          >
            <Check className="w-4 h-4" />
            <span>Acknowledge</span>
          </button>
        </div>

      </div>
    </div>
  );
};
