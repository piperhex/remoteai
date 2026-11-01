import { useThemeColor } from '../theme/store';
import { languageLabel, t, useLanguage } from '../i18n';
import { LanguageSheet } from './LanguageSheet';
import { ThemeSheet } from './ThemeSheet';
import { useThemePreference } from '../theme/preference';
import { THEME_LABELS } from '../../../../shared/theme/mode';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
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
import { FileAutoSaveSheet } from './FileAutoSaveSheet';
import { useFilePreferences } from './filePreferences';
import { AUTO_SAVE_OPTIONS } from '../../../../shared/project-browser/preferences';
import type { LoungeController } from '../../../../shared/lounge/controller';
import { SettingsAvatar } from './SettingsAvatar';

interface SettingsPageProps {
  session: AuthSession;
  profile: UserProfile | null;
  globalRefreshMinutes: number;
  onGlobalRefreshMinutesChange: (minutes: number) => Promise<void>;
  onOpenAbout: () => void;
  onOpenAdmin: () => void;
  onLogout: () => void;
  totpManager: TotpManagerState;
  loungeController: LoungeController;
}

type SettingsPanel = 'profile' | 'refresh' | 'totp' | 'password' | 'logout'
  | 'desktop' | 'theme' | 'language' | 'files' | null;

function identityLabel(profile?: UserProfile | null) {
  if (!profile) return t("client.mobile.loading");
  if (profile.roleName) return profile.roleName;
  if (profile.role === 'admin') return t("client.app.administrator");
  return profile.role === 'user' ? t("client.app.user") : profile.role;
}

