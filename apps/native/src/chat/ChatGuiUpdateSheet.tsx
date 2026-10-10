import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { ScrollView, Text, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { SHEET_READABLE_WIDTH } from '../components/SheetScrollView';
import { useGuiUpdate, type GuiUpdateOptions } from '../../../../shared/remote-chat/useGuiUpdate';
import { useStyles } from './styles';

export function ChatGuiUpdateSheet({ deviceName, onClose, onBack, ...options }: GuiUpdateOptions & {
  deviceName?: string; onClose: () => void; onBack: () => void;
}) {
  const localStyles = useLocalStyles();
  const styles = useStyles();
  useLanguage();
  const update = useGuiUpdate(options);
  return <BottomSheet visible title={update.confirmation ? t("安装 Codex GUI 更新") : t("更新 Codex GUI")}
    subtitle={deviceName || t("当前电脑")} onClose={onClose} onBack={update.confirmation ? update.cancel : onBack}
    dragFromHeaderOnly maxWidth={SHEET_READABLE_WIDTH} actions={update.confirmation ? [
      { label: t("暂不安装"), onPress: update.cancel },
      { label: t("确认安装"), tone: 'primary', disabled: !update.canConfirm, onPress: update.confirm },
    ] : [
      { label: t(update.checkLabel), disabled: !update.canCheck, onPress: update.check },
      { label: t("安装更新"), tone: 'primary', disabled: !update.canInstall, onPress: update.requestInstall },
    ]}>
    <ScrollView><View style={localStyles.body}>
      {update.confirmation ? <>
        <Text style={styles.title}>v{update.confirmation}</Text>
        <Text style={styles.subtitle}>{t("将在这台电脑上更新 Codex GUI，完成后自动重新连接。")}</Text>
      </> : <>
        <Text style={styles.subtitle}>{t("当前版本")}</Text>
        <Text selectable style={styles.title}>{update.version ? `v${update.version}` : t("暂未读取到版本")}</Text>
        {update.available && update.release && <>
          <Text style={styles.subtitle}>{t("可用版本")}</Text>
          <Text selectable style={styles.title}>v{update.release.version}</Text>
        </>}
      </>}
      <Text accessibilityLiveRegion="polite" style={styles.subtitle}>{t(update.message)}</Text>
      {update.progress !== null && <Text accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: update.progress }} style={styles.title}>{update.progress}%</Text>}
      {!!update.error && <Text accessibilityRole="alert" style={styles.error}>{update.error}</Text>}
    </View></ScrollView>
  </BottomSheet>;
}

const useLocalStyles = createThemedStyles(() => ({
  body: { width: '100%', maxWidth: 400, alignSelf: 'center', gap: 12, paddingBottom: 16 },
}));
