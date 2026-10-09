import { t, useLanguage } from '../i18n';
import { useState } from 'react';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import { ChatUsage } from './ChatUsage';
import { ChatContextSettings } from './ChatContextSettings';
import { ChatProfileMenu, type ChatConnectionProps } from './ChatProfileMenu';
import type { ContextSettingsApi } from '../../../../shared/remote-chat/contextSettings';
import type { ReadUsage } from '../../../../shared/remote-chat/usage';
import type { ReadConversationMetrics } from '../../../../shared/remote-chat/conversationMetrics';
import type { Model, ThreadTokenUsage } from './types';
import type { ComposerSettings } from '../../../../shared/remote-chat/composer';
import { SETTINGS_FIELDS, settingOptions, settingValue, settingsNotice, visibleSettingsFields,
  type SettingField } from '../../../../shared/remote-chat/settingsMenu';

interface Props {
  connection: ChatConnectionProps;
  threadId: string | null;
  contextSettings: ContextSettingsApi;
  tokenUsage?: ThreadTokenUsage;
  readUsage: ReadUsage;
  readConversationMetrics: ReadConversationMetrics;
  models: Model[];
  selection: ComposerSettings;
  saving: boolean;
  ready: boolean;
  error: string;
  updateSettings: (settings: Partial<ComposerSettings>) => Promise<void>;
  onClose: () => void;
}

export function ChatSettings({ models, selection, saving, ready, error, updateSettings, onClose,
  readUsage, readConversationMetrics, tokenUsage, threadId, contextSettings, connection }: Props) {
  useLanguage();
  const [field, setField] = useState<SettingField | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const notice = settingsNotice({ saving, ready, error });
  const choose = async (value: string) => {
    if (!field) return;
    if (value !== selection[field] || error) await updateSettings({ [field]: value });
    setField((current) => current === field ? null : current);
  };
  return <AdaptiveSheet open title={t("聊天设置")} width={400} onClose={onClose}>
    <div className="chat-settings" aria-hidden={field !== null || contextOpen}>
      <ChatProfileMenu {...connection} variant="settings" ready={ready} />
      {visibleSettingsFields(selection).map((entry) => <button key={entry.field} type="button"
        className="chat-setting-entry"
        aria-label={t("设置{value1}", { value1: t(entry.label) })} onClick={() => setField(entry.field)} tabIndex={field ? -1 : 0}>
        <strong>{t(entry.label)}</strong><span>{entry.field === 'model'
          ? settingValue(entry.field, models, selection) : t(settingValue(entry.field, models, selection))}</span>
        <span aria-hidden="true">›</span>
      </button>)}
      {!!notice && <p role={error ? 'alert' : 'status'} className={error ? 'chat-error' : 'chat-muted'}>{t(notice)}</p>}
      {!!error && <button type="button" className="chat-button" onClick={() => { void updateSettings(selection); }}>
        {t("重新保存")}</button>}
      <ChatUsage read={readUsage} active={!field && !contextOpen} ready={ready} tokenUsage={tokenUsage}
        readConversationMetrics={readConversationMetrics} threadId={threadId}
        onContextSettings={threadId ? () => setContextOpen(true) : undefined} />
    </div>
    {field && <AdaptiveSheet open title={t(SETTINGS_FIELDS.find((entry) => entry.field === field)!.title)} width={400}
      onBack={() => setField(null)} onClose={() => setField(null)}>
      <div className="chat-settings chat-setting-options" role="radiogroup">
        {settingOptions(field, models, selection).map((option) => <button key={option.value}
          type="button" role="radio" aria-label={field === 'model' ? option.label : t(option.label)} aria-checked={selection[field] === option.value}
          className="chat-setting-option" onClick={() => { void choose(option.value); }}>
          <span className="chat-row"><strong className="chat-grow">{field === 'model' ? option.label : t(option.label)}</strong>
            {selection[field] === option.value && <span aria-hidden="true">✓</span>}</span>
          {option.description && <small>{t(option.description)}</small>}
        </button>)}
      </div>
    </AdaptiveSheet>}
    {contextOpen && threadId && <ChatContextSettings threadId={threadId} api={contextSettings}
      onClose={() => setContextOpen(false)} />}
  </AdaptiveSheet>;
}
