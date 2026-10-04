import React, { useState, useEffect } from 'react';
import { Download, X, Smartphone, ShieldCheck } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const PWAInstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Check if running on iOS Safari
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

    if (isIosDevice && !isStandalone) {
      setIsIOS(true);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  if (isDismissed || (!deferredPrompt && !isIOS)) return null;

  return (
    <aside
      aria-label="Install UniGuard Application"
      className="fixed bottom-4 left-4 z-40 max-w-sm bg-slate-900/95 text-white p-3.5 rounded-2xl shadow-2xl border border-slate-700 backdrop-blur-xs flex items-center justify-between gap-3 animate-in slide-in-from-bottom-4"
    >
      <div className="flex items-center gap-2.5">
        <span className="p-2 rounded-xl bg-[#b91c1c] text-white shrink-0">
          <Smartphone className="w-4 h-4" />
        </span>
        <div>
          <h4 className="text-xs font-bold text-white">Install UniGuard PWA</h4>
          <p className="text-[11px] text-slate-300">
            {isIOS
              ? 'Tap Share ⎋ then "Add to Home Screen" for offline disaster access.'
              : 'Add to home screen for offline emergency access and push alerts.'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {!isIOS && deferredPrompt && (
          <button
            onClick={handleInstallClick}
            className="bg-[#b91c1c] hover:bg-[#991b1b] text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-xs transition cursor-pointer"
          >
            Install
          </button>
        )}
        <button
          onClick={() => setIsDismissed(true)}
          className="text-slate-400 hover:text-white p-1 rounded-md"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
};
