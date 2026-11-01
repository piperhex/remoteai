import { displayText, displayError } from '../i18n/index';
import { createThemedStyles } from '../theme/styles';
import { textMetrics } from '../theme/text';
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
import { ModelRefreshButton } from './ModelRefreshButton';
import { ChatSettingSegments } from './ChatSettingSegments';

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
  refreshModels: () => Promise<void>;
  onClose: () => void;
}

export function ChatSettings({ models, selection, saving, ready, error, updateSettings, refreshModels, onClose,
  readUsage, readConversationMetrics, usageActive, tokenUsage, threadId, contextSettings, connection }: Props) {
  const styles = useStyles();
  const menuStyles = useMenuStyles();
  useLanguage();
  const [field, setField] = useState<SettingField | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const nestedOpen = field !== null || contextOpen;
  useEffect(() => { setContextOpen(false); }, [threadId, ready]);
  const notice = settingsNotice({ saving, ready, error });
  const selectInline = (field: SettingField, value: string) => {
    if (value !== selection[field] || error) void updateSettings({ [field]: value });
  };
  const choose = async (value: string) => {
    if (!field) return;
    if (value !== selection[field] || error) await updateSettings({ [field]: value });
    setField((current) => current === field ? null : current);
  };
  return <BottomSheet visible fullWidthContent hideHeader title={t("client.chat.chatSettings.1e06eb")} onClose={onClose}>
    <SheetScrollView contentContainerStyle={[styles.settings, menuStyles.content]}
      accessibilityElementsHidden={nestedOpen} importantForAccessibility={nestedOpen ? 'no-hide-descendants' : 'auto'}>
      <ChatUsage read={readUsage} active={usageActive && !nestedOpen} ready={ready} tokenUsage={tokenUsage}
        readConversationMetrics={readConversationMetrics} threadId={threadId}
        onContextSettings={threadId && ready ? () => setContextOpen(true) : undefined} />
      <ChatProfileMenu {...connection} variant="settings" ready={ready} active={usageActive} />
      {visibleSettingsFields(selection).map((entry) => entry.field !== 'model'
        ? <ChatSettingSegments key={entry.field} field={entry.field}
          label={displayText(entry.label)} value={selection[entry.field] ?? ''}
          options={settingOptions(entry.field, models, selection)} onChange={value => selectInline(entry.field, value)} />
        : <Pressable key={entry.field} accessibilityRole="button"
        accessibilityLabel={t("client.chat.set", { value1: displayText(entry.label) })}
        onPress={() => setField(entry.field)} style={menuStyles.entry}>
        <Text style={menuStyles.title}>{displayText(entry.label)}</Text>
        <Text numberOfLines={1} style={menuStyles.value}>
          {settingValue(entry.field, models, selection, displayText)}</Text>
        <Text style={menuStyles.arrow}>›</Text>
      </Pressable>)}
      {!!notice && <Text accessibilityRole={error ? 'alert' : undefined}
        style={error ? styles.error : styles.subtitle}>{displayError(notice)}</Text>}
      {!!error && <Pressable accessibilityRole="button" style={styles.button}
        onPress={() => { void updateSettings(selection); }}><Text style={styles.buttonText}>{t("client.chat.saveAgain")}</Text></Pressable>}
    </SheetScrollView>
    {contextOpen && threadId && ready && <ChatContextSettings key={threadId} threadId={threadId}
      api={contextSettings} onClose={() => setContextOpen(false)} />}
    {field && <BottomSheet fullWidthContent
      visible title={displayText(SETTINGS_FIELDS.find((entry) => entry.field === field)!.title)}
      titleAction={field === 'model' ? <ModelRefreshButton ready={ready} refreshModels={refreshModels} /> : undefined}
      onBack={() => setField(null)} onClose={() => setField(null)}>
      <SheetScrollView key={field} contentContainerStyle={[styles.settings, menuStyles.content, menuStyles.options]}>
        {settingOptions(field, models, selection).map((option) => <Pressable key={option.value}
          accessibilityRole="radio" accessibilityLabel={field === 'model' ? option.label : displayText(option.label)}
          accessibilityState={{ checked: selection[field] === option.value }}
          style={[styles.choice, selection[field] === option.value && styles.chosen]}
          onPress={() => { void choose(option.value); }}>
          <View style={styles.row}>
            <Text style={[styles.buttonText, styles.fill]}>{field === 'model' ? option.label : displayText(option.label)}</Text>
            {selection[field] === option.value && <Text style={styles.buttonText}>✓</Text>}
          </View>
          {option.description && <Text style={styles.subtitle}>{displayText(option.description)}</Text>}
        </Pressable>)}
      </SheetScrollView>
    </BottomSheet>}
  </BottomSheet>;
}

const useMenuStyles = createThemedStyles((color) => ({
  content: { paddingHorizontal: 14, paddingBottom: 14, gap: 12 },
  options: { maxWidth: SHEET_READABLE_WIDTH },
  title: { flexShrink: 1, ...textMetrics(15, 22), color: color(palette.ink, 'ink'), fontWeight: '600' },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 42 },
  value: { flex: 1, textAlign: 'right', color: color(palette.green, 'accent'), ...textMetrics(14, 22) },
  arrow: { color: color(palette.muted, 'muted'), ...textMetrics(22, 28) },
}));
