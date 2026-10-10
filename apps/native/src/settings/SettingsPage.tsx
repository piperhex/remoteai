import { useThemeColor } from '../theme/store';
import { t, useLanguage, languageLabel } from '../i18n';
import { LanguageSheet } from './LanguageSheet';
import { ThemeSheet } from './ThemeSheet';
import { useThemeMode } from '../theme/preference';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { TotpSyncSettings } from '../totp/TotpSyncSettings';
import type { TotpManagerState } from '../totp/types';
import type { AuthSession, UserProfile } from '../types';
import { CURRENT_APP_VERSION } from '../update/appUpdate';
import { PasswordSheet } from './PasswordSheet';
import { RefreshIntervalSheet } from './RefreshIntervalSheet';
import { SettingsRow } from './SettingsRow';
import { DesktopVersionSheet } from './DesktopVersionSheet';
import { settingsColors, useStyles } from './styles';

interface SettingsPageProps {
  session: AuthSession;
  profile: UserProfile | null;
  globalRefreshMinutes: number;
  onGlobalRefreshMinutesChange: (minutes: number) => Promise<void>;
  onOpenAbout: () => void;
  onOpenAdmin: () => void;
  onOpenDownloads: () => void;
  onLogout: () => void;
  totpManager: TotpManagerState;
}

type SettingsPanel = 'profile' | 'identity' | 'refresh' | 'totp' | 'password' | 'logout'
  | 'desktop' | 'language' | 'theme' | null;

function identityLabel(profile?: UserProfile | null) {
  if (!profile) return t("加载中…");
  if (profile.roleName) return profile.roleName;
  if (profile.role === 'admin') return t("管理员");
  return profile.role === 'user' ? t("用户") : profile.role;
}

