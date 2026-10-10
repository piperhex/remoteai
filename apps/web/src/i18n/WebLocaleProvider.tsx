import { useThemeMode } from '../theme/preference';
import { useEffect, type ReactNode } from 'react';
import { theme, ConfigProvider as AntConfigProvider } from 'antd';
import { ConfigProvider as MobileConfigProvider } from 'antd-mobile';
import { setDefaultConfig } from 'antd-mobile/es/components/config-provider';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import ruRU from 'antd/locale/ru_RU';
import zhCNMobile from 'antd-mobile/es/locales/zh-CN';
import enUSMobile from 'antd-mobile/es/locales/en-US';
import ruRUMobile from 'antd-mobile/es/locales/ru-RU';
import { getLocale, useLanguage } from './language';

export function WebLocaleProvider({ children }: { children: ReactNode }) {
  const language = useLanguage();
  const mode = useThemeMode();
  const mobileLocale = { en: enUSMobile, zh: zhCNMobile, ru: ruRUMobile }[language];
  useEffect(() => {
    document.documentElement.lang = getLocale();
    document.title = language === 'en' ? 'Remote AI Web - Remote chat and account management'
      : language === 'ru' ? 'Remote AI Web — удалённые чаты и управление аккаунтами'
      : 'Remote AI Web - 远程 Codex 聊天与账号管理';
  }, [language]);
  // Imperative dialogs are rendered outside the provider tree.
  useEffect(() => { setDefaultConfig({ locale: mobileLocale }); }, [mobileLocale]);
  return <AntConfigProvider locale={{ en: enUS, zh: zhCN, ru: ruRU }[language]}
    theme={{ algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
      token: { colorPrimary: '#0b9b7c', borderRadius: 12,
      fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif" } }}>
    <MobileConfigProvider locale={mobileLocale}>
      {children}
    </MobileConfigProvider>
  </AntConfigProvider>;
}
