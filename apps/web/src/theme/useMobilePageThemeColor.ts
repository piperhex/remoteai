import { useLayoutEffect } from 'react';
import { darkColors } from '../../../../shared/theme/mode';
import { browserThemeColor, getThemeMode, subscribeTheme } from './preference';

/** Match supported mobile browsers' top chrome to the visible page, restoring it on exit. */
export function useMobilePageThemeColor(lightColor: string) {
  useLayoutEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    const mobile = window.matchMedia('(max-width: 860px)');
    const restore = () => meta.setAttribute('content', browserThemeColor());
    const update = () => {
      const pageColor = getThemeMode() === 'dark' ? darkColors.canvas : lightColor;
      meta.setAttribute('content', mobile.matches ? pageColor : browserThemeColor());
    };
    update();
    const unsubscribe = subscribeTheme(update);
    mobile.addEventListener('change', update);
    return () => { unsubscribe(); mobile.removeEventListener('change', update); restore(); };
  }, [lightColor]);
}
