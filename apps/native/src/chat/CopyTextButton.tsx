import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BottomSheet } from '../components/BottomSheet';
import { copyText, saveTextFile } from './copyText';
import { palette, useStyles } from './styles';
import { Toast } from '../components/AppToast';

export interface CopyAction { text: string; label: string }
export const INLINE_COPY_WIDTH = 30;
const INLINE_BASELINE_OFFSET = 4;

interface ExportRequest { text: string; reason: 'too-large' | 'failed' }

function useTextCopy(text: string) {
  const [status, setStatus] = useState('');
  const [request, setRequest] = useState<ExportRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; clearTimeout(timer.current);
  }; }, []);
  const notice = (value: string) => {
    if (!mounted.current) return;
    setStatus(value);
    AccessibilityInfo.announceForAccessibility(t(value));
    if (value === '复制失败，请重试') Toast.fail(t(value));
    else if (value !== '已复制') Toast.success(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(''), 2000);
  };
  const copy = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const result = await copyText(text);
      if (!mounted.current) return;
      if (result === 'copied') notice('已复制');
      else if (Platform.OS === 'android') { setError(''); setRequest({ text, reason: result }); }
      else notice('复制失败，请重试');
    } finally { busy.current = false; }
  };
  const save = async () => {
    if (!request || busy.current) return;
    busy.current = true; setSaving(true); setError('');
    try {
      const result = await saveTextFile(request.text);
      if (result && mounted.current) {
        setRequest(null);
        notice(result.location === 'downloads' ? t("已保存到下载文件夹") : t("已保存到所选文件夹"));
      }
    } catch { if (mounted.current) setError(t("保存失败，请重试。")); }
    finally { busy.current = false; if (mounted.current) setSaving(false); }
  };
  return { status, request, saving, error, copy, save, close: () => setRequest(null) };
}

export function CopyTextButton({ text, label = t("复制"), variant = 'inline' }: {
  text: string; label?: string; variant?: 'inline' | 'labeled';
}) {
  const copyStyles = useCopyStyles();
  const color = useThemeColor();
  const styles = useStyles();
  useLanguage();
  const copy = useTextCopy(text);
  const labeled = variant === 'labeled';
  return <View style={!labeled && copyStyles.inline}><Pressable accessibilityRole="button" accessibilityLabel={label}
    style={labeled ? copyStyles.labeledButton : copyStyles.button} hitSlop={8}
    disabled={copy.saving} onPress={() => void copy.copy()}>
    <Feather name={copy.status === '已复制' ? 'check' : 'copy'} size={15} color={color(palette.muted, 'muted')} />
    {labeled && <Text style={copyStyles.label}>{copy.status ? t(copy.status) : label}</Text>}</Pressable>
    {copy.request && <BottomSheet visible title={t("保存完整内容")} onClose={copy.close} dismissible={!copy.saving}
      actions={[{ label: t("保存完整内容"), onPress: copy.save, loading: copy.saving, disabled: copy.saving }]}>
      <Text style={[styles.messageText, { maxWidth: 400 }]}>{copy.request.reason === 'too-large'
        ? t("内容较长，可将完整内容保存为文本文件。") : t("复制未成功，可将完整内容保存为文本文件。")}</Text>
      {!!copy.error && <Text accessibilityRole="alert" style={styles.error}>{copy.error}</Text>}
    </BottomSheet>}
  </View>;
}

const useCopyStyles = createThemedStyles((color) => ({
  labeledButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8 },
  label: { color: color(palette.muted, 'muted'), fontSize: 14 },
  // Explicit dimensions let Android lay out this view as one inline attachment in a TextView.
  inline: { width: INLINE_COPY_WIDTH, height: 20 },
  // The inline view ends at the text baseline; the icon's visible bottom also needs the font's descent.
  button: { flex: 1, alignItems: 'center', justifyContent: 'center',
    transform: [{ translateY: INLINE_BASELINE_OFFSET }] },
}));
