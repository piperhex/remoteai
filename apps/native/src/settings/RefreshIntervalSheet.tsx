import { t, useLanguage } from '../i18n';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Toast } from '../components/AppToast';
import { BottomSheet } from '../components/BottomSheet';
import { useStyles } from './styles';

const MIN_REFRESH_MINUTES = 1;
const MAX_REFRESH_MINUTES = 1440;

interface RefreshIntervalSheetProps {
  minutes: number;
  onSave: (minutes: number) => Promise<void>;
  onClose: () => void;
}

export function RefreshIntervalSheet({ minutes, onSave, onClose }: RefreshIntervalSheetProps) {
  const styles = useStyles();
  useLanguage();
  const [input, setInput] = useState(String(minutes));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (saving) return;
    const nextMinutes = Number(input);
    if (!Number.isInteger(nextMinutes) || nextMinutes < MIN_REFRESH_MINUTES || nextMinutes > MAX_REFRESH_MINUTES) {
      setError(t("请输入 1 到 1440 之间的整数分钟"));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(nextMinutes);
      Toast.success(t("已设置为每 {value1} 分钟自动刷新用量", { value1: nextMinutes }));
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : t("保存失败，请稍后重试"));
    } finally {
      setSaving(false);
    }
  };
  return <BottomSheet visible title={t("自动刷新用量")} onClose={onClose} dismissible={!saving}
    actions={[
      { label: t("取消"), onPress: onClose, disabled: saving },
      { label: t("保存"), tone: 'primary', onPress: save, loading: saving },
    ]}>
    <View style={styles.sheetBody}>
      <Text style={styles.hint}>{t("定时刷新所有账号的用量，也可以随时手动刷新。")}</Text>
      <Text style={styles.detailLabel}>{t("刷新间隔（分钟）")}</Text>
      <TextInput accessibilityLabel={t("刷新间隔（分钟）")} value={input}
        onChangeText={(value) => setInput(value.replace(/\D/g, '').slice(0, 4))}
        keyboardType="number-pad" placeholder="30" style={styles.input} editable={!saving}
        onSubmitEditing={() => void save()} />
      <Text style={styles.hint}>{t("可设置为 1–1440 分钟，默认为 30 分钟。")}</Text>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  </BottomSheet>;
}
