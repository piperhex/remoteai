import inlineCopy from '@remoteai/i18n/copy/inline/admin/pages/ChatSettingsFields';
import { interpolate as interpolateCopy } from '@remoteai/i18n';
import { Card, Form, InputNumber, Switch, Typography } from 'antd';
import { CHAT_POLICY_FIELDS } from '../../../../shared/remote-chat/policy';
import { POLICY_SECTIONS, type PolicyField } from './chatPolicyFields';
import { TitleSettingsFields } from './TitleSettingsFields';

function SettingField({ field, language }: { field: PolicyField; language: 0 | 1 }) {
  const { min, max } = CHAT_POLICY_FIELDS[field.key];
  const unlimited = min === -1;
  const toggle = field.key === 'fileBulkEnabled';
  // Keep invalid command values visible so Form can explain them instead of silently clamping or rounding.
  const validateCommandLimit = field.key === 'remoteCommandConcurrencyLimit';
  const numericMessage = max === undefined
    ? (language === 0 ? interpolateCopy(inlineCopy["value1_ec362808"], { value1: String(min) }) : interpolateCopy(inlineCopy["Enter_a_whole_number_of_e9226f3c"], { value1: String(min) }))
    : (language === 0 ? interpolateCopy(inlineCopy["value1value2_ebe594d5"], { value1: String(min), value2: String(max) }) : interpolateCopy(inlineCopy["Enter_a_whole_number_from_c2f31bd1"], { value1: String(min), value2: String(max) }));
  const unlimitedMessage = language === 0
    ? inlineCopy["1_648f0a4f"] : inlineCopy["Enter_1_unlimited_or_a_d175cf5a"];
  const message = unlimited ? unlimitedMessage : numericMessage;
  return <div className="chat-policy-field">
    <div className="chat-policy-field-copy">
      <label htmlFor={field.key}>{field.label[language]}</label>
      <Typography.Text type="secondary">{field.hint[language]}</Typography.Text>
    </div>
    <Form.Item name={field.key}
      getValueProps={toggle ? (value: number) => ({ checked: value === 1 }) : undefined}
      getValueFromEvent={toggle ? (checked: boolean) => Number(checked) : undefined}
      rules={[{ required: true, type: 'integer', min, max, message },
      { validator: (_, value: unknown) => unlimited && value === 0
        ? Promise.reject(new Error(message)) : Promise.resolve() }]}>
      {toggle ? <Switch id={field.key} aria-label={field.label[language]} />
        : <InputNumber id={field.key} aria-label={field.label[language]}
          min={validateCommandLimit ? undefined : min} max={validateCommandLimit ? undefined : max}
          precision={validateCommandLimit ? undefined : 0} addonAfter={field.unit[language]} controls={false} />}
    </Form.Item>
  </div>;
}
export function ChatSettingsFields({ zh, loading }: { zh: boolean; loading: boolean }) {
  const language = zh ? 0 : 1;
  return <div className="chat-policy-grid">
    <TitleSettingsFields zh={zh} loading={loading} />
    {POLICY_SECTIONS.map((section) => <Card key={section.key} loading={loading}
      className={'chat-policy-section chat-policy-' + section.key}>
      <div className="chat-policy-section-heading">
        <Typography.Title level={4}>{section.title[language]}</Typography.Title>
        <Typography.Text type="secondary">{section.hint[language]}</Typography.Text>
      </div>
      <div className="chat-policy-section-fields">
        {section.fields.map((field) => <SettingField key={field.key} field={field} language={language} />)}
      </div>
    </Card>)}
  </div>;
}
