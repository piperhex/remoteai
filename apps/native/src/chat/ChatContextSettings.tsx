import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { SheetScrollView } from '../components/SheetScrollView';
import { CONTEXT_CAPACITY_PRESETS_K, type ContextSettingsApi } from '../../../../shared/remote-chat/contextSettings';
import { useContextSettings } from '../../../../shared/remote-chat/client/useContextSettings';
import { useStyles } from './styles';

export function ChatContextSettings({ threadId, api, onClose }: {
  threadId: string; api: ContextSettingsApi; onClose: () => void;
}) {
  const styles = useStyles();
  const presetStyles = usePresetStyles();
  useLanguage();
  const editor = useContextSettings(threadId, api);
  const save = async () => { if (await editor.save()) onClose(); };
  return <BottomSheet visible fullWidthContent title={t("对话上下文设置")} onClose={onClose}
    onBack={editor.saving ? undefined : onClose}
    dismissible={!editor.saving} actions={[
      { label: t("取消"), onPress: onClose, disabled: editor.saving },
      { label: t("保存"), tone: 'primary', onPress: save, loading: editor.saving,
        disabled: editor.loading || !editor.loaded },
    ]}>
    <SheetScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.settings}>
      <Text style={styles.subtitle}>{t("仅用于当前对话。保存后立即应用；正在回复时会先暂停，修改后自动继续。")}</Text>
      {editor.loading && <ActivityIndicator accessibilityLabel={t("正在读取上下文设置")} />}
      {editor.loaded && <>
        <Text style={styles.title}>{t("上下文容量（K Token）")}</Text>
        <TextInput accessibilityLabel={t("上下文容量（K Token）")} keyboardType="decimal-pad"
          value={editor.value} onChangeText={editor.setValue} editable={!editor.saving}
          placeholder={t("选择或输入容量")} style={[styles.input, styles.questionInput]}
          onSubmitEditing={() => { void save(); }} />
        <View style={presetStyles.options}>
          {CONTEXT_CAPACITY_PRESETS_K.map((capacity) => <Pressable key={capacity}
            accessibilityRole="button" accessibilityLabel={`${capacity}K`} disabled={editor.saving}
            accessibilityState={{ selected: Number(editor.value) === capacity, disabled: editor.saving }}
            style={[styles.choice, presetStyles.option, Number(editor.value) === capacity && styles.chosen,
              editor.saving && styles.disabled]}
            onPress={() => editor.setValue(String(capacity))}>
            <Text style={styles.buttonText}>{capacity}K</Text>
          </Pressable>)}
        </View>
        <Text style={styles.subtitle}>{t("1 K = 1000 Token；留空使用默认容量。")}</Text>
        <Text style={styles.subtitle}>{t("用量会在收到回复后更新。程序会预留部分空间，显示的可用容量可能略小。")}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t("恢复默认")} disabled={editor.saving}
          accessibilityState={{ disabled: editor.saving }} style={styles.button} onPress={() => editor.setValue('')}>
          <Text style={styles.buttonText}>{t("恢复默认")}</Text>
        </Pressable>
      </>}
      {!!editor.error && <Text accessibilityRole="alert" style={styles.error}>{t(editor.error)}</Text>}
      {!editor.loading && !editor.loaded && <Pressable accessibilityRole="button" accessibilityLabel={t("重试")}
        style={styles.button} onPress={editor.retry}><Text style={styles.buttonText}>{t("重试")}</Text></Pressable>}
    </SheetScrollView>
  </BottomSheet>;
}

const usePresetStyles = createThemedStyles(() => ({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { minHeight: 44, justifyContent: 'center' },
}));
