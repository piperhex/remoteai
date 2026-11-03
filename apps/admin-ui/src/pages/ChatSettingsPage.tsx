import inlineCopy from '@remoteai/i18n/copy/inline/admin/pages/ChatSettingsPage';
import { useEffect, useState } from 'react';
import { App, Button, Form, Space, Typography, theme } from 'antd';
import type { ChatPolicy } from '../../../../shared/remote-chat/policy';
import { parseChatPolicy } from '../../../../shared/chat/chatPolicy';
import { useI18n } from '../i18n-context';
import { ChatSettingsFields } from './ChatSettingsFields';
import './ChatSettingsPage.css';

interface Props {
  api: <T>(path: string, options?: RequestInit) => Promise<T>;
  canManage: boolean;
}

export function ChatSettingsPage({ api, canManage }: Props) {
  const { language, t } = useI18n();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [form] = Form.useForm<ChatPolicy>();
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const zh = language === 'zh';
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api<ChatPolicy>('/admin/api/chat-settings').then((policy) => {
      if (!cancelled) { form.setFieldsValue(parseChatPolicy(policy)); setLoaded(true); }
    }).catch(() => {
      if (!cancelled) message.error(zh ? inlineCopy["text_e1b8864d"] : inlineCopy["Unable_to_load_chat_settings_de7244dd"]);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, form, message, zh, attempt]);

  const save = async (policy: ChatPolicy) => {
    setSaving(true);
    try {
      const saved = await api<ChatPolicy>('/admin/api/chat-settings', {
        method: 'PATCH', body: JSON.stringify(policy),
      });
      form.setFieldsValue(saved);
      message.success(zh ? inlineCopy["text_64c60109"] : inlineCopy["Chat_settings_saved_2ec0a073"]);
    } catch { message.error(zh ? inlineCopy["text_a5fc967e"] : inlineCopy["Unable_to_save_Please_try_05cd3aad"]); }
    finally { setSaving(false); }
  };

  return <div className="chat-policy-page">
    <div className="chat-policy-heading">
      <Typography.Title level={2}>{t('nav.chatSettings')}</Typography.Title>
      <Typography.Text type="secondary">{zh
        ? inlineCopy["Codex_GUI_App_b8417ac5"]
        : inlineCopy["Manage_chat_settings_for_Codex_c2805743"]}
      </Typography.Text>
      <Typography.Text type="secondary">{zh
        ? inlineCopy["RelayP2P_aa88e54d"]
        : inlineCopy["Transfer_size_and_image_compression_7978ce03"]}
      </Typography.Text>
    </div>
    <Form form={form} onFinish={save} disabled={!canManage || saving || !loaded}>
      <ChatSettingsFields zh={zh} loading={loading} />
      <div className="chat-policy-actions"
        style={{ background: token.colorBgContainer, borderColor: token.colorBorderSecondary }}>
        <Typography.Text type="secondary">{zh ? inlineCopy["text_1726736f"] : inlineCopy["Save_to_apply_your_changes_890cfb60"]}</Typography.Text>
        <Space>
          {!loaded && !loading && <Button onClick={() => setAttempt((value) => value + 1)} disabled={false}>
            {zh ? inlineCopy["text_7bdd5ce1"] : inlineCopy["Reload_bdc090ec"]}</Button>}
          {canManage && <Button type="primary" htmlType="submit" loading={saving}>{t('common.save')}</Button>}
        </Space>
      </div>
    </Form>
  </div>;
}
