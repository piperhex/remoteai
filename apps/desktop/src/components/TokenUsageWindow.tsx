import { useEffect } from "react";
import { ConfigProvider, theme as antdTheme } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import ruRU from "antd/locale/ru_RU";
import jaJP from "antd/locale/ja_JP";
import { useLanguage } from "../hooks/useLanguage";
import { useThemeColor } from "../hooks/useThemeColor";
import { useThemeMode } from "../hooks/useThemeMode";
import { useTokenUsagePreferences } from "../hooks/useTokenUsagePreferences";
import { TokenUsagePanel } from "./TokenUsagePanel";

const ignoreError = () => undefined;

export function TokenUsageWindow() {
  const { language } = useLanguage();
  const themeColor = useThemeColor(ignoreError);
  const themeMode = useThemeMode();
  const preferences = useTokenUsagePreferences(ignoreError);

  useEffect(() => {
    document.documentElement.classList.add("token-usage-page");
    return () => document.documentElement.classList.remove("token-usage-page");
  }, []);

  return (
    <ConfigProvider locale={{ zh: zhCN, en: enUS, ru: ruRU, ja: jaJP }[language]} theme={{
      algorithm: themeMode.mode === "dark"
        ? [antdTheme.darkAlgorithm, antdTheme.compactAlgorithm]
        : antdTheme.compactAlgorithm,
      token: {
        colorPrimary: themeColor.color,
        borderRadius: 6,
        fontFamily: "\"DM Sans\", \"Microsoft YaHei UI\", sans-serif",
      },
    }}>
      <TokenUsagePanel
        dark={themeMode.mode === "dark"}
        language={language}
        themeColor={themeColor.color}
        weeks={preferences.weeks}
        refreshSeconds={preferences.refreshSeconds}
        onWeeksChange={preferences.updateWeeks}
        preferencesLoading={preferences.loading}
      />
    </ConfigProvider>
  );
}