export function SettingsPage({ session, profile, globalRefreshMinutes, onGlobalRefreshMinutesChange,
  onOpenAbout, onOpenAdmin, onLogout, totpManager, loungeController }: SettingsPageProps) {
  const styles = useStyles();
  const color = useThemeColor();
  const language = useLanguage();
  const filePreferences = useFilePreferences();
  const autoSaveOption = AUTO_SAVE_OPTIONS.find(option => option.value === filePreferences.delay);
  const preference = useThemePreference();
  const [panel, setPanel] = useState<SettingsPanel>(null);
  const activeProfile = profile ?? session.profile;
  const username = activeProfile?.email ?? session.email;
  const role = identityLabel(activeProfile);
  const close = () => setPanel(null);

  return <View style={styles.page}>
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.group}>
        <View style={styles.profile}>
          <SettingsAvatar controller={loungeController} account={username} />
          <Pressable accessibilityRole="button"
            accessibilityLabel={t('client.mobile.viewUserDetails', { value1: username })}
            onPress={() => setPanel('profile')} style={({ pressed }) => [styles.profileDetails, pressed && styles.pressed]}>
          <View style={styles.profileCopy}>
            <Text style={styles.profileName} numberOfLines={1}>{username}</Text>
            <Text style={styles.caption}>{t("client.settings.remoteAiCloudAccount")}</Text>
          </View>
          <Ionicons name="chevron-forward" size={19} color={color(settingsColors.muted, 'muted')} />
          </Pressable>
        </View>
      </View>
      <View style={styles.group}>
        <SettingsRow label={t("client.workspaceSettings.appearance")}
          value={t(THEME_LABELS[preference])} icon="contrast-outline"
          color={color(settingsColors.blue, 'info')} background="#e7f3ff" divider onPress={() => setPanel('theme')} />
        <SettingsRow label={t('client.settings.language')} value={languageLabel(language)} icon="language-outline"
          color={color(settingsColors.blue, 'info')} background="#e7f3ff" onPress={() => setPanel('language')} />
      </View>
      <View style={styles.group}>
        <SettingsRow label={t("client.projectBrowser.autoSaveFiles")} icon="save-outline"
          value={autoSaveOption ? t(autoSaveOption.label) : undefined}
          color={color(settingsColors.green, 'accent')} background="#e5fbf3" divider onPress={() => setPanel('files')} />
        <SettingsRow label={t("client.settings.autoRefreshUsage")} value={t("client.settings.minutes", { value1: globalRefreshMinutes })} icon="sync-outline"
          color={color(settingsColors.green, 'accent')} background="#e5fbf3" divider onPress={() => setPanel('refresh')} />
        <SettingsRow label={t('client.settings.twoFactorKeyCloudSync')}
          value={totpManager.cloudSyncEnabled ? t("client.settings.on") : t("client.settings.off")}
          icon="shield-checkmark-outline" color={color(settingsColors.green, 'accent')} background="#e5fbf3"
          onPress={() => setPanel('totp')} />
      </View>
      {activeProfile?.role === 'admin' && <View style={styles.group}>
        <SettingsRow label={t("client.settings.adminConsole")} icon="grid-outline" color={color(settingsColors.green, 'accent')}
          background="#e5fbf3" onPress={onOpenAdmin} />
      </View>}
      <View style={styles.group}>
        <SettingsRow label={t("client.settings.changePassword")} icon="lock-closed-outline" color={color(settingsColors.orange, 'warning')}
          background="#fff6e6" onPress={() => setPanel('password')} />
      </View>
      <View style={styles.group}>
        <SettingsRow label={t("client.settings.desktopVersion")} icon="desktop-outline" color={color(settingsColors.blue, 'info')}
          background="#e7f3ff" divider onPress={() => setPanel('desktop')} />
        <SettingsRow label={t("client.settings.aboutRemoteAi")} value={`v${CURRENT_APP_VERSION}`} icon="information-circle-outline"
          color={color(settingsColors.blue, 'info')} background="#e7f3ff" onPress={onOpenAbout} />
      </View>
      <View style={styles.footer}>
        <Pressable accessibilityRole="button" onPress={() => setPanel('logout')}
          style={({ pressed }) => [styles.logout, pressed && styles.pressed]}>
          <Ionicons name="log-out-outline" size={24} color={color(settingsColors.danger, 'danger')} />
          <Text style={styles.logoutText}>{t("client.app.signOut")}</Text>
        </Pressable>
      </View>
    </ScrollView>
    <BottomSheet visible={panel === 'profile'} title={t("client.settings.profile")} onClose={close}>
      <View style={styles.sheetBody}>
        <Text style={styles.detailLabel}>{t("client.app.email")}</Text>
        <Text selectable style={styles.detailValue}>{username}</Text>
        <Text style={styles.detailLabel}>{t("client.settings.role")}</Text>
        <Text selectable style={styles.detailValue}>{role}</Text>
      </View>
    </BottomSheet>
    {panel === 'refresh' && <RefreshIntervalSheet minutes={globalRefreshMinutes}
      onSave={onGlobalRefreshMinutesChange} onClose={close} />}
    <BottomSheet visible={panel === 'totp'} title={t('client.settings.twoFactorKeyCloudSync')} onClose={close}>
      <View style={styles.sheetBody}><TotpSyncSettings manager={totpManager} /></View>
    </BottomSheet>
    {panel === 'theme' && <ThemeSheet onClose={close} />}
    {panel === 'language' && <LanguageSheet onClose={close} />}
    {panel === 'files' && <FileAutoSaveSheet onClose={close} />}
    {panel === 'password' && <PasswordSheet session={session} onClose={close} />}
    {panel === 'desktop' && <DesktopVersionSheet session={session} onClose={close} />}
    <BottomSheet visible={panel === 'logout'} title={t("client.app.signOut")} onClose={close} actions={[
      { label: t("client.settings.staySignedIn"), onPress: close },
      { label: t("client.app.signOut"), tone: 'danger', onPress: () => { close(); onLogout(); } },
    ]}>
      <View style={styles.sheetBody}>
        <Text style={styles.detailLabel}>{t("client.mobile.signOutOfThisAccount")}</Text>
        <Text style={styles.hint}>{t("client.settings.youWillNeedToSignInAgainYourCloudData")}</Text>
      </View>
    </BottomSheet>
  </View>;
}
