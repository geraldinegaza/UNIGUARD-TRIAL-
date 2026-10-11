import { useEffect } from 'react';
import { THEMES, type Portal } from './brandTokens';

/** Tints the browser / installed-PWA status bar and safe-area strips with the active portal's color. */
export function useBrandThemeColor(portal: Portal) {
  useEffect(() => {
    const color = THEMES[portal].themeColor;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = color;
    // the strips behind the notch and the home indicator of an installed app
    document.documentElement.style.setProperty('--ug-bar', color);
    document.documentElement.style.setProperty('--ug-surface', THEMES[portal].surface);
  }, [portal]);
}

export default useBrandThemeColor;
