import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { loadAppSettings, subscribeToThemeColorChanges, updateThemeColor } from "../api/backend";
import { applyThemeColor, DEFAULT_THEME_COLOR, normalizeThemeColor } from "../../../../shared/appearance/themeColor";

export function useThemeColor(notify: (message: string) => void, override?: string) {
  const [color, setColor] = useState(DEFAULT_THEME_COLOR);
  const [loading, setLoading] = useState(true);
  const appliedColor = override ?? color;
  useLayoutEffect(() => { applyThemeColor(appliedColor); }, [appliedColor]);

  useEffect(() => {
    let active = true;
    void loadAppSettings()
      .then((settings) => {
        if (!active) return;
        const nextColor = normalizeThemeColor(settings.themeColor);
        setColor(nextColor);
      })
      .catch((error) => notify(String(error)))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [notify]);

  useEffect(() => subscribeToThemeColorChanges((nextColor) => {
    setColor(normalizeThemeColor(nextColor));
  }), []);

  const updateColor = useCallback(async (nextColor: string) => {
    const normalized = normalizeThemeColor(nextColor);
    const previous = color;
    setColor(normalized);
    setLoading(true);
    try {
      const settings = await updateThemeColor(normalized);
      setColor(normalizeThemeColor(settings.themeColor));
    } catch (error) {
      setColor(previous);
      notify(String(error));
    } finally {
      setLoading(false);
    }
  }, [color, notify]);

  return { color, appliedColor, loading, setColor: updateColor };
}
