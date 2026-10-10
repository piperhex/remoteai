import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';

export function HostIdentityVerification({ confirm, close }: {
  confirm: (fingerprint: string) => Promise<void>; close: () => void;
}) {
  const color = useThemeColor();
  useLanguage();
  const [fingerprint, setFingerprint] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await confirm(fingerprint); close(); }
    catch (error) { setError(error instanceof Error ? error.message : t("电脑身份未能更新，请重试。")); }
    finally { setBusy(false); }
  };
  return <BottomSheet visible title={t("核对电脑身份")} onClose={close} maxWidth={400}
    actions={[{ label: t("核对并重新连接"), onPress: submit, loading: busy, disabled: !fingerprint.trim() }]}>
    <View style={{ gap: 12, padding: 16, maxWidth: 400 }}>
      <Text>{t("请在电脑的设置中找到“远程桌面”，复制设备指纹并粘贴到下方。")}</Text>
      <TextInput accessibilityLabel={t("设备指纹")} value={fingerprint} onChangeText={setFingerprint}
        autoCapitalize="none" autoCorrect={false} maxLength={100}
        style={{ borderWidth: 1, borderColor: color('#cbd5e1', 'border'), borderRadius: 8, padding: 12 }} />
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
    </View>
  </BottomSheet>;
}
