import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { SheetScrollView, SHEET_READABLE_WIDTH } from '../components/SheetScrollView';
import type { Model, ThreadTokenUsage } from './types';
import type { ComposerSettings } from '../../../../shared/remote-chat/composer';
import { SETTINGS_FIELDS, settingOptions, settingValue, settingsNotice, visibleSettingsFields,
  type SettingField } from '../../../../shared/remote-chat/settingsMenu';
import { palette, useStyles } from './styles';
import { ChatUsage } from './ChatUsage';
import type { ReadUsage } from '../../../../shared/remote-chat/usage';
import type { ReadConversationMetrics } from '../../../../shared/remote-chat/conversationMetrics';
import type { ContextSettingsApi } from '../../../../shared/remote-chat/contextSettings';
import { ChatContextSettings } from './ChatContextSettings';
import { ChatProfileMenu, type ChatConnectionProps } from './ChatProfileMenu';

interface Props {
  connection: ChatConnectionProps;
  threadId: string | null;
  contextSettings: ContextSettingsApi;
  tokenUsage?: ThreadTokenUsage;
  readUsage: ReadUsage;
  readConversationMetrics: ReadConversationMetrics;
  usageActive: boolean;
  models: Model[];
  selection: ComposerSettings;
  saving: boolean;
  ready: boolean;
  error: string;
  updateSettings: (settings: Partial<ComposerSettings>) => Promise<void>;
  onClose: () => void;
}

export function ChatSettings({ models, selection, saving, ready, error, updateSettings, onClose,
  readUsage, readConversationMetrics, usageActive, tokenUsage, threadId, contextSettings, connection }: Props) {
  const styles = useStyles();
  const menuStyles = useMenuStyles();
  useLanguage();
  const [field, setField] = useState<SettingField | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const nestedOpen = field !== null || contextOpen;
  useEffect(() => { setContextOpen(false); }, [threadId, ready]);
  const notice = settingsNotice({ saving, ready, error });
  const choose = async (value: string) => {
    if (!field) return;
    if (value !== selection[field] || error) await updateSettings({ [field]: value });
    setField((current) => current === field ? null : current);
  };
  return <BottomSheet visible fullWidthContent title={t("聊天设置")} onClose={onClose}>
    <SheetScrollView contentContainerStyle={[styles.settings, menuStyles.content]}
      accessibilityElementsHidden={nestedOpen} importantForAccessibility={nestedOpen ? 'no-hide-descendants' : 'auto'}>
      <ChatProfileMenu {...connection} variant="settings" ready={ready} active={usageActive} />
      {visibleSettingsFields(selection).map((entry) => <Pressable key={entry.field} accessibilityRole="button"
        accessibilityLabel={t("设置{value1}", { value1: t(entry.label) })}
        onPress={() => setField(entry.field)} style={menuStyles.entry}>
        <Text style={[styles.title, { flexShrink: 1 }]}>{t(entry.label)}</Text>
        <Text numberOfLines={1} style={menuStyles.value}>{entry.field === 'model'
          ? settingValue(entry.field, models, selection) : t(settingValue(entry.field, models, selection))}</Text>
        <Text style={menuStyles.arrow}>›</Text>
      </Pressable>)}
      {!!notice && <Text accessibilityRole={error ? 'alert' : undefined}
        style={error ? styles.error : styles.subtitle}>{t(notice)}</Text>}
      {!!error && <Pressable accessibilityRole="button" style={styles.button}
        onPress={() => { void updateSettings(selection); }}><Text style={styles.buttonText}>{t("重新保存")}</Text></Pressable>}
      <ChatUsage read={readUsage} active={usageActive && !nestedOpen} ready={ready} tokenUsage={tokenUsage}
        readConversationMetrics={readConversationMetrics} threadId={threadId}
        onContextSettings={threadId && ready ? () => setContextOpen(true) : undefined} />
    </SheetScrollView>
    {contextOpen && threadId && ready && <ChatContextSettings key={threadId} threadId={threadId}
      api={contextSettings} onClose={() => setContextOpen(false)} />}
    {field && <BottomSheet fullWidthContent
      visible title={t(SETTINGS_FIELDS.find((entry) => entry.field === field)!.title)}
      onBack={() => setField(null)} onClose={() => setField(null)}>
      <SheetScrollView key={field} contentContainerStyle={[styles.settings, menuStyles.content, menuStyles.options]}>
        {settingOptions(field, models, selection).map((option) => <Pressable key={option.value}
          accessibilityRole="radio" accessibilityLabel={field === 'model' ? option.label : t(option.label)}
          accessibilityState={{ checked: selection[field] === option.value }}
          style={[styles.choice, selection[field] === option.value && styles.chosen]}
          onPress={() => { void choose(option.value); }}>
          <View style={styles.row}>
            <Text style={[styles.buttonText, styles.fill]}>{field === 'model' ? option.label : t(option.label)}</Text>
            {selection[field] === option.value && <Text style={styles.buttonText}>✓</Text>}
          </View>
          {option.description && <Text style={styles.subtitle}>{t(option.description)}</Text>}
        </Pressable>)}
      </SheetScrollView>
    </BottomSheet>}
  </BottomSheet>;
}

const useMenuStyles = createThemedStyles((color) => ({
  content: { paddingBottom: 18 },
  options: { maxWidth: SHEET_READABLE_WIDTH },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, padding: 14,
    borderWidth: 1, borderColor: color(palette.border, 'border'), borderRadius: 12 },
  value: { flex: 1, textAlign: 'right', color: color(palette.green, 'accent'), fontSize: 13, lineHeight: 20 },
  arrow: { color: color(palette.muted, 'muted'), fontSize: 22 },
}));
