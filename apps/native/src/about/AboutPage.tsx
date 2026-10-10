import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { Ionicons } from '@expo/vector-icons';
import { Image, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SettingsRow } from '../settings/SettingsRow';
import { settingsColors as colors, useStyles as useSettingsStyles } from '../settings/styles';
import { CURRENT_APP_VERSION, CURRENT_BUILD_VERSION, RELEASES_URL } from '../update/appUpdate';
import { openReleasePage, useAppUpdate } from './useAppUpdate';
import { UpdateDetails } from './UpdateDetails';
import { VersionUpdateButton } from './VersionUpdateButton';
import { useStyles } from './styles';

export function AboutPage({ onBack }: { onBack: () => void }) {
  const settingsStyles = useSettingsStyles();
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  const update = useAppUpdate();
  return <View style={settingsStyles.page}>
    <View style={styles.navigation}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("返回设置")} onPress={onBack}
        style={({ pressed }) => [styles.back, pressed && settingsStyles.pressed]}>
        <Ionicons name="chevron-back" size={23} color={color(colors.ink, 'ink')} />
      </Pressable>
      <Text style={styles.title}>{t("关于")}</Text>
    </View>
    <ScrollView contentContainerStyle={settingsStyles.scroll}>
      <View style={settingsStyles.group}>
        <View style={settingsStyles.profile}>
          <Image source={require('../../assets/icon.png')} style={styles.icon} />
          <View style={settingsStyles.profileCopy}>
            <Text style={settingsStyles.profileName}>Remote AI</Text>
            <View style={styles.versionRow}>
              <Text style={styles.version}>v{CURRENT_APP_VERSION}</Text>
              <VersionUpdateButton update={update} />
            </View>
          </View>
        </View>
        <Text style={styles.description}>{t("管理账号用量，随时连接桌面设备。")}</Text>
        <UpdateDetails update={update} />
      </View>
      <View style={settingsStyles.group}>
        <SettingsRow label={t("构建版本")} value={CURRENT_BUILD_VERSION} icon="cube-outline"
          color={color(colors.blue, 'info')} background="#f0faff" divider />
        <SettingsRow label={t("运行平台")} value={Platform.OS === 'android' ? 'Android' : 'iOS'}
          icon="phone-portrait-outline" color={color(colors.blue, 'info')} background="#f4f4ff" divider />
        <SettingsRow label={t("开源许可")} value="Apache-2.0" icon="document-text-outline"
          color={color(colors.orange, 'warning')} background="#fff6e6" />
      </View>
      <View style={settingsStyles.group}>
        <SettingsRow label={t("开源项目与历史版本")} icon="logo-github" color={color(colors.ink, 'ink')}
          background="#f1f3f6" onPress={() => openReleasePage(RELEASES_URL)} />
      </View>
    </ScrollView>
  </View>;
}