export function SettingsPage({ session, profile, globalRefreshMinutes, onGlobalRefreshMinutesChange,
  onOpenAbout, onOpenAdmin, onOpenDownloads, onLogout, totpManager }: SettingsPageProps) {
  const styles = useStyles();
  const color = useThemeColor();
  const language = useLanguage();
  const mode = useThemeMode();
  const [panel, setPanel] = useState<SettingsPanel>(null);
  const activeProfile = profile ?? session.profile;
  const username = activeProfile?.email ?? session.email;
  const role = identityLabel(activeProfile);
  const close = () => setPanel(null);

  return <View style={styles.page}>
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.group}>
        <SettingsRow label={t('外观')} value={t(mode === 'dark' ? '暗黑' : '明亮')} icon="contrast-outline"
          color={color(settingsColors.blue, 'info')} background="#e7f3ff" divider onPress={() => setPanel('theme')} />
        <SettingsRow label={t('语言')} value={languageLabel(language)} icon="language-outline"
          color={color(settingsColors.blue, 'info')} background="#e7f3ff" divider onPress={() => setPanel('language')} />
        <Pressable accessibilityRole="button" accessibilityLabel={t("查看用户信息，{value1}", { value1: username })}
          onPress={() => setPanel('profile')} style={({ pressed }) => [styles.profile, pressed && styles.pressed]}>
          <View style={styles.avatar}><View style={styles.avatarCenter}>
            <Text style={styles.avatarText}>{username.slice(0, 2).toUpperCase()}</Text>
          </View></View>
          <View style={styles.profileCopy}>
            <Text style={styles.profileName} numberOfLines={1}>{username}</Text>
            <Text style={styles.caption}>{t("Remote AI 云端账号")}</Text>
          </View>
          <Ionicons name="chevron-forward" size={19} color={color(settingsColors.muted, 'muted')} />
        </Pressable>
        <View style={styles.profileDivider} />
        <SettingsRow label={t("用户信息")} value={username} icon="person-outline" color={color(settingsColors.blue, 'info')}
          background="#f0faff" divider onPress={() => setPanel('profile')} />
        <SettingsRow label={t("身份信息")} value={role} icon="id-card-outline" color={color(settingsColors.blue, 'info')}
          background="#f4f4ff" onPress={() => setPanel('identity')} />
      </View>
      <View style={styles.group}>
        <SettingsRow label={t("自动刷新用量")} value={t("{value1} 分钟", { value1: globalRefreshMinutes })} icon="sync-outline"
          color={color(settingsColors.green, 'accent')} background="#e5fbf3" divider onPress={() => setPanel('refresh')} />
        <SettingsRow label={t("2FA 密钥")} value={totpManager.cloudSyncEnabled ? t("已开启") : t("未开启")}
          icon="shield-checkmark-outline" color={color(settingsColors.green, 'accent')} background="#e5fbf3"
          onPress={() => setPanel('totp')} />
      </View>
      {Platform.OS === 'android' && <View style={styles.group}>
        <SettingsRow label={t("下载管理")} icon="download-outline" color={color(settingsColors.green, 'accent')}
          background="#e5fbf3" onPress={onOpenDownloads} />
      </View>}
      {activeProfile?.role === 'admin' && <View style={styles.group}>
        <SettingsRow label={t("管理控制台")} icon="grid-outline" color={color(settingsColors.green, 'accent')}
          background="#e5fbf3" onPress={onOpenAdmin} />
      </View>}
      <View style={styles.group}>
        <SettingsRow label={t("修改密码")} icon="lock-closed-outline" color={color(settingsColors.orange, 'warning')}
          background="#fff6e6" onPress={() => setPanel('password')} />
      </View>
      <View style={styles.group}>
        <SettingsRow label={t("电脑端版本")} icon="desktop-outline" color={color(settingsColors.blue, 'info')}
          background="#e7f3ff" divider onPress={() => setPanel('desktop')} />
        <SettingsRow label={t("关于 Remote AI")} value={`v${CURRENT_APP_VERSION}`} icon="information-circle-outline"
          color={color(settingsColors.blue, 'info')} background="#e7f3ff" onPress={onOpenAbout} />
      </View>
      <View style={styles.footer}>
        <Pressable accessibilityRole="button" onPress={() => setPanel('logout')}
          style={({ pressed }) => [styles.logout, pressed && styles.pressed]}>
          <Ionicons name="log-out-outline" size={24} color={color(settingsColors.danger, 'danger')} />
          <Text style={styles.logoutText}>{t("退出登录")}</Text>
        </Pressable>
      </View>
    </ScrollView>
    <BottomSheet visible={panel === 'profile' || panel === 'identity'}
      title={panel === 'identity' ? t("身份信息") : t("用户信息")} onClose={close}>
      <View style={styles.sheetBody}>
        <Text style={styles.detailLabel}>{t("邮箱")}</Text>
        <Text selectable style={styles.detailValue}>{username}</Text>
        <Text style={styles.detailLabel}>{t("身份")}</Text>
        <Text selectable style={styles.detailValue}>{role}</Text>
      </View>
    </BottomSheet>
    {panel === 'refresh' && <RefreshIntervalSheet minutes={globalRefreshMinutes}
      onSave={onGlobalRefreshMinutesChange} onClose={close} />}
    <BottomSheet visible={panel === 'totp'} title={t("2FA 密钥")} onClose={close}>
      <View style={styles.sheetBody}><TotpSyncSettings manager={totpManager} /></View>
    </BottomSheet>
    {panel === 'language' && <LanguageSheet onClose={close} />}
    {panel === 'theme' && <ThemeSheet onClose={close} />}
    {panel === 'password' && <PasswordSheet session={session} onClose={close} />}
    {panel === 'desktop' && <DesktopVersionSheet session={session} onClose={close} />}
    <BottomSheet visible={panel === 'logout'} title={t("退出登录")} onClose={close} actions={[
      { label: t("继续使用"), onPress: close },
      { label: t("退出登录"), tone: 'danger', onPress: () => { close(); onLogout(); } },
    ]}>
      <View style={styles.sheetBody}>
        <Text style={styles.detailLabel}>{t("确定要退出当前账号吗？")}</Text>
        <Text style={styles.hint}>{t("退出后需要重新登录，云端数据会保留。")}</Text>
      </View>
    </BottomSheet>
  </View>;
}
